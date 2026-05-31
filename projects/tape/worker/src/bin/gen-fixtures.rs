//! Bridge conformance fixture generator — Task 1.5b per ADR-003.
//!
//! Emits the canonical MessagePack byte oracle for every representative
//! bridge frame variant into
//! `../server/src/lib/schemas/bridge/fixtures/<name>.msgpack`, then reads
//! each file back, decodes via `rmp-serde`, and asserts the round-trip
//! against the in-memory value via `pretty_assertions::assert_eq`.
//!
//! Run sequence (dev-time, NOT on every CI run — the .msgpack files are
//! committed and CI verifies them via `cargo test` + `bun test`):
//!
//! ```sh
//! cd projects/tape/worker
//! cargo run --bin gen-fixtures
//! ```
//!
//! Schema-change workflow:
//!
//!   1. Edit the Rust struct in `src/bridge/messages.rs`.
//!   2. `cargo test`               # re-emits ts-rs TS bindings.
//!   3. `cargo run --bin gen-fixtures`  # re-emits the .msgpack oracle.
//!   4. `pnpm -F tape-server test` # verifies the TS side agrees.
//!   5. Commit all generated files in the same PR.
//!
//! Per the binary-is-oracle convention, hand-editing a `.msgpack` file is
//! forbidden — they are derived from the `.json` fixtures (humans edit
//! those) and from the Rust struct definitions (humans edit those). If a
//! regeneration produces different bytes for the same logical value,
//! that is a schema/ordering bug — investigate, do not silently
//! overwrite the fixtures.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use tape_worker::bridge::messages::{
    Aggressor, CellClose, CellDelta, CellSnapshot, ControlCommand, ControlKind, SnapshotPayload,
    TickFrame, WorkerReady, WorkerUnavailable,
};

/// One named (`<name>.msgpack`) fixture. Each variant pairs a logical
/// value with the on-disk basename — the same basename used by the
/// matching `.json` file under
/// `server/src/lib/schemas/bridge/fixtures/`.
#[derive(Debug)]
enum Fixture {
    Tick { name: &'static str, value: TickFrame },
    Cell { name: &'static str, value: CellSnapshot },
    Control { name: &'static str, value: ControlCommand },
    // Task 1.5 outbound shapes:
    Delta { name: &'static str, value: CellDelta },
    Close { name: &'static str, value: CellClose },
    Snapshot { name: &'static str, value: SnapshotPayload },
    Ready { name: &'static str, value: WorkerReady },
    Unavailable { name: &'static str, value: WorkerUnavailable },
}

impl Fixture {
    fn name(&self) -> &'static str {
        match self {
            Fixture::Tick { name, .. }
            | Fixture::Cell { name, .. }
            | Fixture::Control { name, .. }
            | Fixture::Delta { name, .. }
            | Fixture::Close { name, .. }
            | Fixture::Snapshot { name, .. }
            | Fixture::Ready { name, .. }
            | Fixture::Unavailable { name, .. } => name,
        }
    }

    /// Encode the in-memory value to MessagePack bytes via `rmp-serde`.
    /// Uses the named-struct (map) encoding so keys are present on the
    /// wire — required by ADR-003's self-describing-frames contract.
    fn encode(&self) -> Result<Vec<u8>> {
        match self {
            Fixture::Tick { value, .. } => encode_named(value),
            Fixture::Cell { value, .. } => encode_named(value),
            Fixture::Control { value, .. } => encode_named(value),
            Fixture::Delta { value, .. } => encode_named(value),
            Fixture::Close { value, .. } => encode_named(value),
            Fixture::Snapshot { value, .. } => encode_named(value),
            Fixture::Ready { value, .. } => encode_named(value),
            Fixture::Unavailable { value, .. } => encode_named(value),
        }
    }

    /// Decode the given bytes back into the same logical value type and
    /// assert structural equality against the in-memory source.
    fn verify_round_trip(&self, bytes: &[u8]) -> Result<()> {
        match self {
            Fixture::Tick { value, .. } => {
                let decoded: TickFrame = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Cell { value, .. } => {
                let decoded: CellSnapshot = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Control { value, .. } => {
                let decoded: ControlCommand = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Delta { value, .. } => {
                let decoded: CellDelta = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Close { value, .. } => {
                let decoded: CellClose = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Snapshot { value, .. } => {
                let decoded: SnapshotPayload = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Ready { value, .. } => {
                let decoded: WorkerReady = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
            Fixture::Unavailable { value, .. } => {
                let decoded: WorkerUnavailable = decode_named(bytes)
                    .with_context(|| format!("decode {}", self.name()))?;
                assert_eq!(&decoded, value);
            }
        }
        Ok(())
    }
}

/// Encode via `rmp-serde` with named structs (map encoding). This is the
/// same encoder the worker uses on the live bridge per ADR-003. Per
/// `rmp-serde`'s default, struct fields serialize as a MessagePack map
/// keyed by the field name, in struct definition order.
fn encode_named<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut ser = rmp_serde::Serializer::new(&mut buf).with_struct_map();
    value
        .serialize(&mut ser)
        .context("rmp-serde serialize")?;
    Ok(buf)
}

/// Decode via `rmp-serde`'s default deserializer.
fn decode_named<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T> {
    rmp_serde::from_slice(bytes).context("rmp-serde deserialize")
}

fn fixtures_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR resolves at compile time to the crate root
    // (`projects/tape/worker`). The fixtures live in the server package
    // alongside the generated TS schema mirrors.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server")
        .join("src")
        .join("lib")
        .join("schemas")
        .join("bridge")
        .join("fixtures")
}

fn write_fixture(dir: &Path, fixture: &Fixture) -> Result<()> {
    let bytes = fixture.encode()?;
    let path = dir.join(format!("{}.msgpack", fixture.name()));
    fs::write(&path, &bytes).with_context(|| format!("write {}", path.display()))?;
    // Read straight back from disk to make sure what we wrote round-trips
    // through the file system unchanged (catches editor / git autocrlf
    // surprises that would corrupt a binary blob — though .gitattributes
    // pins these as binary, the check is cheap insurance).
    let read_back = fs::read(&path)
        .with_context(|| format!("read back {}", path.display()))?;
    assert_eq!(read_back, bytes, "disk round-trip for {}", fixture.name());
    fixture.verify_round_trip(&read_back)?;
    println!(
        "wrote {} ({} bytes) and verified round-trip",
        path.display(),
        bytes.len()
    );
    Ok(())
}

fn main() -> Result<()> {
    let dir = fixtures_dir();
    fs::create_dir_all(&dir)
        .with_context(|| format!("create fixtures dir {}", dir.display()))?;

    let fixtures = [
        Fixture::Tick {
            name: "tick.min",
            value: TickFrame {
                ts_ms: 1,
                symbol: String::from("BTC"),
                // Fractional values so rmp-serde (f64-always)
                // and msgpackr (auto-sizes integers to int) agree on
                // the wire encoding. An integer-valued JS number would
                // pack as a MessagePack positive fixint, which would
                // diverge from rmp-serde's float64 emission.
                price: 0.5,
                qty: 0.5,
                aggressor: Aggressor::Buy,
            },
        },
        Fixture::Tick {
            name: "tick.typical",
            value: TickFrame {
                ts_ms: 1_717_000_000_000,
                symbol: String::from("BTCUSDT"),
                price: 71_234.5,
                qty: 0.125,
                aggressor: Aggressor::Sell,
            },
        },
        Fixture::Cell {
            name: "cell.min",
            value: CellSnapshot {
                ts_ms: 1,
                symbol: String::from("BTC"),
                price_bucket: 1,
                // Fractional values so the f64 fields wire as MessagePack
                // float64 from both sides — see the tick.min note above.
                bid_volume: 0.5,
                ask_volume: 0.5,
                trades: 1,
            },
        },
        Fixture::Cell {
            name: "cell.peak",
            value: CellSnapshot {
                ts_ms: 1_717_000_060_000,
                symbol: String::from("BTCUSDT"),
                price_bucket: 71_235,
                bid_volume: 5_421.75,
                ask_volume: 6_310.25,
                trades: 847,
            },
        },
        Fixture::Control {
            name: "control.pause",
            value: ControlCommand { kind: ControlKind::Pause },
        },
        Fixture::Control {
            name: "control.snapshot",
            value: ControlCommand { kind: ControlKind::Snapshot },
        },
        // Task 1.5 outbound shapes — fractional f64 values for the same
        // reason `tick.min` / `cell.min` carry them: rmp-serde encodes
        // floats as `f64` consistently, and a JS integer-valued number
        // would byte-diverge from msgpackr's positive-fixint emission.
        Fixture::Delta {
            name: "cell.delta.typical",
            value: CellDelta {
                ts_ms: 1_717_000_000_500,
                symbol: String::from("BTCUSDT-PERP"),
                bucket_ts: 1_717_000_000_000,
                price_bucket: 14_247,
                bid_volume_delta: 0.5,
                ask_volume_delta: 0.25,
                trades_delta: 1,
            },
        },
        Fixture::Close {
            name: "cell.close.typical",
            value: CellClose {
                ts_ms: 1_717_000_060_000,
                symbol: String::from("BTCUSDT-PERP"),
                bucket_ts: 1_717_000_000_000,
                price_bucket: 14_247,
                bid_volume: 5_421.75,
                ask_volume: 6_310.25,
                trades: 847,
            },
        },
        Fixture::Snapshot {
            name: "snapshot.typical",
            value: SnapshotPayload {
                ts_ms: 1_717_000_030_500,
                cells_open: vec![
                    CellDelta {
                        ts_ms: 1_717_000_030_500,
                        symbol: String::from("BTCUSDT-PERP"),
                        bucket_ts: 1_717_000_000_000,
                        price_bucket: 14_247,
                        bid_volume_delta: 2.5,
                        ask_volume_delta: 3.25,
                        trades_delta: 41,
                    },
                ],
                ticks_processed: 12_345,
            },
        },
        Fixture::Ready {
            name: "worker.ready",
            value: WorkerReady {
                pid: 4_242,
                generation: 1,
            },
        },
        Fixture::Unavailable {
            name: "worker.unavailable",
            value: WorkerUnavailable {
                reason: String::from("shutdown"),
            },
        },
    ];

    for fixture in &fixtures {
        write_fixture(&dir, fixture)?;
    }

    println!(
        "\n{} fixtures written to {}",
        fixtures.len(),
        dir.display()
    );
    Ok(())
}
