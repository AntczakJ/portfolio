import type { HistoryBucket } from 'pulse-server';
import type { DisplayStatus } from '@/lib/status/status-tokens';

/**
 * The hand-rolled uptime-history-bar adapters (the classic Statuspage
 * green/amber/red strip). PURE and unit-tested — the SVG component is a thin
 * renderer over these.
 *
 * The backend already computes each bucket's WORST status (down > degraded >
 * up; empty span = unknown) and the counts behind it. The frontend's job is
 * the token mapping (status -> the sovereign `--color-status-*` fill class)
 * and a terse, accessible per-bar tooltip / aria summary.
 */

/** The fill class per bucket status — the sovereign status DOT tokens. */
const BAR_FILL: Record<HistoryBucket['status'], string> = {
  up: 'fill-status-up',
  degraded: 'fill-status-degraded',
  down: 'fill-status-down',
  unknown: 'fill-status-unknown',
};

/**
 * Share of a bucket's checks that must be `down` before the bar reads RED, and
 * the combined non-up share before it reads AMBER (H-2). The backend's
 * worst-status-wins coloring paints a whole bar red when a single check in the
 * hour failed — so a 30d strip of 97%-up monitors renders near-solid red, which
 * lies. We re-derive the bar color from the COUNTS by DOMINANT status: a bucket
 * that is 98% up reads green; red is reserved for a real, sustained outage in
 * the bucket.
 */
const DOWN_RED_THRESHOLD = 0.5;
const NON_UP_AMBER_THRESHOLD = 0.1;

/**
 * The DOMINANT display status for a bucket (H-2). Derived from the counts, not
 * worst-case-wins:
 *   - no observed checks            -> `unknown`
 *   - down share >= 50%             -> `down`   (a real outage owns the bucket)
 *   - non-up share >= 10%           -> `degraded` (visible but not an outage)
 *   - otherwise                     -> `up`     (a 98%-up hour reads green)
 * `unknown` from the wire (a no-data gap) is preserved.
 */
export function bucketDisplayStatus(
  bucket: HistoryBucket,
): HistoryBucket['status'] {
  if (bucket.status === 'unknown') {
    return 'unknown';
  }
  const total = bucket.upCount + bucket.degradedCount + bucket.downCount;
  if (total <= 0) {
    return 'unknown';
  }
  if (bucket.downCount / total >= DOWN_RED_THRESHOLD) {
    return 'down';
  }
  if ((bucket.downCount + bucket.degradedCount) / total >= NON_UP_AMBER_THRESHOLD) {
    return 'degraded';
  }
  return 'up';
}

/**
 * Map a bucket status to its sovereign-token SVG fill class. Falls back to the
 * neutral `unknown` fill for any value outside the status vocabulary (a
 * defensive guard for an unexpected runtime status the types do not cover).
 */
export function bucketFill(status: HistoryBucket['status']): string {
  return Object.hasOwn(BAR_FILL, status) ? BAR_FILL[status] : BAR_FILL.unknown;
}

/** The dominant-status fill class for a bucket (the H-2 coloring path). */
export function bucketDisplayFill(bucket: HistoryBucket): string {
  return bucketFill(bucketDisplayStatus(bucket));
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'No data',
};

/**
 * A terse human label for a bucket (the tooltip headline / aria text). Uses
 * the Statuspage register ("Operational" rather than the raw "up").
 */
export function bucketLabel(status: HistoryBucket['status']): string {
  return Object.hasOwn(STATUS_LABEL, status)
    ? STATUS_LABEL[status]
    : STATUS_LABEL.unknown;
}

/**
 * Build the per-bucket tooltip text: the time range covered + the status +
 * the check counts behind it. `bucketSeconds` is the bar width in seconds, so
 * the end of the range is `bucketStart + bucketSeconds`.
 */
export function bucketTooltip(
  bucket: HistoryBucket,
  bucketSeconds: number,
  formatRange: (startMs: number, endMs: number) => string,
): string {
  const startMs = Date.parse(bucket.bucketStart);
  const endMs = startMs + bucketSeconds * 1000;
  const range = Number.isNaN(startMs) ? bucket.bucketStart : formatRange(startMs, endMs);
  // Label by the DOMINANT status (H-2) so the tooltip matches the bar color.
  const displayStatus = bucketDisplayStatus(bucket);
  const label = bucketLabel(displayStatus);

  if (displayStatus === 'unknown') {
    return `${range} — ${label}`;
  }

  const total = bucket.upCount + bucket.degradedCount + bucket.downCount;
  const parts: string[] = [];
  if (bucket.downCount > 0) parts.push(`${String(bucket.downCount)} down`);
  if (bucket.degradedCount > 0)
    parts.push(`${String(bucket.degradedCount)} degraded`);
  if (bucket.upCount > 0) parts.push(`${String(bucket.upCount)} up`);
  const counts =
    parts.length > 0 ? ` (${parts.join(', ')} of ${String(total)})` : '';
  return `${range} — ${label}${counts}`;
}

export interface HistorySummary {
  readonly total: number;
  readonly up: number;
  readonly degraded: number;
  readonly down: number;
  readonly unknown: number;
}

/**
 * Aggregate the buckets into a screen-reader summary so the strip is not
 * color-only (the AGENT_NOTES accessibility gate: the history bar needs a
 * text/aria summary, not just colored rects). Counts BARS by status, not the
 * checks inside them.
 */
export function summarizeHistory(
  buckets: readonly HistoryBucket[],
): HistorySummary {
  const summary: HistorySummary = {
    total: buckets.length,
    up: 0,
    degraded: 0,
    down: 0,
    unknown: 0,
  };
  let up = 0;
  let degraded = 0;
  let down = 0;
  let unknown = 0;
  for (const b of buckets) {
    // Count by the DOMINANT status (H-2) so the screen-reader summary matches
    // the colored strip rather than the backend's worst-case-wins status.
    switch (bucketDisplayStatus(b)) {
      case 'up':
        up += 1;
        break;
      case 'degraded':
        degraded += 1;
        break;
      case 'down':
        down += 1;
        break;
      default:
        unknown += 1;
    }
  }
  return { ...summary, up, degraded, down, unknown };
}

/**
 * The one-line aria sentence for the strip ("Status history: 88 of 90
 * intervals operational, 1 degraded, 1 down").
 */
export function historyAriaSummary(
  buckets: readonly HistoryBucket[],
  windowLabel: string,
): string {
  const s = summarizeHistory(buckets);
  const observed = s.up + s.degraded + s.down;
  const parts: string[] = [`${String(s.up)} operational`];
  if (s.degraded > 0) parts.push(`${String(s.degraded)} degraded`);
  if (s.down > 0) parts.push(`${String(s.down)} down`);
  if (s.unknown > 0) parts.push(`${String(s.unknown)} with no data`);
  return `Status history over ${windowLabel}: ${String(observed)} of ${String(s.total)} intervals observed — ${parts.join(', ')}.`;
}
