/**
 * Virtual clock + bucketTs bar grouping for replay mode (Task 3.6).
 *
 * The replay cell stream arrives as individual cell rows ordered by
 * `(bucketTs, priceBucket)` (ADR-005). This module groups them by
 * `bucketTs` into whole bars and decides, given a virtual-clock cursor,
 * which bars are "materialised" (i.e. their bar has CLOSED at the cursor
 * time) and should be applied to the chart.
 *
 * **Virtual clock contract.**
 *   - A bar with bucket start `bucketTs` CLOSES at `bucketTs +
 *     BAR_DURATION_MS` (the same 1-minute grid the live chart uses,
 *     ADR-005). A bar is materialised once the cursor reaches its close
 *     time — i.e. `cursorMs >= bucketTs + BAR_DURATION_MS`. This mirrors
 *     live mode, where a `cell.close` only fires after the minute
 *     boundary passes.
 *   - At 30x a 1-min bar lands every 2 s of wall-clock (ADR-006):
 *     `BAR_DURATION_MS / speedX = 60000 / 30 = 2000 ms`. The engine
 *     advances `cursorMs` by `wallDeltaMs * speedX` each tick.
 *   - Cells are already-closed ABSOLUTE totals → applied as a hard
 *     REBASE (the store's `replay.bar` reducer replaces, never
 *     accumulates).
 *
 * This file is PURE — no clock, no DOM, no store. The engine
 * (`engine.ts`) owns the wall-clock timer and the store; this module
 * owns the grouping + cursor math so both are unit-testable in
 * isolation.
 */
import type { ReplayCellRow, WSReplayBarPayload } from 'tape-server';

/** Bar duration in ms — 1-minute bars per ADR-005 (matches the chart). */
export const BAR_DURATION_MS = 60_000;

/**
 * One grouped historic bar: a `bucketTs` plus every cell row that shares
 * it. Cells preserve the stream's `priceBucket`-ascending order.
 */
export interface ReplayBar {
  bucketTs: number;
  cells: ReplayCellRow[];
}

/**
 * Group an ordered cell-row sequence into bars by `bucketTs`. The input
 * is assumed ordered by `(bucketTs, priceBucket)` (the replay query's
 * ORDER BY), so we can group with a single linear pass without sorting.
 * A defensive out-of-order row (a `bucketTs` we have already emitted a
 * later bar for) still lands in the correct bar via a map lookup, so the
 * grouping is robust even if the ordering guarantee is ever weakened.
 *
 * Returns bars sorted ascending by `bucketTs` (forward replay order).
 */
export function groupCellsByBucket(rows: readonly ReplayCellRow[]): ReplayBar[] {
  const byBucket = new Map<number, ReplayCellRow[]>();
  for (const row of rows) {
    const existing = byBucket.get(row.bucketTs);
    if (existing === undefined) {
      byBucket.set(row.bucketTs, [row]);
    } else {
      existing.push(row);
    }
  }
  const bars: ReplayBar[] = [];
  for (const [bucketTs, cells] of byBucket) {
    bars.push({ bucketTs, cells });
  }
  bars.sort((a, b) => a.bucketTs - b.bucketTs);
  return bars;
}

/** The bucketTs at which a bar closes (and is eligible to materialise). */
export function barCloseMs(bucketTs: number): number {
  return bucketTs + BAR_DURATION_MS;
}

/**
 * Convert a grouped bar into the `replay.bar` WS payload the store
 * reducer consumes. The frame carries the bar's `symbol` + `bucketTs`
 * once and each cell's absolute totals + projected `delta`.
 */
export function barToReplayPayload(
  symbol: string,
  bar: ReplayBar,
): WSReplayBarPayload {
  return {
    symbol,
    bucketTs: bar.bucketTs,
    cells: bar.cells.map((cell) => ({
      priceBucket: cell.priceBucket,
      bidVolume: cell.bidVolume,
      askVolume: cell.askVolume,
      trades: cell.trades,
      delta: cell.delta,
    })),
  };
}

/**
 * Given the full ordered bar list and a virtual-clock cursor, return the
 * indices `[fromIndex, toIndexExclusive)` of bars that have CLOSED at or
 * before `cursorMs` — i.e. `barCloseMs(bucketTs) <= cursorMs`. Because
 * bars are sorted ascending, the closed set is always a prefix; we
 * return its length as `closedCount`.
 *
 * The engine uses this two ways:
 *   - Forward playback: it tracks how many bars it has already emitted
 *     (`emittedCount`) and emits bars `[emittedCount, closedCount)` as
 *     the cursor advances.
 *   - Seek/rebuild: it discards store state and re-emits bars
 *     `[0, closedCount)` from scratch to rebuild the chart at the new
 *     cursor.
 */
export function countClosedBars(
  bars: readonly ReplayBar[],
  cursorMs: number,
): number {
  // Binary search for the first bar whose close time is > cursorMs.
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const bar = bars[mid];
    if (bar !== undefined && barCloseMs(bar.bucketTs) <= cursorMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Advance the cursor by one wall-clock tick at the given speed,
 * returning the next cursor (clamped to `[0, maxMs]`). Pure helper so
 * the engine's timing math is testable without a real clock.
 */
export function advanceCursor(
  cursorMs: number,
  wallDeltaMs: number,
  speedX: number,
  maxMs: number,
): number {
  const next = cursorMs + wallDeltaMs * speedX;
  if (next < 0) return 0;
  if (next > maxMs) return maxMs;
  return next;
}
