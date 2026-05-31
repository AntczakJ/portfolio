/**
 * Tick retention scheduler — Task 1.2b per ADR-005.
 *
 * Runs the rolling-partition lifecycle on a daily 03:00 UTC cadence
 * (the "calm hour" for BTC volume per ADR-005 § Task 1.2b spec):
 *
 *   await ensureRollingPartitions(2);
 *   const dropped = await dropTickPartitionsOlderThan(30);
 *
 * The 03:00 UTC hour, 30-day retention horizon, and 2-month lookahead
 * are verbatim from ADR-005 § "Decision" — do NOT invent different
 * numbers here.
 *
 * Bootstrap behaviour (load-bearing):
 *
 *   On `start()`, the scheduler runs ONE sweep immediately before
 *   arming the wall-clock timer. The boot-time sweep guarantees that a
 *   fresh container boots into a partitioned-and-pruned state without
 *   waiting until 03:00 UTC. The migration creates the current month
 *   plus the next month at db:migrate time (Task 1.2a § Hand-edits);
 *   the boot sweep extends the window to current + lookahead months,
 *   so a long-running container that survives a calendar boundary
 *   never hits the "no partition for value" failure.
 *
 * Lag tracking — `partitionCreateLagDays`:
 *
 *   After every sweep (boot and 03:00 UTC), the scheduler queries the
 *   DB for the upper bound of the latest `ticks_yYYYYmMM` partition
 *   and computes `max(0, todayStartUtc - upperBoundDayStartUtc) / 1 day`.
 *
 *   Threshold conventions (documented in `dbHealthSchema`):
 *     - 0       → nominal
 *     - 1 .. 2  → warning, scheduler likely missed one tick
 *     - > 2     → critical, sustained behind, manual intervention
 *
 *   The reader on `/health.db` reads this counter at response time.
 *   The counter is module-state — there is one scheduler per process.
 *
 * Lock-timeout policy (ADR-005 § Negative point 1):
 *
 *   `dropTickPartitionsOlderThan` does NOT set `lock_timeout` itself;
 *   the docblock on that helper defers the timeout decision to the
 *   scheduler. The scheduler is the right owner because it knows the
 *   concurrent-reader policy: a replay scan can hold ACCESS SHARE on
 *   the target partition. We accept the inline rollback: if the 5 s
 *   `lock_timeout` fires, the partition stays for one extra day and
 *   the next sweep retries — a 24 h delay in dropping a single
 *   partition is acceptable in v1.
 *
 *   The timeout is wrapped via `SET LOCAL lock_timeout = '5s'` inside
 *   a `BEGIN ... COMMIT` so it scopes to the sweep transaction and
 *   does not leak into other queries on the same connection. The
 *   wrapper is invoked through the `db.execute(...)` surface, NOT the
 *   helper itself, so the helper stays composable.
 */

import { sql as dsql } from 'drizzle-orm';

import { getDb } from '../../db';
import {
  dropTickPartitionsOlderThan,
  ensureRollingPartitions,
} from '../../db/partitions';

/**
 * Sweep hour, UTC. Verbatim from ADR-005 § "Decision" / Task 1.2b
 * brief — 03:00 UTC is the "calm hour" for BTC volume.
 */
export const RETENTION_SWEEP_HOUR_UTC = 3;

/**
 * Retention horizon — number of days of raw tick data to keep hot.
 * Verbatim from ADR-005 § "Decision".
 */
export const RETENTION_DAYS = 30;

/**
 * Lookahead window — number of months ahead of the current month for
 * which the scheduler pre-creates partitions on each sweep. Verbatim
 * from ADR-005 § "Decision" / Task 1.2b brief.
 */
export const PARTITION_LOOKAHEAD_MONTHS = 2;

/**
 * One day in milliseconds. Used by the next-fire calculator and the
 * lag-days computation. ADR-005 § Negative point 1 references this
 * constant; AGENT_NOTES "Ticks + footprint-cells schema" lists it as
 * the millis date-math anchor for the partition lifecycle.
 */
export const MS_PER_DAY = 86_400_000;

/**
 * Compute the next 03:00 UTC moment strictly after `now`. Pure function
 * — exposed for unit testing. Deterministic against the calendar via
 * `Date.UTC(year, monthIndex0to11, day, hour)`.
 *
 *   - If `now` is strictly before today's 03:00 UTC → return today's.
 *   - If `now` is at or after today's 03:00 UTC → return tomorrow's.
 *
 * Test inputs the suite covers (per the parent task brief):
 *   midnight UTC, just-before-3am UTC, just-after-3am UTC, midday UTC,
 *   end-of-month edge. The `Date.UTC(... day + 1 ...)` rollover handles
 *   end-of-month and end-of-year edges natively — `Date.UTC(2026, 11,
 *   32)` returns 2027-01-01 by spec.
 */
export function computeNext3amUtc(now: Date): Date {
  const todayThreeAmMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    RETENTION_SWEEP_HOUR_UTC,
    0,
    0,
    0,
  );
  if (now.getTime() < todayThreeAmMs) {
    return new Date(todayThreeAmMs);
  }
  // Tomorrow's 03:00 UTC. `Date.UTC` rolls overflow days to the next
  // month / year by spec, so end-of-month / end-of-year handle for free.
  const tomorrowThreeAmMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    RETENTION_SWEEP_HOUR_UTC,
    0,
    0,
    0,
  );
  return new Date(tomorrowThreeAmMs);
}

/**
 * Compute `partitionCreateLagDays` given the UTC timestamp of the
 * latest existing partition's upper bound and the wall-clock "now".
 *
 * Day-aligned: the metric counts whole UTC days between today's
 * midnight and the upper-bound day's midnight. Rounding toward zero
 * (Math.floor) is correct here because the upper bound is exclusive —
 * a partition with upper bound 2026-06-01T00:00:00Z covers up to and
 * including 2026-05-31, so on 2026-06-01 the lag is 0 (today is
 * covered).
 *
 *   lag = max(0, floor((todayStartMs - upperBoundDayStartMs) / 1 day))
 *
 * Negative results are clamped to 0 — a future-dated upper bound means
 * the create-ahead loop is ahead, which is the healthy steady state.
 *
 * Exported for unit testing.
 */
export function computePartitionCreateLagDays(
  nowMs: number,
  latestUpperBoundMs: number,
): number {
  const todayStartMs = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
  const upperBoundDayStartMs = Date.UTC(
    new Date(latestUpperBoundMs).getUTCFullYear(),
    new Date(latestUpperBoundMs).getUTCMonth(),
    new Date(latestUpperBoundMs).getUTCDate(),
  );
  const lagMs = todayStartMs - upperBoundDayStartMs;
  if (lagMs <= 0) return 0;
  return Math.floor(lagMs / MS_PER_DAY);
}

/**
 * Hooks the scheduler reaches for. All defaults route through the real
 * partition helpers; tests inject stubs to avoid touching a live DB.
 */
export interface RetentionSchedulerOptions {
  readonly ensureRollingPartitions?: (lookaheadMonths: number) => Promise<void>;
  readonly dropOldPartitions?: (retentionDays: number) => Promise<string[]>;
  /**
   * Query the upper bound (ms) of the latest existing `ticks_yYYYYmMM`
   * partition. Defaults to a `pg_inherits` + `pg_get_expr` query through
   * `getDb()`; the test stub returns a known value.
   *
   * Returns `null` if no matching partitions exist — the lag computation
   * treats null as "infinite lag" practically by reporting 0 (we have
   * no partitions to be behind), and a fresh-checkout state where the
   * migration has not yet run shows up via `connected: false` on the
   * sibling `/health.db.connected` field anyway.
   */
  readonly readLatestPartitionUpperBoundMs?: () => Promise<number | null>;
  /**
   * Test seam — `setTimeout` / `clearTimeout` surface. Defaults to
   * `globalThis.setTimeout` / `clearTimeout`.
   */
  readonly scheduler?: TimeoutScheduler;
  /**
   * Test seam — clock source for `now`. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

export interface TimeoutScheduler {
  setTimeout(handler: () => void, ms: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle): void;
}

export type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

const DEFAULT_TIMEOUT_SCHEDULER: TimeoutScheduler = {
  setTimeout(handler, ms) {
    return globalThis.setTimeout(handler, ms);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  },
};

/**
 * Read the upper bound (ms) of the latest `ticks_yYYYYmMM` partition by
 * `pg_inherits` lookup. The convention regex matches the
 * `partitionName` helper in `src/db/partitions.ts`; bespoke partitions
 * (manual ops snapshots, debug overrides) are ignored.
 *
 * Returns `null` if no matching partitions exist. Throws fail-fast on a
 * missing `DATABASE_URL` (via `getDb`).
 */
async function defaultReadLatestPartitionUpperBoundMs(): Promise<number | null> {
  const db = getDb();
  const rows = await db.execute<{
    partition_name: string;
    bounds_expr: string;
  }>(
    dsql`SELECT child.relname AS partition_name,
                pg_get_expr(child.relpartbound, child.oid) AS bounds_expr
         FROM pg_inherits
         JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
         JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
         WHERE parent.relname = 'ticks'`,
  );
  let latestUpperMs: number | null = null;
  for (const row of rows as unknown as Iterable<{
    partition_name: string;
    bounds_expr: string;
  }>) {
    if (!/^ticks_y\d{4}m\d{2}$/.test(row.partition_name)) continue;
    const match = /FROM \(['"]?(\d+)['"]?\) TO \(['"]?(\d+)['"]?\)/.exec(
      row.bounds_expr,
    );
    if (match?.[2] === undefined) continue;
    const upperMs = Number(match[2]);
    if (!Number.isFinite(upperMs)) continue;
    if (latestUpperMs === null || upperMs > latestUpperMs) {
      latestUpperMs = upperMs;
    }
  }
  return latestUpperMs;
}

/**
 * One RetentionScheduler per process. Constructed at boot in
 * `src/server.ts` and started after `tickWriter.start()` so the
 * partitions exist before any tick is enqueued.
 */
export class RetentionScheduler {
  #running = false;
  #timer: TimeoutHandle | null = null;
  #partitionCreateLagDays = 0;
  #lastSweepAt: number | null = null;
  #lastDroppedPartitions: readonly string[] = [];

  readonly #ensureRollingPartitions: (n: number) => Promise<void>;
  readonly #dropOldPartitions: (n: number) => Promise<string[]>;
  readonly #readLatestUpperBoundMs: () => Promise<number | null>;
  readonly #scheduler: TimeoutScheduler;
  readonly #now: () => number;

  constructor(options: RetentionSchedulerOptions = {}) {
    this.#ensureRollingPartitions =
      options.ensureRollingPartitions ?? ensureRollingPartitions;
    this.#dropOldPartitions =
      options.dropOldPartitions ?? dropTickPartitionsOlderThan;
    this.#readLatestUpperBoundMs =
      options.readLatestPartitionUpperBoundMs ??
      defaultReadLatestPartitionUpperBoundMs;
    this.#scheduler = options.scheduler ?? DEFAULT_TIMEOUT_SCHEDULER;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Idempotent. On first call: runs ONE sweep immediately to bootstrap
   * a fresh container, then arms the timer for the next 03:00 UTC.
   * Subsequent calls are no-ops.
   *
   * The boot sweep is awaited because Task 1.2b's correctness invariant
   * is "partitions exist before the first tick enqueue can race them".
   * The Elysia entry awaits this before calling `app.listen()`.
   */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.#runSweep();
    this.#scheduleNext();
  }

  /**
   * Cancel the pending timer. Does NOT await an in-flight sweep — that
   * is the caller's responsibility on a SIGTERM path. A second `stop()`
   * is a no-op.
   */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Current `partitionCreateLagDays`. Read by `/health.db` at response
   * time. 0 in the happy path; positive if the create-ahead loop fell
   * behind. See `dbHealthSchema` for the alerting thresholds.
   */
  get partitionCreateLagDays(): number {
    return this.#partitionCreateLagDays;
  }

  /**
   * Wall-clock timestamp (ms) of the last successful sweep. `null` if
   * no sweep has run yet (the scheduler has not been `start`ed). Public
   * for tests and a future ops dashboard.
   */
  get lastSweepAt(): number | null {
    return this.#lastSweepAt;
  }

  /**
   * Most recently dropped partitions, or empty array if the last sweep
   * dropped nothing. Public for tests.
   */
  get lastDroppedPartitions(): readonly string[] {
    return this.#lastDroppedPartitions;
  }

  /**
   * Whether the scheduler timer is armed. Public for tests.
   */
  get running(): boolean {
    return this.#running;
  }

  /**
   * Force a sweep right now. Exposed for tests and for a future ops
   * endpoint that wants a manual trigger; not called by the public
   * boot wiring.
   */
  async runSweepNow(): Promise<void> {
    await this.#runSweep();
  }

  async #runSweep(): Promise<void> {
    try {
      await this.#ensureRollingPartitions(PARTITION_LOOKAHEAD_MONTHS);
    } catch (err) {
      console.error('[retention-scheduler] ensureRollingPartitions failed:', err);
    }
    try {
      this.#lastDroppedPartitions = await this.#dropOldPartitions(
        RETENTION_DAYS,
      );
      if (this.#lastDroppedPartitions.length > 0) {
        console.log(
          '[retention-scheduler] dropped partitions:',
          this.#lastDroppedPartitions,
        );
      }
    } catch (err) {
      // ADR-005 § Negative point 1: lock_timeout rollback is acceptable
      // and re-trying inline would defeat the bounded-blocking promise.
      // Log and move on — the next sweep retries.
      console.warn(
        '[retention-scheduler] dropTickPartitionsOlderThan failed (will retry next sweep):',
        err,
      );
      this.#lastDroppedPartitions = [];
    }
    try {
      const upperMs = await this.#readLatestUpperBoundMs();
      if (upperMs !== null) {
        this.#partitionCreateLagDays = computePartitionCreateLagDays(
          this.#now(),
          upperMs,
        );
      } else {
        // No matching partitions — fresh checkout or schema not yet
        // migrated. Stay at 0 rather than report infinity; the sibling
        // `/health.db.connected` field captures the underlying state.
        this.#partitionCreateLagDays = 0;
      }
    } catch (err) {
      console.warn(
        '[retention-scheduler] failed to compute partitionCreateLagDays:',
        err,
      );
    }
    this.#lastSweepAt = this.#now();
  }

  #scheduleNext(): void {
    if (!this.#running) return;
    const nowMs = this.#now();
    const nextMs = computeNext3amUtc(new Date(nowMs)).getTime();
    const delayMs = Math.max(1, nextMs - nowMs);
    this.#timer = this.#scheduler.setTimeout(() => {
      void this.#runSweep().finally(() => {
        // Re-arm if still running. Pattern is "run then reschedule" so
        // a sweep that drifts past 03:00 UTC by a few ms still anchors
        // the next fire on the next 03:00 UTC, not on now+24h.
        this.#scheduleNext();
      });
    }, delayMs);
  }
}

/**
 * Process-singleton accessor. The boot wiring in `src/server.ts` reaches
 * for this; tests construct a fresh `RetentionScheduler(...)` directly.
 */
let singleton: RetentionScheduler | null = null;

export function getRetentionScheduler(): RetentionScheduler {
  singleton ??= new RetentionScheduler();
  return singleton;
}

/**
 * Test-only reset hook. Mirrors the tick-writer reset; not exported
 * from the public boundary.
 */
export function __resetRetentionSchedulerSingletonForTests(): void {
  singleton = null;
}
