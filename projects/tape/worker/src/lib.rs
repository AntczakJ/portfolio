//! tape-worker — Rust hot-path worker library.
//!
//! Task 1.4b shipped the bridge payload types + ts-rs codegen pipeline;
//! Task 1.4a added the transport scaffold (length-prefixed framing over
//! UDS / named pipe) consumed by the placeholder echo binary. Task 1.5
//! adds the real `worker` binary alongside `echo`, the cell aggregator,
//! and the bucketing helpers; both binaries link this library.
//!
//! Module layout:
//!  - `bridge::messages`   — payload types shared with the Elysia control
//!    plane via MessagePack per ADR-002 + ADR-003.
//!  - `bridge::transport`  — length-prefixed framing reader / writer and
//!    the cross-platform endpoint-path resolver.
//!  - `bucketing`          — time + price bucket constants and pure
//!    helpers (policy, not schema; see `bucketing.rs`).
//!  - `aggregator`         — pure-ish footprint cell aggregator state
//!    machine — `on_tick`, `close_expired`, `snapshot`, `drain_all`.

pub mod aggregator;
pub mod bridge;
pub mod bucketing;
