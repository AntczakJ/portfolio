import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { checkResults, checkRollupsHourly, type Monitor } from '../db/schema';
import type { MonitorStatus } from '../lib/schemas/events';
import {
  HISTORY_BUCKET_COUNT,
  WINDOW_SECONDS,
  type HistoryResponse,
  type MonitorWindow,
  type RecentCheck,
  type RecentChecksResponse,
  type SeriesResponse,
  type UptimeResponse,
} from '../lib/schemas/monitor-detail';
import {
  bucketRawResults,
  bucketRollups,
  type RawHistoryPoint,
  type RollupHistoryBucket,
} from './history-bucketing';
import {
  mergeBreakdowns,
  observedSeconds,
  uptimeFromRawResults,
  uptimeFromRollups,
  uptimePercentFromBreakdown,
  type RawResultPoint,
  type RollupBucketCounts,
} from './uptime-math';

/**
 * Monitor-detail READ surface (Task 4.2, ADR-004).
 *
 * Powers the detail page: windowed uptime %, the response-time series for the
 * uPlot chart, the status-history strip, and the recent-checks list. Pure math
 * (uptime + history bucketing) lives in the sibling `uptime-math.ts` /
 * `history-bucketing.ts` modules and is unit-tested; THIS service is the IO
 * boundary that fetches the right rows per the ADR-004 window strategy and
 * hands them to that math.
 *
 * THE WINDOW STRATEGY (ADR-004, the load-bearing efficiency decision):
 *   - 24h  -> RAW `check_results` (cheap, exact: ~1440 rows/day for a 60 s
 *             monitor, served by the `(monitor_id, checked_at DESC)` index).
 *   - 7d / 30d -> the HOURLY ROLLUP table (`check_rollups_hourly`, ~168 / ~720
 *             rows) PLUS a raw top-up of the current partial hour (the hour not
 *             yet folded into a rollup), so the live number is correct between
 *             5-min rollup ticks. A 30d query NEVER scans raw rows beyond the
 *             current hour.
 *
 * Ownership: the caller (controller) resolves the owned monitor first
 * (`MonitorsService.getOwned`, which 404s on a monitor the demo user does not
 * own), then hands the row here. The read methods therefore trust the monitor
 * row's id but still scope every query by `monitor_id` (never a client id).
 */
@Injectable()
export class MonitorReadService {
  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  // -------------------------------------------------------------------------
  // Uptime
  // -------------------------------------------------------------------------

  async uptime(monitor: Monitor, window: MonitorWindow, now: Date = new Date()): Promise<UptimeResponse> {
    const windowSeconds = WINDOW_SECONDS[window];
    const windowStartMs = now.getTime() - windowSeconds * 1000;
    const windowEndMs = now.getTime();

    if (window === '24h') {
      // RAW path: every result in the last 24h, ascending.
      const rows = await this.fetchRawPoints(monitor.id, new Date(windowStartMs), new Date(windowEndMs));
      const points: RawResultPoint[] = rows.map((r) => ({
        checkedAtMs: r.checkedAt.getTime(),
        status: r.status,
      }));
      const breakdown = uptimeFromRawResults(points, windowStartMs, windowEndMs, monitor.intervalSeconds);
      return {
        monitorId: monitor.id,
        window,
        uptimePercent: uptimePercentFromBreakdown(breakdown),
        windowSeconds,
        observedSeconds: observedSeconds(breakdown),
        breakdown,
        source: 'raw',
      };
    }

    // ROLLUP path (7d / 30d): the rollup body for the full hours, plus a raw
    // top-up of the current partial hour (not yet rolled up).
    const currentHourStartMs = startOfHour(now).getTime();

    // Rollup buckets in [windowStart, currentHourStart) — the fully-closed hours.
    const rollupRows = await this.fetchRollupCounts(
      monitor.id,
      new Date(windowStartMs),
      new Date(currentHourStartMs),
    );
    const rollupBreakdown = uptimeFromRollups(
      rollupRows.map<RollupBucketCounts>((r) => ({
        upCount: r.upCount,
        degradedCount: r.degradedCount,
        downCount: r.downCount,
      })),
      monitor.intervalSeconds,
    );

    // Raw top-up: results in the CURRENT hour only (cheap — one hour of rows).
    const topUpRows = await this.fetchRawPoints(monitor.id, new Date(currentHourStartMs), new Date(windowEndMs));
    const topUpBreakdown = uptimeFromRawResults(
      topUpRows.map<RawResultPoint>((r) => ({ checkedAtMs: r.checkedAt.getTime(), status: r.status })),
      currentHourStartMs,
      windowEndMs,
      monitor.intervalSeconds,
    );
    // The top-up's leading "unknown" (current-hour start -> first result) and
    // trailing uncovered time are NOT meaningful denominator for a partial hour
    // we may simply have few samples in; we only fold its OBSERVED time in. The
    // rollup body already excludes unknown by construction.
    const breakdown = mergeBreakdowns(rollupBreakdown, {
      upSeconds: topUpBreakdown.upSeconds,
      degradedSeconds: topUpBreakdown.degradedSeconds,
      downSeconds: topUpBreakdown.downSeconds,
      unknownSeconds: 0,
    });

    return {
      monitorId: monitor.id,
      window,
      uptimePercent: uptimePercentFromBreakdown(breakdown),
      windowSeconds,
      observedSeconds: observedSeconds(breakdown),
      breakdown,
      source: 'rollup',
    };
  }

  // -------------------------------------------------------------------------
  // Response-time series (the uPlot chart)
  // -------------------------------------------------------------------------

  async series(monitor: Monitor, window: MonitorWindow, now: Date = new Date()): Promise<SeriesResponse> {
    const windowSeconds = WINDOW_SECONDS[window];
    const windowStartMs = now.getTime() - windowSeconds * 1000;

    if (window === '24h') {
      // RAW points: ascending, one y per probe. A null response time (a down
      // probe with no timing) is a GAP in the chart.
      const rows = await this.fetchRawSeries(monitor.id, new Date(windowStartMs), now);
      const t: number[] = [];
      const value: (number | null)[] = [];
      for (const r of rows) {
        t.push(Math.floor(r.checkedAt.getTime() / 1000));
        value.push(r.responseTimeMs);
      }
      return { monitorId: monitor.id, window, resolution: 'raw', t, value };
    }

    // ROLLUP series (7d / 30d): one point per hourly bucket (avg + p95), so the
    // payload stays ~168 / ~720 points instead of tens of thousands of raw rows.
    const rows = await this.fetchRollupSeries(monitor.id, new Date(windowStartMs), now);
    const t: number[] = [];
    const avg: (number | null)[] = [];
    const p95: (number | null)[] = [];
    for (const r of rows) {
      t.push(Math.floor(r.bucketStart.getTime() / 1000));
      avg.push(r.avgResponseTimeMs);
      p95.push(r.p95ResponseTimeMs);
    }
    return { monitorId: monitor.id, window, resolution: 'hourly', t, avg, p95 };
  }

  // -------------------------------------------------------------------------
  // Uptime history bars (the green / amber / red status strip)
  // -------------------------------------------------------------------------

  async history(monitor: Monitor, window: MonitorWindow, now: Date = new Date()): Promise<HistoryResponse> {
    const windowSeconds = WINDOW_SECONDS[window];
    const windowStartMs = now.getTime() - windowSeconds * 1000;
    const windowEndMs = now.getTime();
    const bucketCount = HISTORY_BUCKET_COUNT;
    const bucketSeconds = Math.round(windowSeconds / bucketCount);

    if (window === '24h') {
      const rows = await this.fetchRawPoints(monitor.id, new Date(windowStartMs), new Date(windowEndMs));
      const points: RawHistoryPoint[] = rows.map((r) => ({
        checkedAtMs: r.checkedAt.getTime(),
        status: r.status,
      }));
      const buckets = bucketRawResults(points, windowStartMs, windowEndMs, bucketCount);
      return { monitorId: monitor.id, window, bucketSeconds, buckets };
    }

    // ROLLUP path: bucket the hourly rollups into the strip's bars. For 7d/30d a
    // strip bar is wider than an hour, so multiple rollup hours fold into one bar.
    const rows = await this.fetchRollupCounts(monitor.id, new Date(windowStartMs), new Date(windowEndMs));
    const rollups: RollupHistoryBucket[] = rows.map((r) => ({
      bucketStartMs: r.bucketStart.getTime(),
      upCount: r.upCount,
      degradedCount: r.degradedCount,
      downCount: r.downCount,
    }));
    const buckets = bucketRollups(rollups, windowStartMs, windowEndMs, bucketCount);
    return { monitorId: monitor.id, window, bucketSeconds, buckets };
  }

  // -------------------------------------------------------------------------
  // Recent checks list
  // -------------------------------------------------------------------------

  async recentChecks(monitor: Monitor, limit: number): Promise<RecentChecksResponse> {
    // The hot read path — `(monitor_id, checked_at DESC)` index, LIMIT n.
    const rows = await this.db
      .select({
        id: checkResults.id,
        checkedAt: checkResults.checkedAt,
        status: checkResults.status,
        statusCode: checkResults.statusCode,
        responseTimeMs: checkResults.responseTimeMs,
        error: checkResults.error,
      })
      .from(checkResults)
      .where(eq(checkResults.monitorId, monitor.id))
      .orderBy(desc(checkResults.checkedAt))
      .limit(limit);

    const checks: RecentCheck[] = rows.map((r) => ({
      id: String(r.id),
      checkedAt: r.checkedAt.toISOString(),
      status: r.status,
      statusCode: r.statusCode,
      responseTimeMs: r.responseTimeMs,
      error: r.error,
    }));

    return { monitorId: monitor.id, checks };
  }

  // -------------------------------------------------------------------------
  // Query helpers (each scoped by monitor_id, riding the hot indexes)
  // -------------------------------------------------------------------------

  /** Raw (status, checkedAt) points in [start, end), ascending. 24h uptime/history. */
  private async fetchRawPoints(
    monitorId: string,
    start: Date,
    end: Date,
  ): Promise<{ checkedAt: Date; status: MonitorStatus }[]> {
    const rows = await this.db
      .select({ checkedAt: checkResults.checkedAt, status: checkResults.status })
      .from(checkResults)
      .where(
        and(
          eq(checkResults.monitorId, monitorId),
          gte(checkResults.checkedAt, start),
          lt(checkResults.checkedAt, end),
        ),
      )
      .orderBy(asc(checkResults.checkedAt));
    return rows;
  }

  /** Raw (responseTimeMs, checkedAt) points in [start, end), ascending. 24h series. */
  private async fetchRawSeries(
    monitorId: string,
    start: Date,
    end: Date,
  ): Promise<{ checkedAt: Date; responseTimeMs: number | null }[]> {
    return this.db
      .select({ checkedAt: checkResults.checkedAt, responseTimeMs: checkResults.responseTimeMs })
      .from(checkResults)
      .where(
        and(
          eq(checkResults.monitorId, monitorId),
          gte(checkResults.checkedAt, start),
          lt(checkResults.checkedAt, end),
        ),
      )
      .orderBy(asc(checkResults.checkedAt));
  }

  /** Hourly rollup counts in [start, end), ascending. 7d/30d uptime/history. */
  private async fetchRollupCounts(
    monitorId: string,
    start: Date,
    end: Date,
  ): Promise<{ bucketStart: Date; upCount: number; degradedCount: number; downCount: number }[]> {
    return this.db
      .select({
        bucketStart: checkRollupsHourly.bucketStart,
        upCount: checkRollupsHourly.upCount,
        degradedCount: checkRollupsHourly.degradedCount,
        downCount: checkRollupsHourly.downCount,
      })
      .from(checkRollupsHourly)
      .where(
        and(
          eq(checkRollupsHourly.monitorId, monitorId),
          gte(checkRollupsHourly.bucketStart, start),
          lt(checkRollupsHourly.bucketStart, end),
        ),
      )
      .orderBy(asc(checkRollupsHourly.bucketStart));
  }

  /** Hourly rollup avg/p95 series in [start, end), ascending. 7d/30d series. */
  private async fetchRollupSeries(
    monitorId: string,
    start: Date,
    end: Date,
  ): Promise<{ bucketStart: Date; avgResponseTimeMs: number | null; p95ResponseTimeMs: number | null }[]> {
    return this.db
      .select({
        bucketStart: checkRollupsHourly.bucketStart,
        avgResponseTimeMs: checkRollupsHourly.avgResponseTimeMs,
        p95ResponseTimeMs: checkRollupsHourly.p95ResponseTimeMs,
      })
      .from(checkRollupsHourly)
      .where(
        and(
          eq(checkRollupsHourly.monitorId, monitorId),
          gte(checkRollupsHourly.bucketStart, start),
          lt(checkRollupsHourly.bucketStart, end),
        ),
      )
      .orderBy(asc(checkRollupsHourly.bucketStart));
  }
}

/** Truncate a Date to the start of its hour (local-agnostic, UTC-based on epoch). */
function startOfHour(d: Date): Date {
  const ms = d.getTime();
  return new Date(ms - (ms % (60 * 60 * 1000)));
}
