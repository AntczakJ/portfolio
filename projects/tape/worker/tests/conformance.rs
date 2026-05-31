//! Bridge conformance test — Task 1.5b per ADR-003.
//!
//! Locks the Rust ↔ Bun frame contract at the byte level from the
//! Rust side. Each fixture is verified twice:
//!
//!   1. `<name>.msgpack` (canonical rmp-serde-encoded bytes) decodes
//!      to the expected struct literal — proves the Rust decoder
//!      accepts the bytes the Rust worker itself will write on the
//!      live bridge.
//!   2. `<name>.from-ts.msgpack` (msgpackr-encoded bytes captured
//!      from the Bun side, committed alongside the Rust oracle)
//!      decodes to the same struct literal — proves the Rust
//!      decoder accepts the bytes the Elysia control plane will
//!      write on the live bridge.
//!
//! The encode-side determinism check (`rmp-serde encode produces
//! exactly `<name>.msgpack`") is owned by `src/bin/gen-fixtures.rs`
//! and runs every time the dev regenerates the oracle. Duplicating
//! it here would couple the integration test to the fixture
//! regeneration cadence; the conformance test's job is to lock the
//! decode-side contract — bridge bytes from EITHER side decode to
//! the same logical value on this side.
//!
//! `gen-fixtures` is the regeneration command (dev-time, NOT CI):
//!   cd projects/tape/worker && cargo run --bin gen-fixtures
//!
//! Run via `cargo test` in `projects/tape/worker/`.
//!
//! Integration tests live under `tests/` (not `src/bridge/`) because
//! (a) they exercise only the public bridge API and own no internal
//! types, (b) Rust convention puts cross-module / cross-crate flow
//! tests under `tests/`, and (c) compile-time isolation from the
//! library catches accidental private-API leaks in the conformance
//! surface.

use std::fs;
use std::path::PathBuf;

use tape_worker::bridge::messages::{
    Aggressor, CellClose, CellDelta, CellSnapshot, ControlCommand, ControlKind, SnapshotPayload,
    TickFrame, WorkerReady, WorkerUnavailable,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server")
        .join("src")
        .join("lib")
        .join("schemas")
        .join("bridge")
        .join("fixtures")
}

fn read_oracle(name: &str) -> Vec<u8> {
    let path = fixtures_dir().join(format!("{name}.msgpack"));
    fs::read(&path)
        .unwrap_or_else(|e| panic!("read canonical fixture {}: {}", path.display(), e))
}

fn read_from_ts(name: &str) -> Vec<u8> {
    let path = fixtures_dir().join(format!("{name}.from-ts.msgpack"));
    fs::read(&path)
        .unwrap_or_else(|e| panic!("read from-ts fixture {}: {}", path.display(), e))
}

fn decode_tick(bytes: &[u8]) -> TickFrame {
    rmp_serde::from_slice::<TickFrame>(bytes).expect("decode TickFrame")
}

fn decode_cell(bytes: &[u8]) -> CellSnapshot {
    rmp_serde::from_slice::<CellSnapshot>(bytes).expect("decode CellSnapshot")
}

fn decode_control(bytes: &[u8]) -> ControlCommand {
    rmp_serde::from_slice::<ControlCommand>(bytes).expect("decode ControlCommand")
}

fn decode_delta(bytes: &[u8]) -> CellDelta {
    rmp_serde::from_slice::<CellDelta>(bytes).expect("decode CellDelta")
}

fn decode_close(bytes: &[u8]) -> CellClose {
    rmp_serde::from_slice::<CellClose>(bytes).expect("decode CellClose")
}

fn decode_snapshot(bytes: &[u8]) -> SnapshotPayload {
    rmp_serde::from_slice::<SnapshotPayload>(bytes).expect("decode SnapshotPayload")
}

fn decode_ready(bytes: &[u8]) -> WorkerReady {
    rmp_serde::from_slice::<WorkerReady>(bytes).expect("decode WorkerReady")
}

fn decode_unavailable(bytes: &[u8]) -> WorkerUnavailable {
    rmp_serde::from_slice::<WorkerUnavailable>(bytes).expect("decode WorkerUnavailable")
}

#[test]
fn tick_min_decodes_from_both_sides() {
    let expected = TickFrame {
        ts_ms: 1,
        symbol: String::from("BTC"),
        price: 0.5,
        qty: 0.5,
        aggressor: Aggressor::Buy,
    };
    assert_eq!(decode_tick(&read_oracle("tick.min")), expected);
    assert_eq!(decode_tick(&read_from_ts("tick.min")), expected);
}

#[test]
fn tick_typical_decodes_from_both_sides() {
    let expected = TickFrame {
        ts_ms: 1_717_000_000_000,
        symbol: String::from("BTCUSDT"),
        price: 71_234.5,
        qty: 0.125,
        aggressor: Aggressor::Sell,
    };
    assert_eq!(decode_tick(&read_oracle("tick.typical")), expected);
    assert_eq!(decode_tick(&read_from_ts("tick.typical")), expected);
}

#[test]
fn cell_min_decodes_from_both_sides() {
    let expected = CellSnapshot {
        ts_ms: 1,
        symbol: String::from("BTC"),
        price_bucket: 1,
        bid_volume: 0.5,
        ask_volume: 0.5,
        trades: 1,
    };
    assert_eq!(decode_cell(&read_oracle("cell.min")), expected);
    assert_eq!(decode_cell(&read_from_ts("cell.min")), expected);
}

#[test]
fn cell_peak_decodes_from_both_sides() {
    let expected = CellSnapshot {
        ts_ms: 1_717_000_060_000,
        symbol: String::from("BTCUSDT"),
        price_bucket: 71_235,
        bid_volume: 5_421.75,
        ask_volume: 6_310.25,
        trades: 847,
    };
    assert_eq!(decode_cell(&read_oracle("cell.peak")), expected);
    assert_eq!(decode_cell(&read_from_ts("cell.peak")), expected);
}

#[test]
fn control_pause_decodes_from_both_sides() {
    let expected = ControlCommand {
        kind: ControlKind::Pause,
    };
    assert_eq!(decode_control(&read_oracle("control.pause")), expected);
    assert_eq!(decode_control(&read_from_ts("control.pause")), expected);
}

#[test]
fn control_snapshot_decodes_from_both_sides() {
    let expected = ControlCommand {
        kind: ControlKind::Snapshot,
    };
    assert_eq!(decode_control(&read_oracle("control.snapshot")), expected);
    assert_eq!(decode_control(&read_from_ts("control.snapshot")), expected);
}

#[test]
fn cell_delta_typical_decodes_from_both_sides() {
    let expected = CellDelta {
        ts_ms: 1_717_000_000_500,
        symbol: String::from("BTCUSDT-PERP"),
        bucket_ts: 1_717_000_000_000,
        price_bucket: 14_247,
        bid_volume_delta: 0.5,
        ask_volume_delta: 0.25,
        trades_delta: 1,
    };
    assert_eq!(decode_delta(&read_oracle("cell.delta.typical")), expected);
    assert_eq!(decode_delta(&read_from_ts("cell.delta.typical")), expected);
}

#[test]
fn cell_close_typical_decodes_from_both_sides() {
    let expected = CellClose {
        ts_ms: 1_717_000_060_000,
        symbol: String::from("BTCUSDT-PERP"),
        bucket_ts: 1_717_000_000_000,
        price_bucket: 14_247,
        bid_volume: 5_421.75,
        ask_volume: 6_310.25,
        trades: 847,
    };
    assert_eq!(decode_close(&read_oracle("cell.close.typical")), expected);
    assert_eq!(decode_close(&read_from_ts("cell.close.typical")), expected);
}

#[test]
fn snapshot_typical_decodes_from_both_sides() {
    let expected = SnapshotPayload {
        ts_ms: 1_717_000_030_500,
        cells_open: vec![CellDelta {
            ts_ms: 1_717_000_030_500,
            symbol: String::from("BTCUSDT-PERP"),
            bucket_ts: 1_717_000_000_000,
            price_bucket: 14_247,
            bid_volume_delta: 2.5,
            ask_volume_delta: 3.25,
            trades_delta: 41,
        }],
        ticks_processed: 12_345,
    };
    assert_eq!(
        decode_snapshot(&read_oracle("snapshot.typical")),
        expected
    );
    assert_eq!(
        decode_snapshot(&read_from_ts("snapshot.typical")),
        expected
    );
}

#[test]
fn worker_ready_decodes_from_both_sides() {
    let expected = WorkerReady {
        pid: 4_242,
        generation: 1,
    };
    assert_eq!(decode_ready(&read_oracle("worker.ready")), expected);
    assert_eq!(decode_ready(&read_from_ts("worker.ready")), expected);
}

#[test]
fn worker_unavailable_decodes_from_both_sides() {
    let expected = WorkerUnavailable {
        reason: String::from("shutdown"),
    };
    assert_eq!(
        decode_unavailable(&read_oracle("worker.unavailable")),
        expected
    );
    assert_eq!(
        decode_unavailable(&read_from_ts("worker.unavailable")),
        expected
    );
}

#[test]
fn rust_encode_byte_matches_canonical_oracle() {
    // Locks rmp-serde determinism: the bytes we write today are the
    // bytes we will write tomorrow, given the same struct definition
    // and the same `with_struct_map()` configuration. A failure
    // here means either the struct shape drifted without regenerating
    // the fixtures (run `cargo run --bin gen-fixtures`) or the
    // serializer configuration drifted.
    let fixtures: [(&str, Vec<u8>); 11] = [
        ("tick.min", encode_tick(&TickFrame {
            ts_ms: 1,
            symbol: String::from("BTC"),
            price: 0.5,
            qty: 0.5,
            aggressor: Aggressor::Buy,
        })),
        ("tick.typical", encode_tick(&TickFrame {
            ts_ms: 1_717_000_000_000,
            symbol: String::from("BTCUSDT"),
            price: 71_234.5,
            qty: 0.125,
            aggressor: Aggressor::Sell,
        })),
        ("cell.min", encode_cell(&CellSnapshot {
            ts_ms: 1,
            symbol: String::from("BTC"),
            price_bucket: 1,
            bid_volume: 0.5,
            ask_volume: 0.5,
            trades: 1,
        })),
        ("cell.peak", encode_cell(&CellSnapshot {
            ts_ms: 1_717_000_060_000,
            symbol: String::from("BTCUSDT"),
            price_bucket: 71_235,
            bid_volume: 5_421.75,
            ask_volume: 6_310.25,
            trades: 847,
        })),
        ("control.pause", encode_control(&ControlCommand {
            kind: ControlKind::Pause,
        })),
        ("control.snapshot", encode_control(&ControlCommand {
            kind: ControlKind::Snapshot,
        })),
        ("cell.delta.typical", encode_named(&CellDelta {
            ts_ms: 1_717_000_000_500,
            symbol: String::from("BTCUSDT-PERP"),
            bucket_ts: 1_717_000_000_000,
            price_bucket: 14_247,
            bid_volume_delta: 0.5,
            ask_volume_delta: 0.25,
            trades_delta: 1,
        })),
        ("cell.close.typical", encode_named(&CellClose {
            ts_ms: 1_717_000_060_000,
            symbol: String::from("BTCUSDT-PERP"),
            bucket_ts: 1_717_000_000_000,
            price_bucket: 14_247,
            bid_volume: 5_421.75,
            ask_volume: 6_310.25,
            trades: 847,
        })),
        ("snapshot.typical", encode_named(&SnapshotPayload {
            ts_ms: 1_717_000_030_500,
            cells_open: vec![CellDelta {
                ts_ms: 1_717_000_030_500,
                symbol: String::from("BTCUSDT-PERP"),
                bucket_ts: 1_717_000_000_000,
                price_bucket: 14_247,
                bid_volume_delta: 2.5,
                ask_volume_delta: 3.25,
                trades_delta: 41,
            }],
            ticks_processed: 12_345,
        })),
        ("worker.ready", encode_named(&WorkerReady {
            pid: 4_242,
            generation: 1,
        })),
        ("worker.unavailable", encode_named(&WorkerUnavailable {
            reason: String::from("shutdown"),
        })),
    ];

    for (name, encoded) in fixtures {
        let canonical = read_oracle(name);
        assert_eq!(
            encoded, canonical,
            "rmp-serde encoded bytes for `{name}` do not match canonical .msgpack"
        );
    }
}

fn encode_tick(value: &TickFrame) -> Vec<u8> {
    encode_named(value)
}
fn encode_cell(value: &CellSnapshot) -> Vec<u8> {
    encode_named(value)
}
fn encode_control(value: &ControlCommand) -> Vec<u8> {
    encode_named(value)
}

fn encode_named<T: serde::Serialize>(value: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut ser = rmp_serde::Serializer::new(&mut buf).with_struct_map();
    value.serialize(&mut ser).expect("rmp-serde serialize");
    buf
}
