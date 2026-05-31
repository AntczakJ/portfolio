/**
 * Bridge payload types — barrel re-export of the ts-rs generated types.
 *
 * The `./generated/` directory is written by `cargo test` in
 * `projects/tape/worker/` from the Rust structs annotated `#[derive(TS)]`.
 * Those files are the schema source of truth per ADR-003; this barrel
 * is the stable import path the rest of the server reaches for so future
 * consumers do not bake the per-file paths into call sites.
 *
 * Regenerate via `pnpm -F tape-server bridge:generate`. CI gates
 * `pnpm -F tape-server bridge:check` and fails if the generated tree
 * is stale.
 *
 * `ts-rs` maps Rust `i64` to TypeScript `bigint` (JS `number` cannot
 * carry the full i64 range without precision loss). MessagePack on the
 * wire encodes these in its int family natively. Decoded values arrive
 * as `bigint` on the Bun side via `msgpackr` — callers do millisecond
 * arithmetic with `BigInt(...)` literals or coerce at the boundary they
 * own.
 */

export type { Aggressor } from './generated/Aggressor';
export type { TickFrame } from './generated/TickFrame';
export type { CellSnapshot } from './generated/CellSnapshot';
export type { ControlKind } from './generated/ControlKind';
export type { ControlCommand } from './generated/ControlCommand';
// Task 1.5 outbound shapes — the worker emits these back over the
// bridge. The Elysia supervisor decodes them and promotes them into
// the public WS frame envelope (per ADR-006).
export type { BridgeFrame } from './generated/BridgeFrame';
export type { CellDelta } from './generated/CellDelta';
export type { CellClose } from './generated/CellClose';
export type { SnapshotPayload } from './generated/SnapshotPayload';
export type { WorkerReady } from './generated/WorkerReady';
export type { WorkerUnavailable } from './generated/WorkerUnavailable';
