//! tape-worker — Task 1.5 per ADR-001..006.
//!
//! The real Rust hot-path worker. Binds the bridge socket (UDS on
//! Linux/macOS, named pipe on Windows) as a listener — matching the
//! Task 1.4a `echo` placeholder's transport role — and accepts the
//! single Elysia bridge client. Receives `TickFrame` and `ControlCommand`
//! frames, aggregates ticks into footprint cells, and emits
//! `cell.delta` / `cell.close` / `snapshot` / `worker_ready` /
//! `worker_unavailable` frames back over the same connection.
//!
//! Process topology per ADR-004 § Decision (Elysia-as-supervisor):
//!
//!  - Elysia's `WorkerSupervisor` spawns this binary, owns its
//!    lifecycle, and listens for SIGTERM / Ctrl-C forwarding.
//!  - The worker BINDS the bridge endpoint and waits for the supervised
//!    Elysia process to connect via `BridgeClient`. The same shape the
//!    Task 1.4a `echo` placeholder used — by keeping the listener side
//!    on the worker, the existing supervisor + bridge-client code
//!    paths exercise the new binary unchanged.
//!  - On graceful shutdown (`ControlCommand::Shutdown` or SIGTERM /
//!    Ctrl-C) we drain the aggregator (emitting a final `cell.close`
//!    for each open bar), send `worker_unavailable`, then exit 0.
//!
//! Three async tasks per ADR-004 + the Task 1.5 deliverables:
//!
//!  1. **Inbound reader** — reads framed payloads from the bridge,
//!     decodes via `rmp-serde` into `BridgeFrame`, dispatches.
//!     I/O errors trigger shutdown; per-frame parse errors increment a
//!     counter and the loop continues.
//!
//!  2. **Outbound writer** — receives `BridgeFrame` values via an
//!     `mpsc::channel`, encodes via `rmp-serde`, writes via
//!     `transport::write_frame`. Bounded channel capacity 1024 (ADR-006
//!     symmetry); on a full channel the drop policy approximates
//!     "drop oldest tick-derived frames (`cell.delta`), never drop
//!     `cell.close` / `snapshot` / control" via `try_send` for the
//!     delta path and `send` (awaiting) for the rest.
//!
//!  3. **Bar-rollover timer** — every 1 s checks for buckets that have
//!     ended (`bucket_ts + 60_000 <= now`) and emits `cell.close` for
//!     each. The aggregator's `close_expired` does the cell removal +
//!     frame construction.
//!
//! The aggregator state is shared between the three tasks via a
//! `tokio::sync::Mutex`. The mutex is contended only briefly per tick
//! (sub-microsecond critical section); for the volumes ADR-002 § Context
//! pins (200 ticks/s sustained) it is comfortably below the lock-free
//! threshold a custom queue would buy.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use interprocess::local_socket::tokio::Stream as LocalSocketStream;
use interprocess::local_socket::{
    traits::tokio::Listener as ListenerTrait, GenericFilePath, ListenerOptions, ToFsName,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex, Notify};

use tape_worker::aggregator::{Aggregator, OutboundFrame};
use tape_worker::bridge::messages::{
    BridgeFrame, ControlKind, WorkerReady, WorkerUnavailable,
};
use tape_worker::bridge::transport::{default_bridge_path, read_frame, write_frame};

/// Bounded outbound channel capacity per ADR-006 §
/// "WS_TICK_RING_CAP = 500" / the bridge symmetry note in the task brief.
/// 1024 sized to absorb a single Binance burst (~1–2 K ticks/s) without
/// blocking the inbound reader for more than ~5 ms.
const OUTBOUND_CHANNEL_CAP: usize = 1024;

/// Bar-rollover timer cadence. Per the task brief: every 1 s check
/// whether any open bar has ended; if so, emit `cell.close` for each
/// expired cell. A finer cadence buys nothing (the WS-side coalesce
/// already smooths the visible chart edge), a coarser cadence delays
/// the `cell.close` past its bar boundary which leaves the Phase 3
/// renderer painting stale right-edge state.
const ROLLOVER_TICK_INTERVAL: Duration = Duration::from_secs(1);

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    // `unwrap_or_default` is the genuinely-unreachable branch: clocks
    // before 1970 are not a real-world path on a server with NTP.
    #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    ms
}

#[tokio::main]
async fn main() -> Result<()> {
    let path = default_bridge_path();
    eprintln!("[tape-worker] binding bridge at {path}");

    let listener = bind_listener(&path).with_context(|| format!("bind {path}"))?;
    let shutdown = Arc::new(Notify::new());
    let signal_handle = tokio::spawn(spawn_signal_listener(Arc::clone(&shutdown)));

    // Accept one client. Elysia (BridgeClient) connects exactly once;
    // if it disconnects mid-session the supervisor restarts the worker
    // rather than us reaccepting in-process (ADR-004 keeps the failure
    // model simple — single-shot accept + supervisor-driven respawn).
    let stream = tokio::select! {
        biased;
        () = shutdown.notified() => {
            eprintln!("[tape-worker] shutdown before accept");
            return Ok(());
        }
        accepted = listener.accept() => accepted.context("accept bridge")?,
    };
    eprintln!("[tape-worker] bridge connected");

    let (reader, writer) = tokio::io::split(stream);

    let aggregator: Arc<Mutex<Aggregator>> = Arc::new(Mutex::new(Aggregator::new()));
    let (out_tx, out_rx) = mpsc::channel::<BridgeFrame>(OUTBOUND_CHANNEL_CAP);

    // Ship the handshake frame FIRST so the supervisor flips
    // BridgeClient to `connected` before we start feeding deltas. Per
    // ADR-004 the supervisor's 5 s wait window starts on connect and
    // expires on this frame.
    let pid = std::process::id();
    let ready = BridgeFrame::WorkerReady(WorkerReady {
        pid,
        generation: 0,
    });
    out_tx
        .send(ready)
        .await
        .context("send WorkerReady handshake")?;

    let writer_task = tokio::spawn(run_outbound_writer(writer, out_rx));
    let reader_task = tokio::spawn(run_inbound_reader(
        reader,
        Arc::clone(&aggregator),
        out_tx.clone(),
        Arc::clone(&shutdown),
    ));
    let rollover_task = tokio::spawn(run_rollover_timer(
        Arc::clone(&aggregator),
        out_tx.clone(),
        Arc::clone(&shutdown),
    ));

    // Wait for shutdown OR the inbound reader to exit (clean EOF or I/O error).
    tokio::select! {
        biased;
        () = shutdown.notified() => {
            eprintln!("[tape-worker] shutdown notified");
        }
        _ = reader_task => {
            eprintln!("[tape-worker] inbound reader finished");
        }
    }

    // Drain the aggregator before goodbye so every open bar lands as
    // a `cell.close`.
    let drained = {
        let mut agg = aggregator.lock().await;
        agg.drain_all()
    };
    eprintln!(
        "[tape-worker] draining {} open cell(s) before exit",
        drained.len()
    );
    for frame in drained {
        let bridge_frame = outbound_to_bridge(frame);
        let _ = out_tx.send(bridge_frame).await;
    }
    let _ = out_tx
        .send(BridgeFrame::WorkerUnavailable(WorkerUnavailable {
            reason: "shutdown".into(),
        }))
        .await;

    // Drop the sender so the writer's recv() returns None and it can
    // flush its tail.
    drop(out_tx);

    shutdown.notify_waiters();
    let _ = tokio::join!(rollover_task, signal_handle);
    if let Err(err) = writer_task.await {
        eprintln!("[tape-worker] writer task join error: {err}");
    }

    // POSIX socket cleanup so the next supervisor restart can re-bind
    // the path without a stale-file collision. Named pipes on Windows
    // free when the handle drops.
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(&path);
    }

    eprintln!("[tape-worker] exited cleanly");
    Ok(())
}

fn bind_listener(path: &str) -> Result<interprocess::local_socket::tokio::Listener> {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(path);
    }
    let name = path
        .to_fs_name::<GenericFilePath>()
        .with_context(|| format!("convert path {path}"))?;
    let listener = ListenerOptions::new().name(name).create_tokio()?;
    Ok(listener)
}

/// Inbound reader — decodes framed payloads, dispatches to the
/// aggregator or to control handling.
async fn run_inbound_reader<R>(
    mut reader: R,
    aggregator: Arc<Mutex<Aggregator>>,
    out_tx: mpsc::Sender<BridgeFrame>,
    shutdown: Arc<Notify>,
) -> Result<()>
where
    R: AsyncReadExt + Unpin,
{
    let mut parse_errors: u64 = 0;
    loop {
        tokio::select! {
            biased;
            () = shutdown.notified() => return Ok(()),
            frame = read_frame(&mut reader) => {
                match frame {
                    Ok(Some(payload)) => {
                        match rmp_serde::from_slice::<BridgeFrame>(&payload) {
                            Ok(parsed) => {
                                handle_inbound(parsed, &aggregator, &out_tx, &shutdown).await;
                            }
                            Err(err) => {
                                parse_errors += 1;
                                eprintln!(
                                    "[tape-worker] parse error #{parse_errors}: {err}"
                                );
                            }
                        }
                    }
                    Ok(None) => {
                        eprintln!("[tape-worker] bridge closed by peer (clean EOF)");
                        shutdown.notify_waiters();
                        return Ok(());
                    }
                    Err(err) => {
                        eprintln!("[tape-worker] inbound read error: {err}");
                        shutdown.notify_waiters();
                        return Err(err);
                    }
                }
            }
        }
    }
}

async fn handle_inbound(
    frame: BridgeFrame,
    aggregator: &Arc<Mutex<Aggregator>>,
    out_tx: &mpsc::Sender<BridgeFrame>,
    shutdown: &Arc<Notify>,
) {
    match frame {
        BridgeFrame::Tick(tick) => {
            let outbound = {
                let mut agg = aggregator.lock().await;
                agg.on_tick(tick)
            };
            for frame in outbound {
                send_or_drop(out_tx, outbound_to_bridge(frame));
            }
        }
        BridgeFrame::Control(cmd) => match cmd.kind {
            ControlKind::Snapshot => {
                let payload = {
                    let agg = aggregator.lock().await;
                    agg.snapshot()
                };
                // Snapshot must never drop — use the awaiting send.
                let _ = out_tx.send(BridgeFrame::Snapshot(payload)).await;
            }
            ControlKind::Shutdown => {
                eprintln!("[tape-worker] received Shutdown control");
                shutdown.notify_waiters();
            }
            ControlKind::Pause | ControlKind::Resume => {
                // v1 no-op. v2 may suspend the aggregator on Pause for
                // a replay-seek scenario; not load-bearing today.
            }
        },
        // Outbound variants on the inbound channel are protocol violations.
        BridgeFrame::WorkerReady(_)
        | BridgeFrame::WorkerUnavailable(_)
        | BridgeFrame::CellDelta(_)
        | BridgeFrame::CellClose(_)
        | BridgeFrame::Snapshot(_) => {
            eprintln!(
                "[tape-worker] received outbound-kind frame on inbound channel; ignoring",
            );
        }
    }
}

/// Try to send `frame` on the outbound channel without blocking. Drop
/// oldest-style policy is approximated as "drop the incoming delta if
/// the channel is full"; cell.close / snapshot / control frames are
/// sent through the awaiting path elsewhere.
fn send_or_drop(out_tx: &mpsc::Sender<BridgeFrame>, frame: BridgeFrame) {
    match out_tx.try_send(frame) {
        Ok(()) => {}
        Err(mpsc::error::TrySendError::Full(_)) => {
            eprintln!(
                "[tape-worker] outbound channel full ({OUTBOUND_CHANNEL_CAP}); dropping delta",
            );
        }
        Err(mpsc::error::TrySendError::Closed(_)) => {
            // Writer task exited; nothing more we can do.
        }
    }
}

fn outbound_to_bridge(frame: OutboundFrame) -> BridgeFrame {
    match frame {
        OutboundFrame::Delta(d) => BridgeFrame::CellDelta(d),
        OutboundFrame::Close(c) => BridgeFrame::CellClose(c),
    }
}

/// Outbound writer — receives BridgeFrames, encodes, writes to the
/// bridge. Drops out on channel-closed (clean shutdown) or write error.
async fn run_outbound_writer<W>(mut writer: W, mut rx: mpsc::Receiver<BridgeFrame>) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    while let Some(frame) = rx.recv().await {
        let bytes = match rmp_serde::to_vec_named(&frame) {
            Ok(b) => b,
            Err(err) => {
                eprintln!("[tape-worker] encode error: {err}");
                continue;
            }
        };
        if let Err(err) = write_frame(&mut writer, &bytes).await {
            eprintln!("[tape-worker] write error: {err}");
            return Err(err);
        }
        if let Err(err) = writer.flush().await {
            eprintln!("[tape-worker] flush error: {err}");
            return Err(err.into());
        }
    }
    Ok(())
}

/// Bar-rollover timer — wakes every 1 s, asks the aggregator to close
/// every expired bar, ships the resulting `cell.close` frames. Drop
/// policy never applies to cell.close per ADR-006.
async fn run_rollover_timer(
    aggregator: Arc<Mutex<Aggregator>>,
    out_tx: mpsc::Sender<BridgeFrame>,
    shutdown: Arc<Notify>,
) -> Result<()> {
    let mut ticker = tokio::time::interval(ROLLOVER_TICK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            () = shutdown.notified() => return Ok(()),
            _ = ticker.tick() => {
                let now = now_ms();
                let closes = {
                    let mut agg = aggregator.lock().await;
                    agg.close_expired(now)
                };
                for frame in closes {
                    let bridge_frame = outbound_to_bridge(frame);
                    if out_tx.send(bridge_frame).await.is_err() {
                        shutdown.notify_waiters();
                        return Ok(());
                    }
                }
            }
        }
    }
}

async fn spawn_signal_listener(shutdown: Arc<Notify>) {
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
        () = term => eprintln!("[tape-worker] SIGTERM received"),
        () = ctrlc => eprintln!("[tape-worker] Ctrl-C / SIGINT received"),
        () = shutdown.notified() => return,
    }
    shutdown.notify_waiters();
}

// Suppress the unused-import warning for `LocalSocketStream` on
// platforms where the type is re-resolved through trait methods only.
#[allow(dead_code)]
fn _stream_type_anchor(_s: Option<LocalSocketStream>) {}
