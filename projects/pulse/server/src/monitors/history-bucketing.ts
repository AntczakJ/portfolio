import type { HistoryBucket } from '../lib/schemas/monitor-detail';
import type { MonitorStatus } from '../lib/schemas/events';

/**
 * Status-history bucketing — the green / amber / red Statuspage strip, as PURE
 * functions so the bucketing is unit-testable against fixtures.
 *
 * The window is divided into `bucketCount` equal time buckets. Each bucket
 * carries the WORST status observed in its span (down > degraded > up), or
 * `unknown` when the span had no data at all (a gap, or a slice before a young
 * monitor's first check). Counts are surfaced for a tooltip.
 *
 * Two entry points feed the same bucket shape:
 *   - {@link bucketRawResults}  — the 24h path (raw `check_results`).
 *   - {@link bucketRollups}     — the 7d/30d path (hourly rollup buckets).
 */

/** A raw check result reduced to what the history strip needs. */
export interface RawHistoryPoint {
  checkedAtMs: number;
  status: MonitorStatus;
}

/** An hourly rollup bucket reduced to what the history strip needs. */
export interface RollupHistoryBucket {
  bucketStartMs: number;
  upCount: number;
  degradedCount: number;
  downCount: number;
}

interface Tally {
  up: number;
  degraded: number;
  down: number;
}

/** Worst-status precedence: down > degraded > up; `unknown` when no data. */
function worstStatus(t: Tally): HistoryBucket['status'] {
  if (t.down > 0) return 'down';
  if (t.degraded > 0) return 'degraded';
  if (t.up > 0) return 'up';
  return 'unknown';
}

function toBucket(startMs: number, t: Tally): HistoryBucket {
  return {
    bucketStart: new Date(startMs).toISOString(),
    status: worstStatus(t),
    upCount: t.up,
    degradedCount: t.degraded,
    downCount: t.down,
  };
}

function emptyTallies(count: number): Tally[] {
  return Array.from({ length: count }, () => ({ up: 0, degraded: 0, down: 0 }));
}

/**
 * Index of the bucket a timestamp falls into, or -1 if outside the window.
 * Buckets are `[start + i*size, start + (i+1)*size)`; the window end is
 * exclusive (a point exactly at `windowEndMs` belongs to no bucket).
 */
function bucketIndex(ms: number, windowStartMs: number, bucketSizeMs: number, count: number): number {
  if (ms < windowStartMs) return -1;
  const idx = Math.floor((ms - windowStartMs) / bucketSizeMs);
  return idx >= 0 && idx < count ? idx : -1;
}

/** Bucket RAW results into `bucketCount` equal buckets across the window. */
export function bucketRawResults(
  results: readonly RawHistoryPoint[],
  windowStartMs: number,
  windowEndMs: number,
  bucketCount: number,
): HistoryBucket[] {
  const bucketSizeMs = (windowEndMs - windowStartMs) / bucketCount;
  const tallies = emptyTallies(bucketCount);

  for (const r of results) {
    const idx = bucketIndex(r.checkedAtMs, windowStartMs, bucketSizeMs, bucketCount);
    const tally = tallies[idx];
    if (!tally) continue;
    if (r.status === 'up') tally.up++;
    else if (r.status === 'degraded') tally.degraded++;
    else tally.down++;
  }

  return tallies.map((t, i) => toBucket(windowStartMs + i * bucketSizeMs, t));
}

/**
 * Bucket HOURLY ROLLUPS into `bucketCount` equal buckets across the window.
 * Each rollup bucket's counts are added to the strip bucket its hour-start
 * falls into. For 7d/30d the strip bucket is wider than an hour, so multiple
 * rollup hours fold into one bar (their counts sum, worst status wins).
 */
export function bucketRollups(
  rollups: readonly RollupHistoryBucket[],
  windowStartMs: number,
  windowEndMs: number,
  bucketCount: number,
): HistoryBucket[] {
  const bucketSizeMs = (windowEndMs - windowStartMs) / bucketCount;
  const tallies = emptyTallies(bucketCount);

  for (const r of rollups) {
    const idx = bucketIndex(r.bucketStartMs, windowStartMs, bucketSizeMs, bucketCount);
    const tally = tallies[idx];
    if (!tally) continue;
    tally.up += r.upCount;
    tally.degraded += r.degradedCount;
    tally.down += r.downCount;
  }

  return tallies.map((t, i) => toBucket(windowStartMs + i * bucketSizeMs, t));
}
