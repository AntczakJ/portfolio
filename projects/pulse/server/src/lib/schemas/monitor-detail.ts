import { z } from 'zod';

import { checkErrorClassSchema } from './check-result';
import { monitorStatusSchema } from './events';

/**
 * Monitor-detail read schemas (Task 4.2) — the shared FE/BE contract for the
 * monitor-detail page (ADR-004 uptime computation + the uPlot chart + the
 * status-history strip + the recent-checks list).
 *
 * These are the response shapes the Phase 4 frontend consumes:
 *   - `GET /monitors/:id/uptime`  -> {@link UptimeResponse}
 *   - `GET /monitors/:id/series`  -> {@link SeriesResponse}
 *   - `GET /monitors/:id/history` -> {@link HistoryResponse}
 *   - `GET /monitors/:id/checks`  -> {@link RecentChecksResponse}
 *
 * The window selector is shared across uptime / series / history so the detail
 * page drives all three from one toggle. Per ADR-004 the read STRATEGY differs
 * per window (24h from raw `check_results`, 7d/30d from `check_rollups_hourly`),
 * but the WIRE shape is uniform — the frontend does not care which source fed it.
 */

/** Selectable time windows for the detail page (ADR-004). */
export const monitorWindowSchema = z.enum(['24h', '7d', '30d']);
export type MonitorWindow = z.infer<typeof monitorWindowSchema>;

/**
 * Query params for the windowed read endpoints. `window` defaults to `24h`
 * (the cheapest, raw-row path) so a bare call is valid and the detail page's
 * first paint is the live window.
 */
export const monitorWindowQuerySchema = z.object({
  window: monitorWindowSchema.default('24h'),
});
export type MonitorWindowQuery = z.infer<typeof monitorWindowQuerySchema>;

// ---------------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------------

/**
 * The duration breakdown behind the uptime % (ADR-004). Durations are in
 * SECONDS. `unknown` time (gaps > 2*interval — paused monitor / worker down)
 * is excluded from BOTH numerator and denominator of the percentage, but is
 * surfaced here so the UI can show "we had no data for N minutes" honestly.
 *
 * `degraded` counts as 50% against uptime (DEGRADED_UPTIME_WEIGHT = 0.5), so
 * the percentage is NOT simply up/(up+degraded+down). The raw second-buckets
 * are returned so the UI can render a breakdown without re-deriving the math.
 */
export const uptimeBreakdownSchema = z.object({
  upSeconds: z.number().nonnegative(),
  degradedSeconds: z.number().nonnegative(),
  downSeconds: z.number().nonnegative(),
  unknownSeconds: z.number().nonnegative(),
});
export type UptimeBreakdown = z.infer<typeof uptimeBreakdownSchema>;

/**
 * Uptime over one window.
 *
 *   uptimePercent = (upSeconds + 0.5 * degradedSeconds)
 *                   / (upSeconds + degradedSeconds + downSeconds)   * 100
 *
 * (the `unknownSeconds` are excluded from the denominator). `null` when there
 * is no observed data at all in the window (denominator would be 0) — the UI
 * renders that as "no data" rather than 0% or 100%.
 *
 * `observedSeconds` is the denominator above (up+degraded+down). `windowSeconds`
 * is the nominal window length; when `observedSeconds < windowSeconds` the
 * monitor is younger than the window (or had unknown gaps) and the UI can label
 * it a partial window.
 */
export const uptimeResponseSchema = z.object({
  monitorId: z.string().uuid(),
  window: monitorWindowSchema,
  uptimePercent: z.number().min(0).max(100).nullable(),
  windowSeconds: z.number().nonnegative(),
  observedSeconds: z.number().nonnegative(),
  breakdown: uptimeBreakdownSchema,
  /** The source the figure was computed from — `raw` for 24h, `rollup` for
   * 7d/30d (+ a raw top-up of the current partial hour). Surfaced so the UI /
   * a reviewer can confirm the 30d view did not scan raw rows. */
  source: z.enum(['raw', 'rollup']),
});
export type UptimeResponse = z.infer<typeof uptimeResponseSchema>;

// ---------------------------------------------------------------------------
// Response-time series (the uPlot chart)
// ---------------------------------------------------------------------------

/**
 * Response-time series for the uPlot chart.
 *
 * Shape is uPlot-FRIENDLY: parallel arrays, index-aligned, where `t[i]` is the
 * UNIX-SECONDS x-value and the value arrays are the y-series at that x. uPlot's
 * `setData` takes exactly `[t, ...series]`, so the frontend feeds
 * `[data.t, data.avg, data.p95]` (or `[data.t, data.value]` for raw) with no
 * remapping. A `null` entry in a value array is a GAP (uPlot draws a line break,
 * not a dive to zero) — used for unknown gaps and for buckets with no samples.
 *
 *   - 24h: `resolution = 'raw'`, ONE series `value` = each raw point's
 *     response time (down points have a null response time -> a gap).
 *   - 7d / 30d: `resolution = 'hourly'`, TWO series `avg` + `p95` from the
 *     hourly rollup, so the payload stays small (~168 / ~720 points) instead of
 *     shipping tens of thousands of raw points.
 *
 * `avg` / `p95` are present only when `resolution = 'hourly'`; `value` is
 * present only when `resolution = 'raw'`. The frontend switches on `resolution`.
 */
export const seriesResponseSchema = z.object({
  monitorId: z.string().uuid(),
  window: monitorWindowSchema,
  resolution: z.enum(['raw', 'hourly']),
  /** UNIX-SECONDS x-values (uPlot's native x scale), ascending. */
  t: z.array(z.number().int().nonnegative()),
  /** Raw response-time series (ms), index-aligned with `t`. `null` = gap.
   * Present only when `resolution === 'raw'`. */
  value: z.array(z.number().int().nonnegative().nullable()).optional(),
  /** Hourly average response time (ms). Present only when `resolution === 'hourly'`. */
  avg: z.array(z.number().int().nonnegative().nullable()).optional(),
  /** Hourly p95 response time (ms). Present only when `resolution === 'hourly'`. */
  p95: z.array(z.number().int().nonnegative().nullable()).optional(),
});
export type SeriesResponse = z.infer<typeof seriesResponseSchema>;

// ---------------------------------------------------------------------------
// Uptime history bars (the green / amber / red status strip)
// ---------------------------------------------------------------------------

/**
 * One bar of the status-history strip. Each bar covers `[bucketStart,
 * bucketStart + bucketSeconds)` and carries the WORST status observed in that
 * span (down > degraded > up), or `unknown` when the span had no data (a gap or
 * a not-yet-observed slice for a young monitor). The classic Statuspage bar.
 */
export const historyBucketSchema = z.object({
  bucketStart: z.string().datetime(),
  status: z.enum(['up', 'degraded', 'down', 'unknown']),
  /** Counts behind the bar (for a tooltip). All zero when `unknown`. */
  upCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  downCount: z.number().int().nonnegative(),
});
export type HistoryBucket = z.infer<typeof historyBucketSchema>;

export const historyResponseSchema = z.object({
  monitorId: z.string().uuid(),
  window: monitorWindowSchema,
  bucketSeconds: z.number().int().positive(),
  buckets: z.array(historyBucketSchema),
});
export type HistoryResponse = z.infer<typeof historyResponseSchema>;

// ---------------------------------------------------------------------------
// Recent checks list
// ---------------------------------------------------------------------------

/** Query params for the recent-checks list. `limit` caps the payload. */
export const recentChecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RecentChecksQuery = z.infer<typeof recentChecksQuerySchema>;

/** One row of the recent-activity list (latest first). */
export const recentCheckSchema = z.object({
  id: z.string(),
  checkedAt: z.string().datetime(),
  status: monitorStatusSchema,
  statusCode: z.number().int().nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  error: checkErrorClassSchema.nullable(),
});
export type RecentCheck = z.infer<typeof recentCheckSchema>;

export const recentChecksResponseSchema = z.object({
  monitorId: z.string().uuid(),
  checks: z.array(recentCheckSchema),
});
export type RecentChecksResponse = z.infer<typeof recentChecksResponseSchema>;

/** Window length in seconds, keyed by the window enum. Shared so the read
 * service and the uptime math agree on the nominal denominator. */
export const WINDOW_SECONDS: Record<MonitorWindow, number> = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

/** Number of bars in the status-history strip (the classic Statuspage count). */
export const HISTORY_BUCKET_COUNT = 90;

/** Degraded counts as half-uptime against the numerator (ADR-004). */
export const DEGRADED_UPTIME_WEIGHT = 0.5;
