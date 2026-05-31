//! Bridge layer — message types + transport scaffold.
//!
//! Everything that travels the Rust ↔ Bun bridge (MessagePack on
//! UDS / named pipe per ADR-002 / ADR-003) is declared in `messages`,
//! and the framed read/write helpers + path resolver live in
//! `transport`. Both are re-exported here so callers can
//! `use tape_worker::bridge::*;`.

pub mod messages;
pub mod transport;

pub use messages::*;
pub use transport::{default_bridge_path, read_frame, write_frame, MAX_FRAME_BYTES};
