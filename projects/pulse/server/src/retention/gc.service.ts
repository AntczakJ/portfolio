import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';

/**
 * GC / retention sweep (Task 2.4, ADR-005).
 *
 * Bounds Postgres growth on a long-running demo (the AGENT_NOTES hard
 * requirement — never ship without a retention call):
 *   - raw `check_results` older than {@link RAW_RETENTION_DAYS} (35d) are
 *     pruned. 35d covers the 30d uptime view with margin; the 7d/30d windows
 *     read the rollups, not raw rows.
 *   - `check_rollups_hourly` older than {@link ROLLUP_RETENTION_DAYS} (400d) are
 *     pruned (cheap — 24 rows/day/monitor).
 *
 * Concurrency + lock safety: the raw delete is BATCHED (delete up to
 * {@link DELETE_BATCH} rows per statement, loop until a batch deletes fewer than
 * the batch size) so a single DELETE never takes a long table lock on a large
 * table. The predicate is on the indexed `checked_at` path. Two overlapping GC
 * runs are safe — each deletes a disjoint slice and a row already gone is a
 * no-op.
 *
 * Runs hourly via the worker's repeatable `gc` job.
 */

const RAW_RETENTION_DAYS = 35;
const ROLLUP_RETENTION_DAYS = 400;

/** Rows deleted per batched statement (keeps the lock short). */
const DELETE_BATCH = 5_000;

/** Safety cap on batch iterations so a runaway never loops forever. */
const MAX_BATCHES = 1_000;

@Injectable()
export class GcService {
  private readonly logger = new Logger(GcService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  /** Run both sweeps. Returns the number of rows pruned from each table. */
  async sweep(now: Date = new Date()): Promise<{ rawDeleted: number; rollupsDeleted: number }> {
    // ISO strings + `::timestamptz` casts — the portable postgres-js bind form
    // (a raw Date is not reliably bound as a timestamptz parameter).
    const rawCutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rollupCutoff = new Date(
      now.getTime() - ROLLUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rawDeleted = await this.batchedDeleteRawResults(rawCutoff);
    const rollupsDeleted = await this.deleteOldRollups(rollupCutoff);

    this.logger.log(
      `gc: pruned ${String(rawDeleted)} raw check_results (< ${rawCutoff}) ` +
        `and ${String(rollupsDeleted)} rollup rows (< ${rollupCutoff})`,
    );
    return { rawDeleted, rollupsDeleted };
  }

  /**
   * Batched DELETE of raw `check_results` older than `cutoff`. Each statement
   * deletes at most {@link DELETE_BATCH} rows (via a `ctid IN (... LIMIT n)`
   * subselect) so the lock is short; loops until a batch is smaller than the
   * cap (nothing left) or the safety cap is hit.
   */
  private async batchedDeleteRawResults(cutoff: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result = await this.db.execute(sql`
        DELETE FROM check_results
        WHERE ctid IN (
          SELECT ctid FROM check_results
          WHERE checked_at < ${cutoff}::timestamptz
          LIMIT ${DELETE_BATCH}
        )
      `);
      const deleted = this.affectedCount(result);
      total += deleted;
      if (deleted < DELETE_BATCH) break;
    }
    return total;
  }

  /** Delete old rollup rows. Cheap enough (low volume) for a single statement. */
  private async deleteOldRollups(cutoff: string): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM check_rollups_hourly WHERE bucket_start < ${cutoff}::timestamptz
    `);
    return this.affectedCount(result);
  }

  private affectedCount(result: unknown): number {
    // postgres-js DELETE results expose the affected-row count on `.count`.
    if (result && typeof result === 'object' && 'count' in result) {
      const c = (result as { count?: unknown }).count;
      if (typeof c === 'number') return c;
    }
    if (Array.isArray(result)) return result.length;
    return 0;
  }
}
