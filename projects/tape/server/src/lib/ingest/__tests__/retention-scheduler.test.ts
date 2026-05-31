/**
 * RetentionScheduler unit tests — Task 1.2b.
 *
 * Covers:
 *  - Constants match ADR-005 verbatim (03:00 UTC sweep, 30-day retention,
 *    2-month lookahead).
 *  - `computeNext3amUtc` returns the correct moment for 5 representative
 *    "now" inputs (midnight, just-before-3am, just-after-3am, midday,
 *    end-of-month edge) — the brief lists these five exactly.
 *  - Bootstrap-once-on-start: start() runs ONE sweep immediately before
 *    arming the timer. A start() call when no time has passed must
 *    invoke ensureRollingPartitions + dropOldPartitions exactly once
 *    each.
 *  - Lag-day computation rounds toward zero against the exclusive
 *    upper bound; 0 when ahead, positive when behind.
 *  - stop() cancels the pending timeout.
 *  - Read-latest stub returning null leaves partitionCreateLagDays
 *    at 0 (fresh-checkout-friendly).
 *
 * The DB path is fully mocked. No live Postgres dependency.
 *
 * Style note on the async-stub shape: ESLint's
 * `@typescript-eslint/require-await` would reject `async () => Date.UTC(...)`
 * because there is no await; the equivalent `() => Promise.resolve(...)`
 * shape both satisfies the rule and stays one line, so every stub below
 * uses it.
 */

import { describe, expect, test } from 'bun:test';

import {
  MS_PER_DAY,
  PARTITION_LOOKAHEAD_MONTHS,
  RETENTION_DAYS,
  RETENTION_SWEEP_HOUR_UTC,
  RetentionScheduler,
  __resetRetentionSchedulerSingletonForTests,
  computeNext3amUtc,
  computePartitionCreateLagDays,
  getRetentionScheduler,
  type TimeoutHandle,
  type TimeoutScheduler,
} from '../retention-scheduler';

const noopEnsure = (): Promise<void> => Promise.resolve();
const noopDrop = (): Promise<string[]> => Promise.resolve<string[]>([]);
const stubUpper = (ms: number) => (): Promise<number | null> =>
  Promise.resolve(ms);
const stubUpperNull = (): Promise<number | null> => Promise.resolve(null);

class FakeTimeoutScheduler implements TimeoutScheduler {
  #nextId = 0;
  #handlers = new Map<number, { handler: () => void; ms: number }>();
  lastDelayMs: number | null = null;

  setTimeout(handler: () => void, ms: number): TimeoutHandle {
    this.lastDelayMs = ms;
    const id = this.#nextId++;
    this.#handlers.set(id, { handler, ms });
    return id as unknown as TimeoutHandle;
  }

  clearTimeout(handle: TimeoutHandle): void {
    this.#handlers.delete(handle as unknown as number);
  }

  get pendingCount(): number {
    return this.#handlers.size;
  }

  /**
   * Fire the most recently-scheduled timeout. Mirrors the immediate
   * single-fire pattern in `RetentionScheduler.#scheduleNext`.
   */
  fireLatest(): void {
    if (this.#handlers.size === 0) throw new Error('no pending timeouts');
    const lastId = Math.max(...this.#handlers.keys());
    const entry = this.#handlers.get(lastId);
    if (entry === undefined) throw new Error('no pending timeouts');
    this.#handlers.delete(lastId);
    entry.handler();
  }
}

describe('RetentionScheduler — constants match ADR-005', () => {
  test('sweep hour is 03:00 UTC (ADR-005 verbatim)', () => {
    expect(RETENTION_SWEEP_HOUR_UTC).toBe(3);
  });

  test('retention horizon is 30 days (ADR-005 verbatim)', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  test('partition lookahead is 2 months (ADR-005 verbatim)', () => {
    expect(PARTITION_LOOKAHEAD_MONTHS).toBe(2);
  });

  test('day constant is 86_400_000 ms', () => {
    expect(MS_PER_DAY).toBe(86_400_000);
  });
});

describe('computeNext3amUtc — five canonical inputs', () => {
  test('midnight UTC → today 03:00 UTC (same day)', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 0, 0, 0, 0));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-05-15T03:00:00.000Z');
  });

  test('just-before-3am UTC → today 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 2, 59, 59, 999));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-05-15T03:00:00.000Z');
  });

  test('just-after-3am UTC → tomorrow 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 3, 0, 0, 1));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-05-16T03:00:00.000Z');
  });

  test('midday UTC → tomorrow 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 12, 0, 0, 0));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-05-16T03:00:00.000Z');
  });

  test('end-of-month edge (May 31 23:00 UTC) → June 1 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 31, 23, 0, 0, 0));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  test('end-of-year edge (Dec 31 23:00 UTC) → Jan 1 next year 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 0, 0, 0));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  test('exact 03:00:00.000 → tomorrow (strict-after semantics)', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 3, 0, 0, 0));
    const next = computeNext3amUtc(now);
    expect(next.toISOString()).toBe('2026-05-16T03:00:00.000Z');
  });
});

describe('computePartitionCreateLagDays', () => {
  test('upper bound = today midnight → lag 0 (today covered)', () => {
    const today = Date.UTC(2026, 5, 1, 12, 0, 0, 0);
    const upper = Date.UTC(2026, 5, 1, 0, 0, 0, 0);
    expect(computePartitionCreateLagDays(today, upper)).toBe(0);
  });

  test('upper bound = tomorrow midnight → lag 0 (ahead, clamped)', () => {
    const today = Date.UTC(2026, 5, 1, 12, 0, 0, 0);
    const upper = Date.UTC(2026, 5, 2, 0, 0, 0, 0);
    expect(computePartitionCreateLagDays(today, upper)).toBe(0);
  });

  test('upper bound = yesterday midnight → lag 1', () => {
    const today = Date.UTC(2026, 5, 2, 12, 0, 0, 0);
    const upper = Date.UTC(2026, 5, 1, 0, 0, 0, 0);
    expect(computePartitionCreateLagDays(today, upper)).toBe(1);
  });

  test('upper bound = 7 days ago midnight → lag 7', () => {
    const today = Date.UTC(2026, 5, 10, 12, 0, 0, 0);
    const upper = Date.UTC(2026, 5, 3, 0, 0, 0, 0);
    expect(computePartitionCreateLagDays(today, upper)).toBe(7);
  });

  test('upper bound far in the past → large lag', () => {
    const today = Date.UTC(2026, 5, 1, 12, 0, 0, 0);
    const upper = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
    expect(computePartitionCreateLagDays(today, upper)).toBe(31);
  });
});

describe('RetentionScheduler — bootstrap-once-on-start', () => {
  test('start runs ensureRollingPartitions and dropOldPartitions exactly once before arming the timer', async () => {
    let ensureCount = 0;
    let dropCount = 0;
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: () => {
        ensureCount += 1;
        return Promise.resolve();
      },
      dropOldPartitions: () => {
        dropCount += 1;
        return Promise.resolve<string[]>([]);
      },
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    expect(scheduler.pendingCount).toBe(0);
    await retention.start();
    expect(ensureCount).toBe(1);
    expect(dropCount).toBe(1);
    // After the boot sweep, the next 03:00 UTC timeout is armed.
    expect(scheduler.pendingCount).toBe(1);
    expect(retention.running).toBe(true);
  });

  test('start is idempotent — repeat call does not re-bootstrap', async () => {
    let ensureCount = 0;
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: () => {
        ensureCount += 1;
        return Promise.resolve();
      },
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    await retention.start();
    expect(ensureCount).toBe(1);
    expect(scheduler.pendingCount).toBe(1);
  });

  test('boot sweep schedules the next 03:00 UTC moment', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const nowMs = Date.UTC(2026, 4, 15, 12, 0, 0, 0); // 12:00 UTC
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => nowMs,
    });
    await retention.start();
    // Expect the scheduled delay to be (tomorrow 03:00 UTC - nowMs).
    const expectedNextMs = Date.UTC(2026, 4, 16, 3, 0, 0, 0);
    expect(scheduler.lastDelayMs).toBe(expectedNextMs - nowMs);
  });
});

describe('RetentionScheduler — lag-day wiring', () => {
  test('boot sweep populates partitionCreateLagDays from the read-upper-bound stub', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(
        Date.UTC(2026, 4, 1, 0, 0, 0, 0),
      ),
      scheduler,
      now: () => Date.UTC(2026, 4, 4, 12, 0, 0, 0), // 3 days past upper
    });
    await retention.start();
    expect(retention.partitionCreateLagDays).toBe(3);
  });

  test('null upper bound (no matching partitions) leaves lag at 0', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpperNull,
      scheduler,
      now: () => Date.UTC(2026, 5, 1, 12, 0, 0, 0),
    });
    await retention.start();
    expect(retention.partitionCreateLagDays).toBe(0);
  });

  test('failure inside readLatestPartitionUpperBoundMs leaves lag untouched', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: () =>
        Promise.reject<number | null>(new Error('pg_inherits query failed')),
      scheduler,
      now: () => Date.UTC(2026, 5, 1, 12, 0, 0, 0),
    });
    await retention.start();
    expect(retention.partitionCreateLagDays).toBe(0);
  });
});

describe('RetentionScheduler — drop reporting + ensure tolerance', () => {
  test('lastDroppedPartitions reflects the drop stub return value', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: () =>
        Promise.resolve<string[]>(['ticks_y2026m01', 'ticks_y2026m02']),
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    expect(retention.lastDroppedPartitions).toEqual([
      'ticks_y2026m01',
      'ticks_y2026m02',
    ]);
  });

  test('drop failure does not break the sweep — lag still updates', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: () =>
        Promise.reject<string[]>(new Error('lock_timeout fired')),
      readLatestPartitionUpperBoundMs: stubUpper(
        Date.UTC(2026, 4, 1, 0, 0, 0, 0),
      ),
      scheduler,
      now: () => Date.UTC(2026, 4, 4, 12, 0, 0, 0),
    });
    await retention.start();
    expect(retention.lastDroppedPartitions).toEqual([]);
    expect(retention.partitionCreateLagDays).toBe(3);
  });

  test('ensureRollingPartitions failure does not break the sweep', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: () =>
        Promise.reject(new Error('pg connection refused')),
      dropOldPartitions: () => Promise.resolve<string[]>(['ticks_y2026m01']),
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    expect(retention.lastDroppedPartitions).toEqual(['ticks_y2026m01']);
  });
});

describe('RetentionScheduler — stop', () => {
  test('stop clears the pending timeout', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    expect(scheduler.pendingCount).toBe(1);
    retention.stop();
    expect(scheduler.pendingCount).toBe(0);
    expect(retention.running).toBe(false);
  });

  test('stop is idempotent', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      ensureRollingPartitions: noopEnsure,
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    retention.stop();
    retention.stop();
    expect(retention.running).toBe(false);
  });
});

describe('RetentionScheduler — sweep cadence', () => {
  test('firing the scheduled timeout re-runs the sweep and re-arms the next', async () => {
    let ensureCount = 0;
    const scheduler = new FakeTimeoutScheduler();
    const t0 = Date.UTC(2026, 4, 15, 2, 30, 0, 0); // 2:30 UTC
    let nowMs = t0;
    const retention = new RetentionScheduler({
      ensureRollingPartitions: () => {
        ensureCount += 1;
        return Promise.resolve();
      },
      dropOldPartitions: noopDrop,
      readLatestPartitionUpperBoundMs: stubUpper(Date.UTC(2026, 5, 1)),
      scheduler,
      now: () => nowMs,
    });
    await retention.start();
    expect(ensureCount).toBe(1);
    // Advance to 03:00:01 UTC, fire the timer.
    nowMs = Date.UTC(2026, 4, 15, 3, 0, 1, 0);
    scheduler.fireLatest();
    // Sweep is async with multiple awaits inside; drain the microtask
    // queue until the post-sweep `.finally` lands and re-arms the timer.
    // Polling instead of N x `Promise.resolve()` keeps the test stable
    // across future refactors that add or remove internal awaits.
    for (let i = 0; i < 50 && scheduler.pendingCount === 0; i += 1) {
      await Promise.resolve();
    }
    expect(ensureCount).toBe(2);
    // Next timer armed.
    expect(scheduler.pendingCount).toBe(1);
  });
});

describe('getRetentionScheduler — singleton', () => {
  test('returns the same instance across calls', () => {
    __resetRetentionSchedulerSingletonForTests();
    const a = getRetentionScheduler();
    const b = getRetentionScheduler();
    expect(a).toBe(b);
    __resetRetentionSchedulerSingletonForTests();
    const c = getRetentionScheduler();
    expect(c).not.toBe(a);
  });
});
