//! Placeholder echo binary — Task 1.4a.
//!
//! The Elysia-side supervisor (`WorkerSupervisor`) needs *something* to
//! spawn while the real footprint aggregator (Task 1.5) is being built.
//! This binary fills that gap: bind the bridge endpoint (UDS on
//! Linux / macOS, named pipe on Windows), read length-prefixed frames,
//! write them straight back. The supervisor's spawn / restart / log
//! drain plumbing exercises the full lifecycle without depending on
//! aggregator behaviour.
//!
//! Single-connection by design — the Elysia process opens one bridge
//! connection. A new client coming in while another is connected gets a
//! clean accept-then-close so the test harness can verify reconnect
//! semantics; the real worker (Task 1.5) inherits the accept loop, not
//! the echo body.
//!
//! Signal handling: SIGTERM (Linux/macOS) / Ctrl-C (Windows) maps to a
//! clean shutdown — the listener stops, the active connection (if any)
//! is dropped, and the process exits 0. Per ADR-004 the supervisor
//! forwards SIGTERM on its own shutdown; the echo binary's behaviour
//! has to match the real worker's contract so the supervisor code path
//! is exercised end-to-end during 1.4a smoke.

use std::sync::Arc;

use anyhow::{Context, Result};
use interprocess::local_socket::tokio::Stream as LocalSocketStream;
use interprocess::local_socket::{
    traits::tokio::Listener as ListenerTrait, GenericFilePath, ListenerOptions, ToFsName,
};
use tokio::io::AsyncWriteExt;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use tape_worker::bridge::transport::{default_bridge_path, read_frame, write_frame};

#[tokio::main]
async fn main() -> Result<()> {
    let path = default_bridge_path();
    eprintln!("echo worker binding bridge at {path}");

    let listener = bind_listener(&path).with_context(|| format!("bind {path}"))?;

    // Single-shot shutdown signal. SIGTERM / Ctrl-C raises it; the
    // accept loop checks before each accept; the active connection
    // (if any) cooperates via a `tokio::select!` against the same
    // notifier.
    let shutdown = Arc::new(Notify::new());
    let signal_handle = spawn_signal_listener(Arc::clone(&shutdown));

    let accept_handle: JoinHandle<Result<()>> = {
        let shutdown = Arc::clone(&shutdown);
        tokio::spawn(async move { run_accept_loop(listener, shutdown).await })
    };

    // Wait for either the accept loop to finish (it does on shutdown)
    // or the signal listener to finish first.
    let _ = tokio::join!(accept_handle, signal_handle);

    // Best-effort cleanup of the socket file on POSIX. Named pipes on
    // Windows clean up when the handle is dropped.
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(&path);
    }

    eprintln!("echo worker shut down cleanly");
    Ok(())
}

fn bind_listener(path: &str) -> Result<interprocess::local_socket::tokio::Listener> {
    // `interprocess` distinguishes filesystem-rooted endpoints (UDS path,
    // Windows-style `\\.\pipe\name`) from abstract namespace names. The
    // bridge path is always a real OS path, so we use the file flavour.
    // On POSIX we may need to remove a stale socket file from a crashed
    // previous run; the named-pipe equivalent on Windows is implicit.
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(path);
    }
    // GenericFilePath covers both flavours: POSIX UDS filesystem path
    // and Windows `\\.\pipe\<name>` named-pipe path. The bridge default
    // arrives with the full prefix in both cases (no abstract-socket
    // form), so one flavour resolves both targets.
    let name = path
        .to_fs_name::<GenericFilePath>()
        .with_context(|| format!("convert path {path}"))?;
    let listener = ListenerOptions::new().name(name).create_tokio()?;
    Ok(listener)
}

async fn run_accept_loop(
    listener: interprocess::local_socket::tokio::Listener,
    shutdown: Arc<Notify>,
) -> Result<()> {
    loop {
        tokio::select! {
            biased;
            () = shutdown.notified() => {
                eprintln!("echo worker: shutdown notified, draining accept loop");
                return Ok(());
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok(stream) => {
                        let shutdown = Arc::clone(&shutdown);
                        // One connection at a time — the Elysia process owns the
                        // bridge connection, the supervisor's reconnect handles
                        // any drop. Sequencing the handler inside the loop
                        // keeps the echo behaviour deterministic.
                        if let Err(err) = handle_connection(stream, shutdown).await {
                            eprintln!("echo worker connection error: {err:#}");
                        }
                    }
                    Err(err) => {
                        eprintln!("echo worker accept error: {err:#}");
                    }
                }
            }
        }
    }
}

async fn handle_connection(
    stream: LocalSocketStream,
    shutdown: Arc<Notify>,
) -> Result<()> {
    eprintln!("echo worker: client connected");
    let (mut reader, mut writer) = tokio::io::split(stream);
    loop {
        tokio::select! {
            biased;
            () = shutdown.notified() => {
                eprintln!("echo worker: shutdown notified, closing connection");
                let _ = writer.shutdown().await;
                return Ok(());
            }
            frame = read_frame(&mut reader) => {
                match frame? {
                    Some(payload) => {
                        write_frame(&mut writer, &payload).await?;
                        writer.flush().await?;
                    }
                    None => {
                        eprintln!("echo worker: peer closed cleanly");
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn spawn_signal_listener(shutdown: Arc<Notify>) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Listen for both SIGTERM (Linux/macOS) and Ctrl-C / SIGINT.
        // Whichever fires first raises the notifier; the second is a
        // no-op because Notify is idempotent on already-notified.
        #[cfg(unix)]
        let term = async {
            use tokio::signal::unix::{signal, SignalKind};
            if let Ok(mut sig) = signal(SignalKind::terminate()) {
                sig.recv().await;
            }
        };
        #[cfg(not(unix))]
        let term = std::future::pending::<()>();

        let ctrlc = async {
            let _ = tokio::signal::ctrl_c().await;
        };

        tokio::select! {
            () = term => {
                eprintln!("echo worker: SIGTERM received");
            }
            () = ctrlc => {
                eprintln!("echo worker: Ctrl-C / SIGINT received");
            }
        }
        shutdown.notify_waiters();
    })
}
