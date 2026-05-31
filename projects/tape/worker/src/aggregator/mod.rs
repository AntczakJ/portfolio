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
    pub fn close_expired(&mut self, now_ms: i64) -> Vec<OutboundFrame> {
        // Collect keys to drain first so we do not mutate the map
        // while iterating it.
        let expired_keys: Vec<CellKey> = self
            .open
            .iter()
            .filter(|(key, _)| {
                let bucket_ts = key.1;
                bucket_ts + TIME_BUCKET_MS <= now_ms
            })
            .map(|(key, _)| key.clone())
            .collect();

        let mut frames = Vec::with_capacity(expired_keys.len());
        for key in expired_keys {
            if let Some(cell) = self.open.remove(&key) {
                let (symbol, bucket_ts, price_bk) = key;
                frames.push(OutboundFrame::Close(CellClose {
                    ts_ms: cell.last_ts_ms,
                    symbol,
                    bucket_ts,
                    price_bucket: price_bk,
                    bid_volume: cell.bid_volume_total,
                    ask_volume: cell.ask_volume_total,
                    trades: cell.trades_total,
                }));
            }
        }
        frames
    }

    /// Drain every currently-open cell as a `cell.close` frame, leaving
    /// the aggregator empty. Used on `ControlCommand::Shutdown` and on
    /// SIGTERM — every in-flight bar is published as an absolute total
    /// so the supervisor / WS clients see a clean checkpoint instead of
    /// a silent end-of-stream.
    pub fn drain_all(&mut self) -> Vec<OutboundFrame> {
        let mut frames = Vec::with_capacity(self.open.len());
        let drained: Vec<(CellKey, CellState)> = self.open.drain().collect();
        for (key, cell) in drained {
            let (symbol, bucket_ts, price_bk) = key;
            frames.push(OutboundFrame::Close(CellClose {
                ts_ms: cell.last_ts_ms,
                symbol,
                bucket_ts,
                price_bucket: price_bk,
                bid_volume: cell.bid_volume_total,
                ask_volume: cell.ask_volume_total,
                trades: cell.trades_total,
            }));
        }
        frames
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
