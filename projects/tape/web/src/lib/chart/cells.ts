/**
 * Cell aggregation + intensity helpers — pure functions, no
 * Canvas2D, no theme tokens. Used by the cell painter to derive the
 * per-cell visual signals from a delta payload or a close payload.
 *
 * Keeping these out of the painter means we can unit-test the math
 * deterministically without mocking a 2D context.
 */
import type {
  WSCellClosePayload,
  WSCellDeltaPayload,
} from 'tape-server';

/**
 * Normalised cell shape the painter consumes. Both delta payloads
 * (open bar) and close payloads (closed bar) flow into this — the
 * painter draws them identically once we have totals.
 */
export interface NormalizedCell {
  bucketTs: number;
  priceBucket: number;
  bidVolume: number;
  askVolume: number;
  trades: number;
}

export function normalizeDelta(payload: WSCellDeltaPayload): NormalizedCell {
  return {
    bucketTs: payload.bucketTs,
    priceBucket: payload.priceBucket,
    bidVolume: payload.bidVolumeDelta,
    askVolume: payload.askVolumeDelta,
    trades: payload.tradesDelta,
  };
}

export function normalizeClose(payload: WSCellClosePayload): NormalizedCell {
  return {
    bucketTs: payload.bucketTs,
    priceBucket: payload.priceBucket,
    bidVolume: payload.bidVolume,
    askVolume: payload.askVolume,
    trades: payload.trades,
  };
}

/**
 * Signed imbalance in [-1, +1]:
 *   - +1 means all volume on the buy (ask-aggressed) side
 *   - -1 means all volume on the sell (bid-aggressed) side
 *   - 0  means perfectly balanced (or zero total volume)
 *
 * Convention: `bidVolume` is volume aggressed into the bid (sells
 * hitting bids), `askVolume` is volume aggressed into the ask
 * (buys lifting offers). Positive imbalance = buys dominating, which
 * is the buy-anchor end of the cell color gradient. This matches the
 * AGENT_NOTES aggressor mapping documented for Task 1.3 — `m === false
 * → 'buy'` means a taker bought = ask-aggressed.
 *
 * Returns 0 (rather than NaN) on zero total volume — a cell with no
 * trades is neutral by definition.
 */
export function computeImbalance(cell: NormalizedCell): number {
  const total = cell.bidVolume + cell.askVolume;
  if (total <= 0) return 0;
  return (cell.askVolume - cell.bidVolume) / total;
}

/**
 * Intensity in [0, 1] scaled by `trades` against the session extreme.
 *
 * The painter uses this as the lerp factor between `--color-cell-bg`
 * and `--color-cell-bg-strong`. A cell with the most trades of the
 * session renders at full strength (1.0); a cell with no trades
 * renders at 0.
 *
 * Returns 0 when `sessionMaxTrades` is 0 or non-finite — a fresh
 * session has no extreme yet and every cell is at base intensity.
 */
export function computeIntensity(
  cell: NormalizedCell,
  sessionMaxTrades: number,
): number {
  if (!Number.isFinite(sessionMaxTrades) || sessionMaxTrades <= 0) return 0;
  const t = cell.trades / sessionMaxTrades;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Threshold below which we treat the cell as "low confidence" and
 * paint its text in the subtle foreground colour. Picked at 5 trades
 * — matches the WCAG note in AGENT_NOTES Task 2.5 ("Text for
 * low-confidence cells (< 5 trades)").
 */
export const LOW_CONFIDENCE_TRADE_THRESHOLD = 5;

/**
 * Whether the cell qualifies as low-confidence and should use the
 * `--color-cell-fg-subtle` text colour.
 */
export function isLowConfidence(cell: NormalizedCell): boolean {
  return cell.trades < LOW_CONFIDENCE_TRADE_THRESHOLD;
}

/**
 * Compact volume label for the cell text — integer-rounded under 1000,
 * `1.2K` style above. The footprint convention is to print the total
 * cell volume (bid + ask) so the painter can call this directly.
 *
 * Returns an empty string when the cell has zero volume.
 */
export function formatCellVolume(cell: NormalizedCell): string {
  const total = cell.bidVolume + cell.askVolume;
  if (total <= 0) return '';
  return formatVolume(total);
}

/**
 * Compact volume label for a single side of the footprint split (bid
 * OR ask). Same scale as `formatCellVolume` but on one volume figure
 * rather than the total — this is the canonical two-number footprint
 * cell (`bid | ask`). Returns `''` for a zero/empty side so the painter
 * skips it (a side with no volume should not print a `0`).
 */
export function formatSideVolume(volume: number): string {
  if (volume <= 0) return '';
  return formatVolume(volume);
}

function formatVolume(value: number): string {
  if (value < 10) {
    // Show one decimal for sub-10 volumes so a BTC cell with 0.42 BTC
    // does not collapse to "0".
    return value.toFixed(1);
  }
  if (value < 1000) {
    return Math.round(value).toString();
  }
  if (value < 10000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return `${Math.round(value / 1000)}K`;
}

/**
 * Per-bar delta = total ask volume − total bid volume across every
 * price cell in the bar (the canonical footprint "delta" printed at the
 * foot of each bar column). Positive = net buying, negative = net
 * selling.
 */
export function barDelta(cells: readonly NormalizedCell[]): number {
  let delta = 0;
  for (const c of cells) {
    delta += c.askVolume - c.bidVolume;
  }
  return delta;
}

/**
 * Signed, compact label for the per-bar delta foot number. Always
 * carries an explicit `+`/`-` so dominance is legible without colour
 * (WCAG: never colour as the sole channel). `0` is unsigned.
 */
export function formatBarDelta(delta: number): string {
  if (delta === 0) return '0';
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${formatVolume(Math.abs(delta))}`;
}
