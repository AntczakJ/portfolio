//! Aggregator CVD conformance test — Task 1.5e per ADR-008.
//!
//! Replays each shared `*.input.json` fixture through the Rust
//! `Aggregator` using the SAME procedure the TS reference harness
//! (`server/src/lib/aggregator/replay.ts`) encodes, and asserts the Rust
//! output matches the committed `*.expected.json` oracle. The focus is
//! **CVD** (ADR-008): the Rust port must produce byte-identical `cvd`
//! values to the TS reference. We also assert the `deltas` and `closes`
//! streams to prove the fold ORDER that CVD depends on is itself
//! identical (a CVD match with a different close order would be luck, not
//! conformance).
//!
//! ## Canonical generator
//!
//! The `*.expected.json` FILES are written canonically by the TS
//! generator `server/scripts/gen-aggregator-fixtures.ts`
//! (`bun run scripts/gen-aggregator-fixtures.ts` from `projects/tape/
//! server`). The Rust side does NOT write these files — it recomputes the
//! same values in-memory and asserts equality. This keeps a single writer
//! (no `serde_json`-vs-`JSON.stringify` number-formatting drift, e.g.
//! `1.0` vs `1`) so "regenerate from either side → no diff" holds
//! trivially: only TS writes, Rust conforms.
//!
//! ## Why JSON, not the bridge fixtures
//!
//! CVD is OFF the WS / bridge wire in v1 (ADR-008). The bridge fixture
//! generator (`src/bin/gen-fixtures.rs`) is MessagePack + ts-rs and must
//! NOT gain a `cvd` frame. These aggregator fixtures are plain JSON,
//! serde-friendly, and never cross the bridge.
//!
//! ## Numeric note
//!
//! Every fixture quantity is an exact dyadic rational (0.5, 0.25, 0.125,
//! 0.1 summed a bounded number of times) chosen so same-order IEEE-754
//! `f64` arithmetic is bit-identical between Rust and V8. The assertions
//! are therefore EXACT `f64` equality, not epsilon — a last-ULP
//! divergence (e.g. from a wrong fold order) would fail the test.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tape_worker::aggregator::{Aggregator, OutboundFrame};
use tape_worker::bridge::messages::{Aggressor, TickFrame};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server")
        .join("src")
        .join("lib")
        .join("aggregator")
        .join("__fixtures__")
}

fn read_json(name: &str) -> Value {
    let path = fixtures_dir().join(name);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture {}: {}", path.display(), e));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("parse fixture {}: {}", path.display(), e))
}

fn aggressor_from_str(s: &str) -> Aggressor {
    match s {
        "buy" => Aggressor::Buy,
        "sell" => Aggressor::Sell,
        other => panic!("unknown aggressor in fixture: {other}"),
    }
}

fn tick_from_value(v: &Value) -> TickFrame {
    TickFrame {
        ts_ms: v["tsMs"].as_i64().expect("tsMs i64"),
        symbol: v["symbol"].as_str().expect("symbol str").to_owned(),
        price: v["price"].as_f64().expect("price f64"),
        qty: v["qty"].as_f64().expect("qty f64"),
        aggressor: aggressor_from_str(v["aggressor"].as_str().expect("aggressor str")),
    }
}

/// The output of replaying one fixture through the Rust aggregator,
/// projected to the same logical shape as the TS `expected.json`.
struct Replayed {
    deltas: Vec<Value>,
    closes: Vec<Value>,
    cvd: Vec<Value>,
    final_snapshot_ticks: u64,
    final_snapshot_cells_open: usize,
}

/// Mirror of `replayFixture` in `server/src/lib/aggregator/replay.ts`:
/// feed all ticks (collect deltas), `close_expired_with_cvd` once per
/// `closeAt` entry in order (collect closes + cvd), then
/// `drain_all_with_cvd` (collect remaining closes + cvd), then snapshot.
fn replay(input: &Value) -> Replayed {
    let mut agg = Aggregator::new();
    let mut deltas = Vec::new();
    let mut closes = Vec::new();
    let mut cvd = Vec::new();

    for tick_v in input["ticks"].as_array().expect("ticks array") {
        let tick = tick_from_value(tick_v);
        for frame in agg.on_tick(tick) {
            if let OutboundFrame::Delta(d) = frame {
                deltas.push(serde_json::json!({
                    "tsMs": d.ts_ms,
                    "symbol": d.symbol,
                    "bucketTs": d.bucket_ts,
                    "priceBucket": d.price_bucket,
                    "bidVolumeDelta": d.bid_volume_delta,
                    "askVolumeDelta": d.ask_volume_delta,
                    "tradesDelta": d.trades_delta,
                }));
            }
        }
    }

    for now_v in input["closeAt"].as_array().expect("closeAt array") {
        let now_ms = now_v.as_i64().expect("closeAt i64");
        let (frames, rollups) = agg.close_expired_with_cvd(now_ms);
        collect_closes(&frames, &mut closes);
        collect_cvd(&rollups, &mut cvd);
    }

    let (frames, rollups) = agg.drain_all_with_cvd();
    collect_closes(&frames, &mut closes);
    collect_cvd(&rollups, &mut cvd);

    let snap = agg.snapshot();
    Replayed {
        deltas,
        closes,
        cvd,
        final_snapshot_ticks: snap.ticks_processed,
        final_snapshot_cells_open: snap.cells_open.len(),
    }
}

fn collect_closes(frames: &[OutboundFrame], out: &mut Vec<Value>) {
    for frame in frames {
        if let OutboundFrame::Close(c) = frame {
            out.push(serde_json::json!({
                "tsMs": c.ts_ms,
                "symbol": c.symbol,
                "bucketTs": c.bucket_ts,
                "priceBucket": c.price_bucket,
                "bidVolume": c.bid_volume,
                "askVolume": c.ask_volume,
                "trades": c.trades,
            }));
        }
    }
}

fn collect_cvd(rollups: &[tape_worker::aggregator::CvdRollup], out: &mut Vec<Value>) {
    for r in rollups {
        out.push(serde_json::json!({
            "symbol": r.symbol,
            "bucketTs": r.bucket_ts,
            "barDelta": r.bar_delta,
            "cvd": r.cvd,
        }));
    }
}

/// Compare two JSON arrays of objects field-by-field with EXACT numeric
/// equality. `serde_json::Value` equality treats `1` (integer) and `1.0`
/// (float) as distinct, so we normalise numbers to f64 before comparing —
/// the TS oracle emits `1` where Rust emits `1.0` for whole-valued
/// volumes, but the VALUE is identical and that is what conformance means.
fn assert_records_eq(label: &str, fixture: &str, actual: &[Value], expected: &Value) {
    let expected = expected.as_array().unwrap_or_else(|| {
        panic!("{fixture}: expected `{label}` to be an array");
    });
    assert_eq!(
        actual.len(),
        expected.len(),
        "{fixture}: `{label}` length mismatch (rust {} vs ts {})",
        actual.len(),
        expected.len()
    );
    for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
        assert!(
            json_value_eq(a, e),
            "{fixture}: `{label}`[{i}] mismatch\n  rust: {a}\n  ts:   {e}"
        );
    }
}

/// Deep JSON equality where numbers compare as f64 (so `1` == `1.0`) and
/// all other types compare structurally.
fn json_value_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            // Exact f64 equality — fixtures are dyadic so this is exact,
            // and a last-ULP fold-order divergence WOULD fail here.
            match (x.as_f64(), y.as_f64()) {
                (Some(xf), Some(yf)) => xf == yf,
                _ => false,
            }
        }
        (Value::Object(xo), Value::Object(yo)) => {
            xo.len() == yo.len()
                && xo
                    .iter()
                    .all(|(k, xv)| yo.get(k).is_some_and(|yv| json_value_eq(xv, yv)))
        }
        (Value::Array(xa), Value::Array(ya)) => {
            xa.len() == ya.len()
                && xa.iter().zip(ya.iter()).all(|(xv, yv)| json_value_eq(xv, yv))
        }
        _ => a == b,
    }
}

fn run_fixture(base: &str) {
    let input = read_json(&format!("{base}.input.json"));
    let expected = read_json(&format!("{base}.expected.json"));
    let got = replay(&input);

    // CVD is the headline assertion (ADR-008 conformance scope).
    assert_records_eq("cvd", base, &got.cvd, &expected["cvd"]);
    // Deltas + closes prove the fold ORDER CVD depends on is identical.
    assert_records_eq("deltas", base, &got.deltas, &expected["deltas"]);
    assert_records_eq("closes", base, &got.closes, &expected["closes"]);

    // Final snapshot: open map drained empty, tick count matches.
    let exp_snap = &expected["finalSnapshot"];
    assert_eq!(
        got.final_snapshot_cells_open,
        exp_snap["cellsOpen"].as_array().expect("cellsOpen array").len(),
        "{base}: finalSnapshot.cellsOpen length mismatch"
    );
    assert_eq!(
        got.final_snapshot_ticks,
        exp_snap["ticksProcessed"].as_u64().expect("ticksProcessed u64"),
        "{base}: finalSnapshot.ticksProcessed mismatch"
    );
}

#[test]
fn basic_two_bars_cvd_matches_ts_reference() {
    run_fixture("basic-two-bars");
}

#[test]
fn edge_cases_cvd_matches_ts_reference() {
    run_fixture("edge-cases");
}

#[test]
fn cvd_reversal_matches_ts_reference() {
    run_fixture("cvd-reversal");
}
