import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';

/**
 * Rollup service (Task 2.4, ADR-005) — aggregates raw `check_results` into
 * `check_rollups_hourly` so the 7d/30d uptime + the long-window response-time
 * chart read ~168 / ~720 pre-aggregated rows instead of tens of thousands of
 * raw rows (ADR-004).
 *
 * Idempotency + concurrency safety (the load-bearing properties):
 *   - The aggregation is a single `INSERT ... SELECT ... ON CONFLICT (monitor_id,
 *     bucket_start) DO UPDATE` against the `check_results` table. The PK
 *     `(monitor_id, bucket_start)` makes the upsert idempotent: a re-run for
 *     the same hour recomputes the bucket from the raw rows and overwrites,
 *     never double-counts. Because every bucket is recomputed from scratch
 *     (not incremented), two overlapping rollup runs converge to the same value
 *     — safe under concurrency.
 *   - We roll up a LOOKBACK window of recent hours (not just the current hour)
 *     so a late-arriving raw row or a missed tick still gets folded in. The
 *     window is bounded so the aggregation stays cheap.
 *
 * Runs every 5 minutes via the worker's repeatable `rollup` job (registered in
 * the worker's OnModuleInit).
 */

/**
 * How many recent hours to recompute on each run. The job fires every 5 min, so
 * recomputing the last few hours covers the still-open current bucket plus a
 * little history to catch late rows / a missed tick, while staying cheap.
 */
const ROLLUP_LOOKBACK_HOURS = 3;

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  /**
   * Recompute the hourly rollup buckets for the last {@link ROLLUP_LOOKBACK_HOURS}
   * hours from raw `check_results`. Idempotent upsert on the PK.
   *
   * The aggregation computes, per `(monitor_id, hour-truncated bucket)`:
   *   - up/degraded/down counts (filtered counts over the status enum),
   *   - unknown is always 0 here (an `unknown` is a GAP, not a recorded row —
   *     it is derived at read time per ADR-004, never written as a check_result),
   *   - avg / min / max response time (ignoring NULLs),
   *   - an approximate p95 via PostgreSQL's `percentile_cont`.
   */
  async rollupRecentHours(now: Date = new Date()): Promise<number> {
    // Pass the bound as an ISO string + explicit `::timestamptz` cast. The
    // postgres-js prepared-statement path does not reliably bind a raw `Date`
    // object as a timestamptz parameter; an ISO literal with a cast is the
    // portable form.
    const windowStart = new Date(now.getTime() - ROLLUP_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const result = await this.db.execute(sql`
      INSERT INTO check_rollups_hourly (
        monitor_id, bucket_start,
        up_count, degraded_count, down_count, unknown_count,
        avg_response_time_ms, p95_response_time_ms, min_ms, max_ms
      )
      SELECT
        cr.monitor_id,
        date_trunc('hour', cr.checked_at) AS bucket_start,
        count(*) FILTER (WHERE cr.status = 'up')::int        AS up_count,
        count(*) FILTER (WHERE cr.status = 'degraded')::int  AS degraded_count,
        count(*) FILTER (WHERE cr.status = 'down')::int       AS down_count,
        0 AS unknown_count,
        round(avg(cr.response_time_ms))::int                  AS avg_response_time_ms,
        round(
          percentile_cont(0.95) WITHIN GROUP (ORDER BY cr.response_time_ms)
        )::int                                                AS p95_response_time_ms,
        min(cr.response_time_ms)::int                         AS min_ms,
        max(cr.response_time_ms)::int                         AS max_ms
      FROM check_results cr
      WHERE cr.checked_at >= ${windowStart}::timestamptz
      GROUP BY cr.monitor_id, date_trunc('hour', cr.checked_at)
      ON CONFLICT (monitor_id, bucket_start) DO UPDATE SET
        up_count = EXCLUDED.up_count,
        degraded_count = EXCLUDED.degraded_count,
        down_count = EXCLUDED.down_count,
        unknown_count = EXCLUDED.unknown_count,
        avg_response_time_ms = EXCLUDED.avg_response_time_ms,
        p95_response_time_ms = EXCLUDED.p95_response_time_ms,
        min_ms = EXCLUDED.min_ms,
        max_ms = EXCLUDED.max_ms
    `);

    // postgres-js returns the affected-row count on the result; be tolerant of
    // the shape across driver versions.
    const count = this.affectedCount(result);
    this.logger.log(
      `rollup: upserted ${String(count)} hourly bucket(s) from the last ${String(ROLLUP_LOOKBACK_HOURS)}h`,
    );
    return count;
  }

  private affectedCount(result: unknown): number {
    // postgres-js DML results expose the affected-row count on `.count`; the
    // result is also array-like (empty for INSERT...SELECT), so prefer `.count`.
    if (result && typeof result === 'object' && 'count' in result) {
      const c = (result as { count?: unknown }).count;
      if (typeof c === 'number') return c;
    }
    if (Array.isArray(result)) return result.length;
    return 0;
  }
}
