//! Bridge payload schemas — single source of truth.
//!
//! Each public struct / enum here is the canonical definition of a frame
//! that crosses the Rust ↔ Bun bridge. The TypeScript counterparts under
//! `projects/tape/server/src/lib/schemas/bridge/generated/` are produced
//! by `ts-rs` from these types via `cargo test`. Do **NOT** hand-edit the
//! generated files; regenerate via `pnpm -F tape-server bridge:generate`.
//!
//! ## Backward-compatibility rule (ADR-003, binding on every PR)
//!
//! New fields **MUST** be `Option<T>` and carry
//! `#[serde(default, skip_serializing_if = "Option::is_none")]`. ts-rs
//! marks them optional on the TypeScript side automatically. Field keys
//! are **never renamed and never removed** in place — deprecate by
//! adding the replacement as `Option<T>`, dual-write for one release,
//! switch readers to the new field, then remove in a follow-up release.
//! MessagePack maps are unordered on the wire; never introduce a manual
//! `Serialize` impl that emits a fixed order and assume the decoder
//! respects it.
//!
//! ## Frame catalogue (v1)
//!
//! Inbound to worker (Elysia → Rust):
//!   - `TickFrame`        — one aggregated trade event from Binance.
//!   - `ControlCommand`   — out-of-band lifecycle (Pause/Resume/Snapshot/Shutdown).
//!
//! Outbound from worker (Rust → Elysia):
//!   - `WorkerReady`        — handshake on connect, signals "I accept ticks".
//!   - `WorkerUnavailable`  — pre-shutdown notice carrying a reason string.
//!   - `CellDelta`          — mid-bar additive mutation on one cell.
//!   - `CellClose`          — bar-boundary absolute totals for one closed cell.
//!   - `SnapshotPayload`    — full open-bar state, sent on Snapshot command.
//!
//! All five outbound shapes are carried by the `BridgeFrame` discriminated
//! union (serde-tagged) so a single decode dispatches by `kind`. Task 1.5b
//! locked the wire contract for `TickFrame`, `CellSnapshot` (legacy name
//! retained for one release of fixtures), `ControlCommand`; Task 1.5
//! extends the contract with the five new outbound types and adds matching
//! fixtures under `server/src/lib/schemas/bridge/fixtures/`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Each struct/enum below is annotated `#[ts(export)]` without an
// `export_to` path: the destination is pinned globally by
// `worker/.cargo/config.toml` via `TS_RS_EXPORT_DIR =
// "../server/src/lib/schemas/bridge/generated"`. ts-rs 10 resolves
// `export_to` paths relative to `TS_RS_EXPORT_DIR` (default
// `./bindings`); a per-type `export_to = "../server/..."` traverses out
// of the bindings root and lands files in unexpected places on Windows.
// Pinning the env var is portable across hosts and keeps the
// destination one edit away if it ever needs to move.

/// Aggressor side of a single trade.
///
/// Maps Binance Futures' `aggTrade.m` flag — `true` means the buyer was
/// the maker, i.e. the aggressor is the **seller**.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS)]
#[ts(export)]
pub enum Aggressor {
    Buy,
    Sell,
}

/// Normalised tick frame — one aggregated trade event on the wire.
///
/// `ts_ms` is Binance's `E` event timestamp coerced to a signed i64 in
/// milliseconds (signed because MessagePack's int family covers the
/// signed range natively and avoids the `u64` round-trip wart on
/// some decoders).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export)]
pub struct TickFrame {
    pub ts_ms: i64,
    pub symbol: String,
    pub price: f64,
    pub qty: f64,
    pub aggressor: Aggressor,
}

/// Snapshot of one footprint cell — the bid / ask volume bucketed by
/// price within a single 1-minute bar.
///
/// Retained from Task 1.4b for backward compatibility with the locked
/// 1.5b fixtures (`cell.min`, `cell.peak`). The Task 1.5 outbound flow
/// uses `CellDelta` / `CellClose` / `SnapshotPayload` rather than this
/// shape — `CellSnapshot` is no longer on the live wire but still ships
/// as a payload type so the existing conformance fixtures stay green.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export)]
pub struct CellSnapshot {
    pub ts_ms: i64,
    pub symbol: String,
    pub price_bucket: i64,
    pub bid_volume: f64,
    pub ask_volume: f64,
    pub trades: u32,
}

/// Kind of out-of-band control command Elysia sends to the worker.
///
/// Kept as a flat enum (not data-carrying) so the encoding stays a
/// single MessagePack string on the wire. Future commands that need
/// arguments (e.g. `Subscribe { symbol }`) should land as a separate
/// data-carrying enum rather than mutating this one — see the
/// backward-compat rule above.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS)]
#[ts(export)]
pub enum ControlKind {
    Pause,
    Resume,
    Snapshot,
    Shutdown,
}

/// Control command envelope.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS)]
#[ts(export)]
pub struct ControlCommand {
    pub kind: ControlKind,
}

// ---------------------------------------------------------------------------
// Task 1.5 — outbound frame shapes
// ---------------------------------------------------------------------------

/// Mid-bar additive mutation on the worker's current bar state.
///
/// Matches the Elysia-side `wsCellDeltaPayloadSchema` field-name
/// invariant (ADR-005 + ADR-006): the delta fields end in `_delta` so a
/// future hexdump reader can distinguish the mid-bar shape from the
/// absolute-totals shape without checking the discriminator. Within v1
/// the worker emits one of these per `(symbol, bucket_ts, price_bucket)`
/// per coalescing window — by construction, every field carries a
/// non-negative value.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export)]
pub struct CellDelta {
    pub ts_ms: i64,
    pub symbol: String,
    pub bucket_ts: i64,
    pub price_bucket: i64,
    pub bid_volume_delta: f64,
    pub ask_volume_delta: f64,
    pub trades_delta: u32,
}

/// Absolute totals for a now-closed cell at the bar boundary.
///
/// Carries the same shape (post-renaming) as the persisted
/// `footprint_cells` row, but the schemas are independent — Drizzle
/// owns the row type, ts-rs owns the bridge type. Same shape as the
/// Elysia-side `wsCellClosePayloadSchema`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export)]
pub struct CellClose {
    pub ts_ms: i64,
    pub symbol: String,
    pub bucket_ts: i64,
    pub price_bucket: i64,
    pub bid_volume: f64,
    pub ask_volume: f64,
    pub trades: u32,
}

/// Full open-bar snapshot — emitted on `ControlCommand { kind: Snapshot }`
/// and on supervisor poll. Carries every currently-open cell across every
/// symbol the worker is aggregating, plus the per-symbol session extremes
/// the renderer uses for intensity scaling.
///
/// The `cells_open` array is a flat list of `CellDelta` values (one per
/// open `(symbol, bucket_ts, price_bucket)`), where the `_delta` fields
/// carry the running absolute totals for the open bar. Naming the field
/// `cells_open` mirrors the Elysia snapshot frame's `cellsOpen` so the
/// supervisor can promote bridge snapshots into WS snapshots without a
/// renaming pass.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export)]
pub struct SnapshotPayload {
    pub ts_ms: i64,
    pub cells_open: Vec<CellDelta>,
    pub ticks_processed: u64,
}

/// Handshake frame — worker → Elysia on successful connect.
///
/// Per ADR-004, the supervisor flips `BridgeClient` state to `connected`
/// only after this frame arrives within the configured timeout (5 s).
/// Carries the worker's process id as a debug aid and the generation
/// counter for supervisor log correlation. Both are advisory — the
/// supervisor does NOT use these for restart decisions.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS)]
#[ts(export)]
pub struct WorkerReady {
    pub pid: u32,
    pub generation: u32,
}

/// Pre-shutdown notice — worker → Elysia just before exit.
///
/// Sent on `ControlCommand { kind: Shutdown }` (clean) or on SIGTERM
/// (graceful). Lets the supervisor emit a `control.worker_unavailable`
/// frame on the public WS before the bridge connection drops, so the
/// browser shows a calm indicator instead of a hard disconnect spinner.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS)]
#[ts(export)]
pub struct WorkerUnavailable {
    pub reason: String,
}

/// Discriminated union of every frame that crosses the bridge in either
/// direction. Tagged on `kind` so a single `rmp_serde::from_slice::<BridgeFrame>`
/// decodes any frame the receiver might see; the consumer matches on the
/// variant and dispatches.
///
/// The serde tag is `kind` (not `type`) to match the Elysia-side WS
/// envelope vocabulary (`{ topic, kind, payload }`) — one mental model
/// across the project per ADR-006.
///
/// The variant names mirror the inbound / outbound payload types one-to-
/// one. `Tick` and `Control` carry the inbound payload; `WorkerReady`,
/// `WorkerUnavailable`, `CellDelta`, `CellClose`, and `Snapshot` carry
/// the outbound payloads.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[serde(tag = "kind", content = "payload")]
#[ts(export)]
pub enum BridgeFrame {
    /// Inbound — Elysia → worker. One aggregated trade event.
    #[serde(rename = "tick")]
    Tick(TickFrame),
    /// Inbound — Elysia → worker. Out-of-band control command.
    #[serde(rename = "control")]
    Control(ControlCommand),
    /// Outbound — worker → Elysia. Handshake on connect.
    #[serde(rename = "worker_ready")]
    WorkerReady(WorkerReady),
    /// Outbound — worker → Elysia. Pre-shutdown notice.
    #[serde(rename = "worker_unavailable")]
    WorkerUnavailable(WorkerUnavailable),
    /// Outbound — worker → Elysia. Mid-bar cell mutation.
    #[serde(rename = "cell.delta")]
    CellDelta(CellDelta),
    /// Outbound — worker → Elysia. Bar-boundary absolute totals.
    #[serde(rename = "cell.close")]
    CellClose(CellClose),
    /// Outbound — worker → Elysia. Full open-bar state on Snapshot command.
    #[serde(rename = "snapshot")]
    Snapshot(SnapshotPayload),
}
