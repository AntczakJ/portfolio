//! Footprint cell aggregator — Task 1.5.
//!
//! Pure-ish state machine that converts a stream of `TickFrame` events
//! into outbound `CellDelta` / `CellClose` / `SnapshotPayload` frames.
//! "Pure-ish" because it mutates internal state (the open-cell map and
//! per-symbol session extremes) but performs no I/O — every method
//! takes its inputs as arguments and returns its outputs as values.
//! That lets us unit-test the aggregator without spinning a tokio
//! runtime or wiring an mpsc.
//!
//! Public surface (the four pieces the worker binary reaches for):
//!   - `struct Aggregator` — holds open-cell map + session extremes.
//!   - `fn on_tick(&mut self, tick) -> Vec<OutboundFrame>` — apply one
//!     tick, return the delta frames to emit.
//!   - `fn close_expired(&mut self, now_ms) -> Vec<OutboundFrame>` —
//!     emit `cell.close` for every bar whose end has passed.
//!   - `fn snapshot(&self) -> SnapshotPayload` — read-only dump of the
//!     open-cell state for the supervisor poll path.
//!
//! State model (per `(symbol, bucket_ts, price_bucket)`):
//!   - `bid_volume_total`  — sum of qty for taker-sell ticks in the cell.
//!   - `ask_volume_total`  — sum of qty for taker-buy ticks in the cell.
//!   - `trades`            — count of ticks in the cell.
//!   - `last_ts_ms`        — wall-clock of the most recent tick in the cell.
//!
//! Aggressor → side mapping (matches `binance-translator.ts`):
//!   - `Aggressor::Buy`  → taker bought from the maker ask → cell's
//!                          **ask_volume** increases.
//!   - `Aggressor::Sell` → taker sold into the maker bid → cell's
//!                          **bid_volume** increases.
//!
//! ## CVD (Task 1.5e, ADR-008)
//!
//! CVD (cumulative volume delta) lives in the pure aggregator on BOTH
//! sides, computed identically, conformance-checked, but stays OFF the
//! WS wire. Per closed bar:
//!   - `bar_delta = ask_volume − bid_volume` summed over the bar's cells
//!     (net aggressive buying; the SAME `ask − bid` operand order as the
//!     TS reference `core.ts`).
//!   - `cvd`       = running per-symbol cumulative of `bar_delta`,
//!     stepped exactly once per closed bar.
//!
//! **Determinism (the load-bearing constraint).** To stay byte-identical
//! with `core.ts` on the conformance fixtures the fold order must mirror
//! the TS reference exactly:
//!   1. Expired cells are drained in `(symbol, bucket_ts, price_bucket)`
//!      sorted order (mirrors `core.ts`'s sorted `expiredKeys`) so the
//!      within-bar `bar_delta` accumulation order matches. Our `open`
//!      map is a `HashMap` with no insertion order, so the sort is what
//!      makes the close emission AND the f64 accumulation reproducible.
//!   2. Bars are folded into the running CVD in `(symbol, bucket_ts)`
//!      sorted order (mirrors `core.ts` line ~293). Same-order IEEE-754
//!      `f64` addition is bit-identical between Rust and V8, so this
//!      yields byte-identical `cvd` values, not merely close ones.
//! Do NOT "optimise" by folding in HashMap-iteration order — that
//! reintroduces a last-ULP divergence the conformance fixtures catch.
//!
//! CVD is exposed as a sibling return value of `close_expired_with_cvd`
//! / `drain_all_with_cvd` and as the queryable `cvd(symbol)` getter — it
//! is NOT a new `OutboundFrame` / `BridgeFrame` variant (ADR-008: CVD
//! does not go on the bridge or the WS wire).
//!
//! The aggregator emits ONE `CellDelta` per `on_tick` call: the worker's
//! coalescing happens implicitly because we sum into the open cell
//! before emitting. A reviewer occasionally proposes "emit one delta
//! per coalescing window instead" — the answer is that the WS-side
//! registry (`src/lib/ws/connections.ts`) already coalesces by
//! `(symbol, bucket_ts, price_bucket)` on its per-client queue, so a
//! second coalescing pass here would only duplicate the policy.

use std::collections::HashMap;

use crate::bridge::messages::{
    Aggressor, CellClose, CellDelta, SnapshotPayload, TickFrame,
};
use crate::bucketing::{price_bucket, time_bucket, TIME_BUCKET_MS};

/// Composite key for the open-cell map.
///
/// Owned `String` because the worker may aggregate multiple symbols in
/// v2 and the hot-path lookup needs a stable key the HashMap can hash.
/// Cloning a short symbol string on every tick is cheap (5–12 bytes,
/// SSO-friendly); the alternative (interning into a symbol id) is v2
/// work.
pub type CellKey = (String, i64, i64);

/// In-memory totals for one open cell.
#[derive(Debug, Clone, PartialEq)]
pub struct CellState {
    pub bid_volume_total: f64,
    pub ask_volume_total: f64,
    pub trades_total: u32,
    pub last_ts_ms: i64,
}

impl CellState {
    fn new(last_ts_ms: i64) -> Self {
        Self {
            bid_volume_total: 0.0,
            ask_volume_total: 0.0,
            trades_total: 0,
            last_ts_ms,
        }
    }
}

/// Outbound frame produced by `on_tick` / `close_expired`.
///
/// Kept as a small concrete enum (not the full `BridgeFrame`) so the
/// aggregator never deals with the inbound variants. The worker binary
/// converts these to `BridgeFrame` before encoding.
#[derive(Debug, Clone, PartialEq)]
pub enum OutboundFrame {
    Delta(CellDelta),
    Close(CellClose),
}

/// Per-bar delta + running CVD rollup — Task 1.5e (ADR-008).
///
/// The Rust mirror of the TS `CvdRollup` (`aggregator/types.ts`). It is a
/// SIBLING value of the close frames, NOT a bridge / WS frame: ADR-008
/// keeps CVD off the wire in v1, so this type deliberately does NOT derive
/// `TS` and is NOT a `BridgeFrame` variant. It is the conformance
/// reference (vs `core.ts`), the replay source of truth, and a reserved
/// (un-built) v2 wire promotion.
///
///  - `symbol`    — the symbol the bar belongs to.
///  - `bucket_ts` — start of the closed bar.
///  - `bar_delta` — net aggressive flow for the bar
///    = `Σ (ask_volume − bid_volume)` over the bar's cells. Positive =
///    net aggressive buying, negative = net aggressive selling.
///  - `cvd`       — cumulative volume delta = running sum of `bar_delta`
///    across closed bars for this symbol, INCLUDING this bar.
#[derive(Debug, Clone, PartialEq)]
pub struct CvdRollup {
    pub symbol: String,
    pub bucket_ts: i64,
    pub bar_delta: f64,
    pub cvd: f64,
}

/// The aggregator's state.
///
/// `open` — currently-open bars across all symbols, keyed by
/// `(symbol, bucket_ts, price_bucket)`. A cell is moved out of the map
/// when its bucket_ts + TIME_BUCKET_MS has passed (see `close_expired`).
///
/// `session_extreme` — per-symbol `max(trades_total)` across every cell
/// the aggregator has seen since process start. Used by the renderer's
/// intensity lerp (see Task 3.1's `#sessionMaxTrades`). The worker
/// re-emits this on the snapshot path so a reconnecting browser does
/// not have to recompute it from the delta stream.
///
/// `ticks_processed` — cumulative count of `on_tick` calls since
/// process start. Surfaced on `/health.worker.ticksProcessed`.
#[derive(Debug, Default)]
pub struct Aggregator {
    open: HashMap<CellKey, CellState>,
    session_extreme: HashMap<String, u32>,
    ticks_processed: u64,
    /// Per-symbol running cumulative volume delta (sum of closed
    /// `bar_delta`). Mirrors the TS `#cvd` map. Steps on bar CLOSE, not
    /// on tick arrival — `0.0` for a symbol whose first bar has not
    /// closed yet. Off the wire per ADR-008; queryable via `cvd(symbol)`.
    cvd: HashMap<String, f64>,
}

impl Aggregator {
    /// Construct an empty aggregator. Equivalent to `Self::default()`;
    /// kept as a named constructor for call-site readability.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply one tick. Returns the outbound frame(s) the caller should
    /// ship. v1 always returns a single `Delta` frame; the `Vec` shape
    /// reserves room for v2 corrections that might emit a delta plus a
    /// `cell.correction` frame in the same call.
    pub fn on_tick(&mut self, tick: TickFrame) -> Vec<OutboundFrame> {
        self.ticks_processed += 1;
        let bucket_ts = time_bucket(tick.ts_ms);
        let price_bk = price_bucket(tick.price);
        let key: CellKey = (tick.symbol.clone(), bucket_ts, price_bk);

        let cell = self
            .open
            .entry(key)
            .or_insert_with(|| CellState::new(tick.ts_ms));
        cell.last_ts_ms = tick.ts_ms;
        let (bid_delta, ask_delta) = match tick.aggressor {
            Aggressor::Sell => {
                // Taker sold into the bid → cell's bid_volume grows.
                cell.bid_volume_total += tick.qty;
                (tick.qty, 0.0)
            }
            Aggressor::Buy => {
                // Taker bought from the ask → cell's ask_volume grows.
                cell.ask_volume_total += tick.qty;
                (0.0, tick.qty)
            }
        };
        cell.trades_total += 1;

        // Session extreme tracks the max trade-count any cell has seen
        // for this symbol so far. Per Task 3.1 the rendered intensity
        // anchor is monotone over the session lifetime.
        let extreme = self.session_extreme.entry(tick.symbol.clone()).or_insert(0);
        if cell.trades_total > *extreme {
            *extreme = cell.trades_total;
        }

        vec![OutboundFrame::Delta(CellDelta {
            ts_ms: tick.ts_ms,
            symbol: tick.symbol,
            bucket_ts,
            price_bucket: price_bk,
            bid_volume_delta: bid_delta,
            ask_volume_delta: ask_delta,
            trades_delta: 1,
        })]
    }

    /// Emit `cell.close` for every cell whose bucket has ended.
    ///
    /// Called from the worker's 1-second rollover timer. `now_ms` is
    /// the current wall-clock; a cell is considered closed when
    /// `bucket_ts + TIME_BUCKET_MS <= now_ms`.
    ///
    /// The closed cells are removed from `open` and shipped as
    /// `OutboundFrame::Close`. Session extremes are NOT cleared at bar
    /// boundary — they live for the lifetime of the aggregator, per
    /// the renderer's expectation.
    ///
    /// This is the back-compat wrapper the live worker binary calls — it
    /// still updates the per-symbol CVD as a side effect (CVD must
    /// advance on every close so `cvd(symbol)` stays correct) but
    /// discards the rollup vector. Use `close_expired_with_cvd` when the
    /// rollups themselves are needed (fixture replay, conformance).
    pub fn close_expired(&mut self, now_ms: i64) -> Vec<OutboundFrame> {
        self.close_expired_with_cvd(now_ms).0
    }

    /// Emit `cell.close` for every expired cell AND the per-bar CVD
    /// rollups, advancing the running per-symbol CVD.
    ///
    /// **Fold order (the byte-identity contract with `core.ts`).**
    ///   1. Expired keys are sorted by `(symbol, bucket_ts, price_bucket)`
    ///      before draining, so both the `cell.close` emission order and
    ///      the within-bar `bar_delta` accumulation order match the TS
    ///      reference exactly (which sorts its `expiredKeys` the same way).
    ///   2. Per-bar deltas are keyed by `(symbol, bucket_ts)` and folded
    ///      into the running CVD in `(symbol, bucket_ts)` sorted order,
    ///      mirroring `core.ts`. The `ask − bid` subtraction operand
    ///      order and the `running + bar_delta` addition order are
    ///      identical to TS, so the resulting `f64` CVD is bit-identical.
    pub fn close_expired_with_cvd(
        &mut self,
        now_ms: i64,
    ) -> (Vec<OutboundFrame>, Vec<CvdRollup>) {
        let mut expired_keys: Vec<CellKey> = self
            .open
            .iter()
            .filter(|(key, _)| {
                let bucket_ts = key.1;
                bucket_ts + TIME_BUCKET_MS <= now_ms
            })
            .map(|(key, _)| key.clone())
            .collect();
        // Deterministic drain order — mirrors `core.ts`'s sorted
        // `expiredKeys`. Without this the HashMap iteration order would
        // make both the close sequence and the f64 fold non-reproducible.
        expired_keys.sort_by(|a, b| {
            a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2))
        });

        let mut frames = Vec::with_capacity(expired_keys.len());
        // Per-bar `(symbol, bucket_ts) -> bar_delta`. We keep insertion
        // order via a parallel key vec so the subsequent sort is total
        // and stable, matching the TS `Map` + sort.
        let mut bar_order: Vec<(String, i64)> = Vec::new();
        let mut bar_deltas: HashMap<(String, i64), f64> = HashMap::new();

        for key in expired_keys {
            if let Some(cell) = self.open.remove(&key) {
                let (symbol, bucket_ts, price_bk) = key;
                frames.push(OutboundFrame::Close(CellClose {
                    ts_ms: cell.last_ts_ms,
                    symbol: symbol.clone(),
                    bucket_ts,
                    price_bucket: price_bk,
                    bid_volume: cell.bid_volume_total,
                    ask_volume: cell.ask_volume_total,
                    trades: cell.trades_total,
                }));

                let bar_key = (symbol, bucket_ts);
                let entry = bar_deltas.entry(bar_key.clone()).or_insert_with(|| {
                    bar_order.push(bar_key.clone());
                    0.0
                });
                // SAME operand order as `core.ts`: ask − bid.
                *entry += cell.ask_volume_total - cell.bid_volume_total;
            }
        }

        let cvd = self.fold_cvd(bar_order, &bar_deltas);
        (frames, cvd)
    }

    /// Drain every currently-open cell as a `cell.close` frame, leaving
    /// the aggregator empty. Used on `ControlCommand::Shutdown` and on
    /// SIGTERM — every in-flight bar is published as an absolute total
    /// so the supervisor / WS clients see a clean checkpoint instead of
    /// a silent end-of-stream.
    ///
    /// Back-compat wrapper for the worker binary — advances CVD as a side
    /// effect and discards the rollups. Equivalent in effect to
    /// `close_expired_with_cvd(i64::MAX)` (every open bar is past), but
    /// named for intent.
    pub fn drain_all(&mut self) -> Vec<OutboundFrame> {
        self.drain_all_with_cvd().0
    }

    /// Drain every open cell AND return the per-bar CVD rollups, advancing
    /// the running per-symbol CVD. Same fold-order contract as
    /// `close_expired_with_cvd` — every remaining open bar is closed
    /// regardless of `now_ms`, in `(symbol, bucket_ts, price_bucket)`
    /// sorted order, folded by `(symbol, bucket_ts)`.
    pub fn drain_all_with_cvd(&mut self) -> (Vec<OutboundFrame>, Vec<CvdRollup>) {
        // i64::MAX guarantees every open bar is "expired". Reusing
        // `close_expired_with_cvd` keeps the fold order identical to the
        // timed path — one code path, one ordering, no divergence.
        self.close_expired_with_cvd(i64::MAX)
    }

    /// Fold the accumulated per-bar deltas into the running per-symbol
    /// CVD in `(symbol, bucket_ts)` sorted order (mirrors `core.ts`).
    fn fold_cvd(
        &mut self,
        mut bar_order: Vec<(String, i64)>,
        bar_deltas: &HashMap<(String, i64), f64>,
    ) -> Vec<CvdRollup> {
        // Sort the bars by (symbol, bucket_ts) — the TS reference sorts
        // its `barDeltas.values()` the same way before the running fold.
        bar_order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut rollups = Vec::with_capacity(bar_order.len());
        for (symbol, bucket_ts) in bar_order {
            let bar_delta = bar_deltas
                .get(&(symbol.clone(), bucket_ts))
                .copied()
                .unwrap_or(0.0);
            let running = self.cvd.get(&symbol).copied().unwrap_or(0.0) + bar_delta;
            self.cvd.insert(symbol.clone(), running);
            rollups.push(CvdRollup {
                symbol,
                bucket_ts,
                bar_delta,
                cvd: running,
            });
        }
        rollups
    }

    /// Snapshot the open-bar state as a `SnapshotPayload`. The `ts_ms`
    /// field is the most recent tick timestamp across all open cells
    /// (or 0 if no ticks have arrived). The `cells_open` array carries
    /// the running absolute totals for each open cell.
    ///
    /// Note: `cells_open` carries absolute totals, not deltas — the
    /// field type is `CellDelta` only because that struct's shape
    /// matches what the browser snapshot reducer expects (`bidVolumeDelta`
    /// / `askVolumeDelta` / `tradesDelta` summed into the cell). On
    /// snapshot, those fields hold the cumulative bar-to-date totals.
    /// Reviewers occasionally propose adding a dedicated
    /// `CellOpenSnapshot` shape — the answer is that the WS-side
    /// `wsSnapshotPayloadSchema.cellsOpen` is already typed as
    /// `wsCellDeltaPayloadSchema[]`, so a second shape would force a
    /// renaming pass on every consumer for no schema win.
    #[must_use]
    pub fn snapshot(&self) -> SnapshotPayload {
        let mut latest = 0i64;
        let mut cells_open = Vec::with_capacity(self.open.len());
        for ((symbol, bucket_ts, price_bk), state) in &self.open {
            if state.last_ts_ms > latest {
                latest = state.last_ts_ms;
            }
            cells_open.push(CellDelta {
                ts_ms: state.last_ts_ms,
                symbol: symbol.clone(),
                bucket_ts: *bucket_ts,
                price_bucket: *price_bk,
                bid_volume_delta: state.bid_volume_total,
                ask_volume_delta: state.ask_volume_total,
                trades_delta: state.trades_total,
            });
        }
        // Deterministic ordering for snapshot reads — easier to test
        // and easier to inspect on the wire.
        cells_open.sort_by(|a, b| {
            a.symbol
                .cmp(&b.symbol)
                .then(a.bucket_ts.cmp(&b.bucket_ts))
                .then(a.price_bucket.cmp(&b.price_bucket))
        });
        SnapshotPayload {
            ts_ms: latest,
            cells_open,
            ticks_processed: self.ticks_processed,
        }
    }

    /// Current count of open cells across all symbols. Surfaces on
    /// `/health.worker.cellsOpen`.
    #[must_use]
    pub fn cells_open(&self) -> usize {
        self.open.len()
    }

    /// Cumulative `on_tick` count since construction. Surfaces on
    /// `/health.worker.ticksProcessed`.
    #[must_use]
    pub fn ticks_processed(&self) -> u64 {
        self.ticks_processed
    }

    /// Read-only access to per-symbol session extremes — used by tests
    /// and by the snapshot path (the WS frame schema does not surface
    /// this directly today; it is reserved for a future renderer-hint
    /// field).
    #[must_use]
    pub fn session_extreme(&self, symbol: &str) -> u32 {
        self.session_extreme.get(symbol).copied().unwrap_or(0)
    }

    /// Current running CVD for a symbol — the sum of every closed bar's
    /// `bar_delta` so far. `0.0` for a symbol whose first bar has not
    /// closed yet (CVD steps on bar CLOSE, not tick arrival). Mirrors the
    /// TS `cvd(symbol)` getter. Off the wire per ADR-008 — this is the
    /// conformance reference + replay source of truth.
    #[must_use]
    pub fn cvd(&self, symbol: &str) -> f64 {
        self.cvd.get(symbol).copied().unwrap_or(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn tick(ts_ms: i64, symbol: &str, price: f64, qty: f64, aggressor: Aggressor) -> TickFrame {
        TickFrame {
            ts_ms,
            symbol: symbol.into(),
            price,
            qty,
            aggressor,
        }
    }

    #[test]
    fn first_tick_creates_cell_with_one_side_only() {
        let mut agg = Aggregator::new();
        let frames = agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            OutboundFrame::Delta(d) => {
                assert_eq!(d.symbol, "BTCUSDT-PERP");
                assert_eq!(d.bucket_ts, 0); // 1_000 floors to 0 in the 60_000 ms bucket
                assert_eq!(d.price_bucket, 14_246);
                assert_eq!(d.bid_volume_delta, 0.0);
                assert_eq!(d.ask_volume_delta, 0.5);
                assert_eq!(d.trades_delta, 1);
            }
            other => panic!("expected Delta, got {other:?}"),
        }
        assert_eq!(agg.cells_open(), 1);
        assert_eq!(agg.ticks_processed(), 1);
    }

    #[test]
    fn sell_tick_increments_bid_side() {
        let mut agg = Aggregator::new();
        let frames = agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.25, Aggressor::Sell));
        match &frames[0] {
            OutboundFrame::Delta(d) => {
                assert_eq!(d.bid_volume_delta, 0.25);
                assert_eq!(d.ask_volume_delta, 0.0);
            }
            other => panic!("expected Delta, got {other:?}"),
        }
    }

    #[test]
    fn second_tick_on_same_cell_accumulates_into_open_state() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        agg.on_tick(tick(2_000, "BTCUSDT-PERP", 71_234.5, 0.25, Aggressor::Buy));
        let snap = agg.snapshot();
        assert_eq!(snap.cells_open.len(), 1);
        let c = &snap.cells_open[0];
        assert_eq!(c.bid_volume_delta, 0.0);
        assert_eq!(c.ask_volume_delta, 0.75);
        assert_eq!(c.trades_delta, 2);
    }

    #[test]
    fn distinct_price_buckets_create_separate_cells() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        agg.on_tick(tick(2_000, "BTCUSDT-PERP", 71_240.0, 0.5, Aggressor::Buy));
        assert_eq!(agg.cells_open(), 2);
    }

    #[test]
    fn bar_rollover_emits_close_with_totals() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.4, Aggressor::Buy));
        agg.on_tick(tick(5_000, "BTCUSDT-PERP", 71_234.5, 0.1, Aggressor::Sell));
        // Now > bucket_ts(0) + 60_000.
        let closes = agg.close_expired(60_001);
        assert_eq!(closes.len(), 1);
        match &closes[0] {
            OutboundFrame::Close(c) => {
                assert_eq!(c.symbol, "BTCUSDT-PERP");
                assert_eq!(c.bucket_ts, 0);
                assert_eq!(c.bid_volume, 0.1);
                assert_eq!(c.ask_volume, 0.4);
                assert_eq!(c.trades, 2);
            }
            other => panic!("expected Close, got {other:?}"),
        }
        // Cell was removed from open map.
        assert_eq!(agg.cells_open(), 0);
    }

    #[test]
    fn close_expired_is_noop_when_bars_still_open() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        let closes = agg.close_expired(30_000);
        assert!(closes.is_empty());
        assert_eq!(agg.cells_open(), 1);
    }

    #[test]
    fn session_extreme_tracks_max_trades_per_symbol() {
        let mut agg = Aggregator::new();
        // Cell A: 3 trades.
        for i in 0..3 {
            agg.on_tick(tick(
                1_000 + i,
                "BTCUSDT-PERP",
                71_234.5,
                0.1,
                Aggressor::Buy,
            ));
        }
        // Cell B (different price bucket): 1 trade.
        agg.on_tick(tick(1_500, "BTCUSDT-PERP", 71_240.0, 0.1, Aggressor::Buy));
        assert_eq!(agg.session_extreme("BTCUSDT-PERP"), 3);
        // ETH symbol isolated from BTC.
        agg.on_tick(tick(1_600, "ETHUSDT-PERP", 3_500.0, 1.0, Aggressor::Buy));
        assert_eq!(agg.session_extreme("ETHUSDT-PERP"), 1);
        assert_eq!(agg.session_extreme("BTCUSDT-PERP"), 3);
    }

    #[test]
    fn concurrent_symbols_isolated_in_open_map() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        agg.on_tick(tick(1_000, "ETHUSDT-PERP", 3_500.0, 1.0, Aggressor::Sell));
        assert_eq!(agg.cells_open(), 2);
        let closes = agg.close_expired(60_001);
        assert_eq!(closes.len(), 2);
    }

    #[test]
    fn drain_all_publishes_every_open_cell_and_clears() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_240.0, 0.5, Aggressor::Sell));
        let drained = agg.drain_all();
        assert_eq!(drained.len(), 2);
        assert_eq!(agg.cells_open(), 0);
    }

    #[test]
    fn snapshot_orders_cells_deterministically() {
        let mut agg = Aggregator::new();
        // Insert in reversed price order; snapshot should sort ascending.
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_240.0, 0.1, Aggressor::Buy));
        agg.on_tick(tick(1_500, "BTCUSDT-PERP", 71_234.5, 0.1, Aggressor::Buy));
        agg.on_tick(tick(2_000, "ETHUSDT-PERP", 3_500.0, 1.0, Aggressor::Buy));
        let snap = agg.snapshot();
        assert_eq!(snap.cells_open.len(), 3);
        // Sorted by (symbol, bucket_ts, price_bucket): BTC bucket 14246, BTC bucket 14248, then ETH.
        assert_eq!(snap.cells_open[0].symbol, "BTCUSDT-PERP");
        assert_eq!(snap.cells_open[0].price_bucket, 14_246);
        assert_eq!(snap.cells_open[1].symbol, "BTCUSDT-PERP");
        assert_eq!(snap.cells_open[1].price_bucket, 14_248);
        assert_eq!(snap.cells_open[2].symbol, "ETHUSDT-PERP");
    }

    #[test]
    fn snapshot_includes_running_totals_and_tick_count() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        agg.on_tick(tick(2_000, "BTCUSDT-PERP", 71_234.5, 0.25, Aggressor::Sell));
        let snap = agg.snapshot();
        assert_eq!(snap.cells_open.len(), 1);
        let c = &snap.cells_open[0];
        // Running totals on the open bar.
        assert_eq!(c.ask_volume_delta, 0.5);
        assert_eq!(c.bid_volume_delta, 0.25);
        assert_eq!(c.trades_delta, 2);
        assert_eq!(snap.ts_ms, 2_000);
        assert_eq!(snap.ticks_processed, 2);
    }

    #[test]
    fn cvd_steps_per_closed_bar_and_reverses_on_sign_flip() {
        // Mirrors the TS `cvd-reversal` fixture + suite invariant:
        // bar 0 net BUYING (bar_delta > 0, CVD rises), bar 1 net SELLING
        // (bar_delta < 0, CVD falls — the reversal), bar 2 net buying
        // again (CVD rises). All quantities are exact dyadic rationals so
        // the comparison is exact f64 equality, not epsilon.
        let mut agg = Aggregator::new();
        // Bar 0: ask 1.0, bid 0.25 -> bar_delta +0.75.
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_000.0, 1.0, Aggressor::Buy));
        agg.on_tick(tick(2_000, "BTCUSDT-PERP", 71_000.0, 0.25, Aggressor::Sell));
        let (_f0, cvd0) = agg.close_expired_with_cvd(60_001);
        assert_eq!(cvd0.len(), 1);
        assert_eq!(cvd0[0].bar_delta, 0.75);
        assert_eq!(cvd0[0].cvd, 0.75);
        assert_eq!(agg.cvd("BTCUSDT-PERP"), 0.75);

        // Bar 1: ask 0.25, bid 1.0 -> bar_delta -0.75 (reversal). CVD
        // returns to exactly 0.0.
        agg.on_tick(tick(61_000, "BTCUSDT-PERP", 71_005.0, 0.25, Aggressor::Buy));
        agg.on_tick(tick(62_000, "BTCUSDT-PERP", 71_005.0, 1.0, Aggressor::Sell));
        let (_f1, cvd1) = agg.close_expired_with_cvd(120_001);
        assert_eq!(cvd1.len(), 1);
        assert_eq!(cvd1[0].bar_delta, -0.75);
        assert_eq!(cvd1[0].cvd, 0.0);
        assert_eq!(agg.cvd("BTCUSDT-PERP"), 0.0);

        // Bar 2: ask 0.5, bid 0.0 -> bar_delta +0.5. CVD rises again.
        agg.on_tick(tick(121_000, "BTCUSDT-PERP", 71_010.0, 0.5, Aggressor::Buy));
        let (_f2, cvd2) = agg.close_expired_with_cvd(180_001);
        assert_eq!(cvd2.len(), 1);
        assert_eq!(cvd2[0].bar_delta, 0.5);
        assert_eq!(cvd2[0].cvd, 0.5);
        assert_eq!(agg.cvd("BTCUSDT-PERP"), 0.5);
    }

    #[test]
    fn cvd_is_zero_before_first_close_and_skips_empty_bars() {
        let mut agg = Aggregator::new();
        // No close yet — CVD is 0.0 even though ticks have arrived.
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_000.0, 1.0, Aggressor::Buy));
        assert_eq!(agg.cvd("BTCUSDT-PERP"), 0.0);
        // Close bar 0 -> one rollup. Bar 1 is empty (no ticks): a sweep
        // that crosses it emits no extra rollup — CVD steps only on bars
        // that traded.
        let (_f, cvd) = agg.close_expired_with_cvd(120_001);
        assert_eq!(cvd.len(), 1);
        assert_eq!(cvd[0].bucket_ts, 0);
        assert_eq!(agg.cvd("BTCUSDT-PERP"), 1.0);
    }

    #[test]
    fn drain_all_with_cvd_folds_remaining_bars() {
        let mut agg = Aggregator::new();
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_000.0, 1.0, Aggressor::Buy));
        let (frames, cvd) = agg.drain_all_with_cvd();
        assert_eq!(frames.len(), 1);
        assert_eq!(cvd.len(), 1);
        assert_eq!(cvd[0].bar_delta, 1.0);
        assert_eq!(cvd[0].cvd, 1.0);
        assert_eq!(agg.cells_open(), 0);
    }

    #[test]
    fn ticks_in_later_bucket_dont_block_earlier_close() {
        let mut agg = Aggregator::new();
        // Tick in bucket 0.
        agg.on_tick(tick(1_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        // Tick in bucket 60_000.
        agg.on_tick(tick(70_000, "BTCUSDT-PERP", 71_234.5, 0.5, Aggressor::Buy));
        // close_expired at 120_001 closes the first bucket (ended at 60_000)
        // AND the second (ended at 120_000).
        let closes = agg.close_expired(120_001);
        assert_eq!(closes.len(), 2);
        assert_eq!(agg.cells_open(), 0);
    }
}
