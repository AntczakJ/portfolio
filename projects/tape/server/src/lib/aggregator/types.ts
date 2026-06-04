/**
 * Aggregator I/O types — Task 1.4 (TypeScript reference impl).
 *
 * These are the PURE-CORE types: the tick the aggregator consumes and
 * the frames it emits. They are deliberately plain `number`-based JS
 * records (NOT the bridge `bigint` shapes, NOT the Zod-validated WS
 * envelopes) because the core aggregator is the language-agnostic
 * reference the Rust port (`worker/src/aggregator/mod.rs`) mirrors. The
 * thin adapter (`adapter.ts`) is where these meet the WS frame
 * envelope, the snapshot cache, and the bigint bridge boundary.
 *
 * **Field-name parity with the Rust port.** The emitted-frame field
 * names match the ts-rs generated bridge types
 * (`CellDelta` / `CellClose` / `SnapshotPayload`) after the
 * snake_case → camelCase transform: `bidVolumeDelta` ↔ `bid_volume_delta`,
 * `bidVolume` ↔ `bid_volume`, etc. The non-overlapping delta-vs-totals
 * field-name invariant from ADR-005 / ADR-006 is preserved here at the
 * core level so the adapter is a mechanical rename, not a re-derivation.
 */

/**
 * Aggressor side of a trade — the taker's direction.
 *
 * Canonical mapping (established in Task 1.3, do NOT contradict):
 *   - `'buy'`  = taker lifted the ask (Binance `m === false`).
 *   - `'sell'` = taker hit the bid   (Binance `m === true`).
 *
 * See `AggregatorCore` for the aggressor → footprint-side cheat sheet.
 */
export type Aggressor = 'buy' | 'sell';

/**
 * One normalised trade tick fed into the aggregator core.
 *
 * Matches the camelCase projection of the Rust `TickFrame`
 * (`ts_ms` / `symbol` / `price` / `qty` / `aggressor`). `tsMs` is the
 * matching-engine trade time in epoch milliseconds — the authoritative
 * tick clock that drives bar bucketing (NOT wall-clock).
 */
export interface AggregatorTick {
  readonly tsMs: number;
  readonly symbol: string;
  readonly price: number;
  readonly qty: number;
  readonly aggressor: Aggressor;
}

/**
 * Mid-bar additive mutation emitted by `onTick`. Mirrors the Rust
 * `CellDelta`. Every field is non-negative by construction — a tick
 * only ever ADDS volume / trades to a cell.
 *
 *  - `tsMs`           — the contributing tick's trade time.
 *  - `bucketTs`       — start of the 1-min bar (UTC-aligned).
 *  - `priceBucket`    — price-bucket INDEX (see `bucketing.ts`).
 *  - `bidVolumeDelta` — qty added to the bid side this tick (taker-sell).
 *  - `askVolumeDelta` — qty added to the ask side this tick (taker-buy).
 *  - `tradesDelta`    — always 1 in v1 (one tick = one trade event).
 */
export interface CellDelta {
  readonly tsMs: number;
  readonly symbol: string;
  readonly bucketTs: number;
  readonly priceBucket: number;
  readonly bidVolumeDelta: number;
  readonly askVolumeDelta: number;
  readonly tradesDelta: number;
}

/**
 * Bar-boundary absolute totals emitted by `closeExpired` / `drainAll`.
 * Mirrors the Rust `CellClose`. `tsMs` is the LAST contributing tick's
 * trade time (matches the Rust `cell.last_ts_ms`), not the bar boundary.
 *
 * **Cell invariant the tests assert:** `bidVolume + askVolume` equals
 * the total traded volume routed through this cell, and `trades` equals
 * the count of ticks that contributed to it.
 */
export interface CellClose {
  readonly tsMs: number;
  readonly symbol: string;
  readonly bucketTs: number;
  readonly priceBucket: number;
  readonly bidVolume: number;
  readonly askVolume: number;
  readonly trades: number;
}

/**
 * Discriminated union of the frames the aggregator emits. Kept as a
 * tiny tagged union (NOT the full WS envelope) so the core never deals
 * with topics or codecs — the adapter promotes these into WS frames.
 */
export type OutboundFrame =
  | { readonly kind: 'cell.delta'; readonly payload: CellDelta }
  | { readonly kind: 'cell.close'; readonly payload: CellClose };

/**
 * Open-bar snapshot — read-only dump of every currently-open cell plus
 * the cumulative tick count. Mirrors the Rust `SnapshotPayload`, except
 * `cellsOpen` carries `CellDelta`-shaped records whose `*Delta` fields
 * hold the running ABSOLUTE totals for the open bar (same convention the
 * Rust `snapshot()` uses — the field type is `CellDelta` because the
 * browser snapshot reducer expects that shape; on snapshot the fields
 * carry bar-to-date totals).
 *
 * `cellsOpen` is sorted deterministically by
 * `(symbol, bucketTs, priceBucket)` so snapshot reads are stable across
 * runs and trivially diffable against the Rust port.
 */
export interface AggregatorSnapshot {
  readonly tsMs: number;
  readonly cellsOpen: readonly CellDelta[];
  readonly ticksProcessed: number;
}

/**
 * Per-bar delta + CVD rollup. NOT part of the Rust port today (the Rust
 * worker does not yet compute CVD — flagged in AGENT_NOTES). Emitted by
 * the TS reference at bar close so the chart's CVD sub-pane (Phase 3.2)
 * and the unit tests have a concrete contract.
 *
 *  - `symbol`   — the symbol the bar belongs to.
 *  - `bucketTs` — start of the closed bar.
 *  - `barDelta` — net aggressive flow for the bar = sum over the bar's
 *                 cells of `(askVolume - bidVolume)`. Positive = net
 *                 aggressive buying, negative = net aggressive selling.
 *  - `cvd`      — cumulative volume delta = running sum of `barDelta`
 *                 across closed bars for this symbol, INCLUDING this
 *                 bar. Monotone in the direction of net flow except on a
 *                 bar whose `barDelta` reverses sign.
 */
export interface CvdRollup {
  readonly symbol: string;
  readonly bucketTs: number;
  readonly barDelta: number;
  readonly cvd: number;
}
