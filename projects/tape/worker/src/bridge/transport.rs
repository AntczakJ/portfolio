//! Length-prefixed binary framing over UDS / named pipe — Task 1.4a per
//! ADR-002.
//!
//! Wire format mirrors `projects/tape/server/src/lib/bridge/frame.ts`:
//!
//! ```text
//! ┌──────────────────────┬────────────────────┐
//! │ u32 LE length (4 B)  │ payload (`length`) │
//! └──────────────────────┴────────────────────┘
//! ```
//!
//! The payload is opaque to this layer — typically MessagePack from
//! `rmp-serde`. Framing is the transport's only contract; the
//! Elysia-side `FrameReader` in TypeScript decodes the same shape.
//!
//! Used by the placeholder echo binary in `src/bin/echo.rs` and (in
//! Task 1.5) by the real worker. The shape is symmetrical: read one
//! frame, encode one frame, the surface in both directions is
//! `read_frame` / `write_frame`.

use std::io;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Hard cap on the decoded frame size. Anything larger is treated as a
/// desync (length prefix being read out of a payload by mistake) and
/// the read path errors. 1 MiB matches the TypeScript `FrameReader`
/// default in `projects/tape/server/src/lib/bridge/config.ts`; do not
/// shift one side without shifting the other.
pub const MAX_FRAME_BYTES: u32 = 1024 * 1024;

const LENGTH_PREFIX_BYTES: usize = 4;

/// Read one complete frame from `reader`, returning its payload bytes.
///
/// Returns `Ok(None)` on a clean EOF before any bytes are read — the
/// expected indication that the peer closed the connection between
/// frames. Returns `Err` on a partial frame (EOF mid-payload), an
/// oversized length prefix, or any other I/O failure.
pub async fn read_frame<R>(reader: &mut R) -> anyhow::Result<Option<Vec<u8>>>
where
    R: AsyncReadExt + Unpin,
{
    let mut len_buf = [0u8; LENGTH_PREFIX_BYTES];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => {
            return Ok(None);
        }
        Err(err) => return Err(err.into()),
    }
    let length = u32::from_le_bytes(len_buf);
    if length > MAX_FRAME_BYTES {
        anyhow::bail!(
            "bridge frame too large: {} bytes > {} cap (likely desync)",
            length,
            MAX_FRAME_BYTES
        );
    }
    let mut payload = vec![0u8; length as usize];
    reader.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

/// Encode `payload` as a length-prefixed frame and write it to `writer`.
/// Does not flush — the caller batches flushes when it makes sense.
pub async fn write_frame<W>(writer: &mut W, payload: &[u8]) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    if payload.len() > MAX_FRAME_BYTES as usize {
        anyhow::bail!(
            "bridge frame too large to encode: {} bytes > {} cap",
            payload.len(),
            MAX_FRAME_BYTES
        );
    }
    #[allow(clippy::cast_possible_truncation)]
    let len = payload.len() as u32;
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(payload).await?;
    Ok(())
}

/// Resolve the bridge endpoint path, mirroring the TypeScript
/// `defaultBridgePath` in `projects/tape/server/src/lib/bridge/path.ts`.
///
/// 1. `BRIDGE_PATH` env override wins when set.
/// 2. On Windows, default to `\\.\pipe\tape-bridge`.
/// 3. On Linux / macOS, default to `/tmp/tape-bridge.sock`.
///
/// The resolved value passes through [`normalize_bridge_path`] so a
/// Windows named-pipe path that lost its leading backslash during a
/// `Bun.spawn` env round-trip is repaired before the `interprocess`
/// listener rejects it.
pub fn default_bridge_path() -> String {
    let raw = match std::env::var("BRIDGE_PATH") {
        Ok(path) if !path.is_empty() => path,
        _ => default_bridge_path_for_os(),
    };
    normalize_bridge_path(&raw)
}

fn default_bridge_path_for_os() -> String {
    if cfg!(windows) {
        String::from(r"\\.\pipe\tape-bridge")
    } else {
        String::from("/tmp/tape-bridge.sock")
    }
}

/// Repair a Windows named-pipe path whose leading `\\` was collapsed to
/// a single `\` while crossing a process boundary.
///
/// **Why this exists.** Bun's `Bun.spawn` on Windows collapses every
/// `\\` in an inherited env value to a single `\` before handing it to
/// the child (verified empirically: the supervisor passes
/// `\\.\pipe\tape-bridge` in `process.env`, the worker's
/// `std::env::var("BRIDGE_PATH")` reads back `\.\pipe\tape-bridge`).
/// The `interprocess` crate's named-pipe `is_pipefs` check requires the
/// canonical `\\HOST\pipe\NAME` form, so the collapsed value is rejected
/// with "not a named pipe path" and the worker cannot bind — breaking
/// the entire supervised pipeline on the owner's Windows dev machine.
///
/// The repair is unambiguous: a local Windows pipe path is always
/// `\\.\pipe\<name>` (local host `.`). If we see the collapsed
/// `\.\pipe\` or the further-collapsed `.\pipe\` at the start, we
/// restore the canonical `\\.\pipe\` prefix. Non-pipe paths (POSIX UDS,
/// already-canonical pipe paths) pass through untouched, so this is a
/// no-op on Linux and on any correctly-formed input.
pub fn normalize_bridge_path(path: &str) -> String {
    // Already canonical (`\\.\pipe\...` or `\\host\pipe\...`) — leave it.
    if path.starts_with(r"\\") {
        return path.to_string();
    }
    // Collapsed local-pipe form: `\.\pipe\name` → `\\.\pipe\name`.
    if let Some(rest) = path.strip_prefix(r"\.\pipe\") {
        return format!(r"\\.\pipe\{rest}");
    }
    // Further-collapsed / host-form: `.\pipe\name` → `\\.\pipe\name`.
    if let Some(rest) = path.strip_prefix(r".\pipe\") {
        return format!(r"\\.\pipe\{rest}");
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[tokio::test]
    async fn round_trip_one_frame() {
        let (mut tx, mut rx) = tokio::io::duplex(64);
        let payload = b"hello bridge";
        write_frame(&mut tx, payload).await.expect("write_frame");
        tx.flush().await.expect("flush");
        let received = read_frame(&mut rx)
            .await
            .expect("read_frame")
            .expect("frame present");
        assert_eq!(received.as_slice(), payload);
    }

    #[tokio::test]
    async fn round_trip_multiple_frames() {
        let (mut tx, mut rx) = tokio::io::duplex(256);
        let frames: [&[u8]; 3] = [b"one", b"two-second", b"three-and-final"];
        for frame in frames {
            write_frame(&mut tx, frame).await.expect("write_frame");
        }
        tx.flush().await.expect("flush");
        for expected in frames {
            let received = read_frame(&mut rx)
                .await
                .expect("read_frame")
                .expect("frame present");
            assert_eq!(received.as_slice(), expected);
        }
    }

    #[tokio::test]
    async fn clean_eof_returns_none() {
        let (tx, mut rx) = tokio::io::duplex(8);
        drop(tx);
        let received = read_frame(&mut rx).await.expect("read_frame");
        assert!(received.is_none());
    }

    #[tokio::test]
    async fn oversized_length_prefix_errors() {
        let (mut tx, mut rx) = tokio::io::duplex(16);
        let bogus_length: u32 = MAX_FRAME_BYTES + 1;
        tx.write_all(&bogus_length.to_le_bytes())
            .await
            .expect("write prefix");
        tx.flush().await.expect("flush");
        let err = read_frame(&mut rx).await.expect_err("must error");
        assert!(err.to_string().contains("too large"));
    }

    #[test]
    fn normalize_repairs_collapsed_windows_pipe_path() {
        // The exact corruption a `Bun.spawn` env round-trip produces on
        // Windows: `\\.\pipe\tape-bridge` arrives as `\.\pipe\tape-bridge`.
        assert_eq!(
            normalize_bridge_path(r"\.\pipe\tape-bridge"),
            r"\\.\pipe\tape-bridge"
        );
        // A doubly-collapsed / host-form variant is also repaired.
        assert_eq!(
            normalize_bridge_path(r".\pipe\tape-bridge-e2e"),
            r"\\.\pipe\tape-bridge-e2e"
        );
    }

    #[test]
    fn normalize_leaves_canonical_and_posix_paths_untouched() {
        // Already-canonical pipe path passes through.
        assert_eq!(
            normalize_bridge_path(r"\\.\pipe\tape-bridge"),
            r"\\.\pipe\tape-bridge"
        );
        // POSIX UDS path is not a pipe path — untouched.
        assert_eq!(
            normalize_bridge_path("/tmp/tape-bridge.sock"),
            "/tmp/tape-bridge.sock"
        );
    }
}
