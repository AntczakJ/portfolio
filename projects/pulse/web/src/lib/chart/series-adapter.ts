import type { SeriesResponse } from 'pulse-server';

/**
 * The uPlot DATA ADAPTER — the pure, unit-tested boundary between the
 * `/series` response and uPlot's imperative `setData`.
 *
 * uPlot's `setData` takes parallel, index-aligned arrays `[xs, ...ys]` where
 * `xs` is the x-scale values (UNIX SECONDS here) and each subsequent array is
 * one y-series. The `/series` response is already shaped for this (ADR-004
 * picked the uPlot-native parallel-array wire shape), but the number of
 * y-series differs by resolution:
 *
 *   - 24h `resolution: 'raw'`   -> ONE y-series: `value` (ms | null).
 *   - 7d/30d `resolution: 'hourly'` -> TWO y-series: `avg`, `p95` (ms | null).
 *
 * A `null` entry is a GAP (a down probe with no timing, or an unknown gap) —
 * uPlot draws a line break, never a dive to zero. We keep the nulls.
 *
 * This module is the unit-tested seam (the task's "test the data adapter, not
 * uPlot rendering"). The imperative wrapper consumes `toUplotData` and calls
 * `setData` off the React render path.
 */

/** uPlot's data shape: `[xs, ...ys]`, all index-aligned. */
export type UplotData = (readonly (number | null)[])[];

/** How many y-series a given resolution carries (for label/legend wiring). */
export interface SeriesShape {
  readonly resolution: SeriesResponse['resolution'];
  /** Series labels in the same order as the y-arrays in `UplotData`. */
  readonly labels: readonly string[];
  readonly data: UplotData;
}

/**
 * Map a `/series` response to the uPlot `[xs, ...ys]` data shape plus the
 * series labels. Defensive against a malformed/empty payload (missing arrays
 * collapse to empty so uPlot renders an empty chart, never throws).
 */
export function toUplotData(series: SeriesResponse): SeriesShape {
  const xs = series.t.map((t) => t);

  if (series.resolution === 'raw') {
    const value = normalizeLength(series.value ?? [], xs.length);
    return {
      resolution: 'raw',
      labels: ['Response'],
      data: [xs, value],
    };
  }

  // hourly: avg + p95
  const avg = normalizeLength(series.avg ?? [], xs.length);
  const p95 = normalizeLength(series.p95 ?? [], xs.length);
  return {
    resolution: 'hourly',
    labels: ['Average', 'p95'],
    data: [xs, avg, p95],
  };
}

/**
 * Coerce a value array to exactly `len` entries (pad with `null` gaps, or
 * truncate). Guards against a backend payload whose value array drifted out
 * of index-alignment with `t` — uPlot requires every array the same length.
 */
function normalizeLength(
  arr: readonly (number | null)[],
  len: number,
): (number | null)[] {
  if (arr.length === len) {
    return arr.slice();
  }
  const out: (number | null)[] = new Array<number | null>(len).fill(null);
  for (let i = 0; i < Math.min(arr.length, len); i += 1) {
    out[i] = arr[i] ?? null;
  }
  return out;
}

/**
 * A single live point appended to the 24h raw chart from an SSE
 * `check.result` (the wow-moment continuation on the detail page).
 */
export interface LivePoint {
  /** UNIX SECONDS (the chart's x-scale). */
  readonly tSec: number;
  /** Response time in ms, or null for a gap (down/error probe). */
  readonly value: number | null;
}

/**
 * Append a live raw point to an existing raw `UplotData`, keeping the arrays
 * index-aligned and ascending, de-duplicating on the x-value (an SSE result
 * that arrives for a timestamp the windowed fetch already covers replaces it,
 * rather than doubling the point), and trimming to a rolling cap so a long
 * live session does not grow the array unbounded.
 *
 * Returns a NEW `UplotData` (the wrapper feeds it straight to `setData`). Only
 * defined for the raw (1 y-series) shape — live append is a 24h-only affordance
 * (7d/30d are rollup-driven and refetch on the rollup tick, not per probe).
 */
export function appendLivePoint(
  data: UplotData,
  point: LivePoint,
  maxPoints = 5000,
): UplotData {
  const xs = (data[0] ?? []).slice();
  const ys = (data[1] ?? []).slice();

  const lastX = xs.length > 0 ? xs[xs.length - 1] : undefined;
  if (lastX != null && point.tSec <= lastX) {
    // The point is not strictly newer than the tail. If it matches the tail
    // exactly, replace the tail value; if it is older, ignore it (the windowed
    // fetch already owns that range and is authoritative).
    if (point.tSec === lastX) {
      ys[ys.length - 1] = point.value;
    }
    return trim([xs, ys], maxPoints);
  }

  xs.push(point.tSec);
  ys.push(point.value);
  return trim([xs, ys], maxPoints);
}

function trim(data: UplotData, maxPoints: number): UplotData {
  const xs = data[0] ?? [];
  const ys = data[1] ?? [];
  if (xs.length <= maxPoints) {
    return [xs.slice(), ys.slice()];
  }
  const start = xs.length - maxPoints;
  return [xs.slice(start), ys.slice(start)];
}
