import { sql } from 'drizzle-orm';

import { getDb } from './index';

/**
 * Tick partition lifecycle helpers (ADR-005 / Task 1.2a).
 *
 * These functions are the runtime mirror of the migration's hand-rolled
 * partition bootstrap. Concretely:
 *
 *  - The migration (`drizzle/0001_*.sql`) declares `ticks` as
 *    `PARTITION BY RANGE (ts_ms)` and creates partitions for the current
 *    month (2026-05) and the next month (2026-06).
 *  - On every server boot AND on the daily 03:00 UTC sweep that Task
 *    1.2b wires, `ensureRollingPartitions(lookaheadMonths)` is called to
 *    pre-create the next N months of partitions if they are missing.
 *    Default `lookaheadMonths = 2` matches the migration's initial window.
 *  - On the same daily sweep, `dropTickPartitionsOlderThan(30)` removes
 *    any partition whose UPPER bound is strictly before
 *    `today - retentionDays` — i.e. every byte in the partition is
 *    outside the retention window. Day-aligned by design: we never drop
 *    a partition that still contains data inside retention.
 *
 * Hard failure mode: missing `DATABASE_URL`. The runtime path requires
 * the DB and these helpers reach for `getDb()` which throws fail-fast on
 * a missing env var. That is intentional — partition management is not
 * an observability path and must not silently no-op (the next month
 * would arrive without a partition and tick inserts would fail).
 *
 * Idempotency: every CREATE statement uses `IF NOT EXISTS`. The DROP
 * loop is naturally idempotent (a partition that does not exist is not
 * dropped).
 *
 * Concurrent-replay-reader tolerance (Task 1.2b wiring): the drop loop
 * sets `lock_timeout = '5s'` for the session so a long-running ACCESS
 * SHARE lock from a replay scan does not deadlock the maintenance
 * window — if the timeout fires, the drop is reported as skipped and
 * the next sweep retries. This file exposes the helper; the timeout
 * decision is on the caller (Task 1.2b's scheduler).
 */

/**
 * Partition name convention: `ticks_y<YYYY>m<MM>` (two-digit month, no
 * separator). Documented here so the drop loop and any future ops tool
 * can re-derive the name from a (year, month) pair without ambiguity.
 */
function partitionName(year: number, month1to12: number): string {
  if (year < 1970 || year > 9999) {
    throw new RangeError(`partition year out of range: ${String(year)}`);
  }
  if (month1to12 < 1 || month1to12 > 12) {
    throw new RangeError(`partition month out of range: ${String(month1to12)}`);
  }
  const mm = month1to12.toString().padStart(2, '0');
  return `ticks_y${year.toString()}m${mm}`;
}

/**
 * Inclusive lower bound (ms) and exclusive upper bound (ms) for the
 * given calendar month in UTC. `Date.UTC(year, monthIndex0to11, 1)` is
 * the deterministic constructor — no host-timezone influence.
 */
function partitionBoundsMs(year: number, month1to12: number): {
  fromMs: number;
  toMs: number;
} {
  const monthIndex = month1to12 - 1;
  const fromMs = Date.UTC(year, monthIndex, 1);
  // `Date.UTC` rolls month 12 to year + 1 month 0 (January) by spec.
  const toMs = Date.UTC(year, monthIndex + 1, 1);
  return { fromMs, toMs };
}

/**
 * Create the partition for the given (year, month1to12) if it does not
 * already exist. Pure SQL via `db.execute(sql\`...\`)`. Idempotent.
 *
 * Throws `Error` if `DATABASE_URL` is unset (via `getDb()`) — partition
 * management must fail loudly, never silently no-op.
 */
export async function ensureTickPartitionFor(
  year: number,
  month1to12: number,
): Promise<void> {
  const db = getDb();
  const name = partitionName(year, month1to12);
  const { fromMs, toMs } = partitionBoundsMs(year, month1to12);
  // `IF NOT EXISTS` is the idempotency surface. Identifier quoting via
  // sql.identifier; bigint literals interpolated as numbers (safe — no
  // user input, deterministic from the (year, month) arguments).
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(name)}
        PARTITION OF ${sql.identifier('ticks')}
        FOR VALUES FROM (${fromMs}) TO (${toMs})`,
  );
}

/**
 * Create partitions for the current month and the next `lookaheadMonths`
 * months if they are missing. Default `lookaheadMonths = 2` matches the
 * window the migration bootstraps with, so a fresh checkout that ran
 * the migration is no-op on first boot, and the daily 03:00 UTC sweep
 * (Task 1.2b) extends the window one month forward per sweep.
 *
 * The "current month" anchor uses `Date.now()` so the function is
 * deterministic against the wall clock; tests that need a different
 * anchor should call `ensureTickPartitionFor` directly.
 */
export async function ensureRollingPartitions(
  lookaheadMonths = 2,
): Promise<void> {
  if (!Number.isInteger(lookaheadMonths) || lookaheadMonths < 0) {
    throw new RangeError(
      `lookaheadMonths must be a non-negative integer: ${String(lookaheadMonths)}`,
    );
  }
  const now = new Date();
  const baseYear = now.getUTCFullYear();
  const baseMonth0 = now.getUTCMonth();
  // Iterate inclusive of the anchor month so the loop covers
  // [current, current + lookaheadMonths] = lookaheadMonths + 1 partitions.
  // Partitions are created sequentially to keep error attribution clean;
  // the loop is tiny (3 iterations by default) so parallelism would not
  // pay off.
  for (let offset = 0; offset <= lookaheadMonths; offset += 1) {
    const monthIndex = baseMonth0 + offset;
    const year = baseYear + Math.floor(monthIndex / 12);
    const month1to12 = (((monthIndex % 12) + 12) % 12) + 1;
    await ensureTickPartitionFor(year, month1to12);
  }
}

/**
 * Drop any tick partition whose UPPER bound is strictly before
 * `today_start_utc - retentionDays * 86_400_000`. Returns the list of
 * dropped partition names so callers can structured-log them.
 *
 * Day-alignment: the cutoff is computed against the UTC midnight of
 * "today", not against `Date.now()`. This means we never drop a
 * partition that contains a single millisecond of data inside the
 * retention window — the upper bound (exclusive) must be ≤ the cutoff.
 *
 * The function uses `pg_partition_tree` / `pg_get_expr` to read every
 * existing partition of `ticks` and its bounds expression, parses the
 * `FOR VALUES FROM (...) TO (...)` clause, and drops the ones outside
 * the window. Partition names that do not match the
 * `ticks_y<YYYY>m<MM>` convention are skipped (not our partitions).
 *
 * This function does NOT set `lock_timeout` — the Task 1.2b scheduler
 * owns the lock-timeout decision because the right value depends on the
 * concurrent-reader policy in force.
 */
export async function dropTickPartitionsOlderThan(
  retentionDays: number,
): Promise<string[]> {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new RangeError(
      `retentionDays must be a non-negative integer: ${String(retentionDays)}`,
    );
  }
  const db = getDb();
  const now = new Date();
  const todayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const cutoffMs = todayStartMs - retentionDays * 86_400_000;

  // Read every partition of `ticks` with its bounds expression. The
  // `pg_get_expr(relpartbound, oid)` call renders the bounds clause as
  // SQL text we can pattern-match below.
  const rows = await db.execute<{
    partition_name: string;
    bounds_expr: string;
  }>(
    sql`SELECT child.relname AS partition_name,
               pg_get_expr(child.relpartbound, child.oid) AS bounds_expr
        FROM pg_inherits
        JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
        JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
        WHERE parent.relname = 'ticks'`,
  );

  const dropped: string[] = [];
  // Drizzle's `db.execute` returns an array-like; postgres-js wraps it
  // in a `Result` that iterates as the row set.
  for (const row of rows as unknown as Iterable<{
    partition_name: string;
    bounds_expr: string;
  }>) {
    const name = row.partition_name;
    // Only drop our own naming convention — manual partitions or
    // future bespoke partitions stay untouched.
    if (!/^ticks_y\d{4}m\d{2}$/.test(name)) continue;
    // `pg_get_expr` renders the clause as
    //   FOR VALUES FROM ('1777593600000') TO ('1780272000000')
    // Postgres quotes bigint literals as text; we parse both bounds.
    const match = /FROM \(['"]?(\d+)['"]?\) TO \(['"]?(\d+)['"]?\)/.exec(
      row.bounds_expr,
    );
    if (match?.[2] === undefined) continue;
    const upperMs = Number(match[2]);
    if (!Number.isFinite(upperMs)) continue;
    // Strictly-before the cutoff: the partition's last possible row is
    // upperMs - 1, so the whole partition is outside retention iff
    // upperMs <= cutoffMs.
    if (upperMs > cutoffMs) continue;
    // Drops are sequential so a single partition failure does not
    // cascade across the sweep.
    await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(name)}`);
    dropped.push(name);
  }
  return dropped;
}
