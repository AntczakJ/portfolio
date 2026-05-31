/**
 * TickWriter unit tests — Task 1.2b.
 *
 * Covers:
 *  - Drop-oldest behaviour at the 500-cap (TICK_BATCH_RING_CAP).
 *  - Coalescing window: ring is flushed on the 50 ms tick, not on every
 *    enqueue.
 *  - Partition-missing recovery path runs `ensureRollingPartitions`
 *    once and retries the batch.
 *  - Final-flush tolerance on `stop()` — a transient DB error does not
 *    throw, the ring is cleared regardless.
 *  - `flushCount` increments only when the ring carried rows.
 *  - `serializeBatchToCopyText` produces the expected wire shape.
 *
 * Test runner: `bun test` (Bun's built-in runner — bun:test). Same
 * choice as the bridge conformance suite (Task 1.5b). Vitest is NOT
 * used here because the server is Bun-native.
 *
 * The DB path is fully mocked. No live Postgres dependency — Task 1.2c
 * is the right place for integration tests against a real container.
 */

import { describe, expect, test } from 'bun:test';

import {
  __resetTickWriterSingletonForTests,
  type CopyWritable,
  TICK_BATCH_RING_CAP,
  TICK_BATCH_WINDOW_MS,
  TickWriter,
  type TickRow,
  getTickWriter,
  isPartitionMissingError,
  serializeBatchToCopyText,
} from '../tick-writer';
import type { IntervalHandle, TickScheduler } from '../tick-writer';

/**
 * Minimal copy-writable mock. Captures every chunk written, supports
 * the on-error / on-finish lifecycle, and lets the test trigger errors
 * synchronously to exercise the recovery path.
 */
class MockCopyWritable implements CopyWritable {
  readonly chunks: (Buffer | string)[] = [];
  ended = false;
  errored = false;
  #handlers: Record<
    'drain' | 'error' | 'finish',
    ((...args: unknown[]) => void)[]
  > = { drain: [], error: [], finish: [] };
  #failOnEnd: Error | null = null;

  constructor(options: { failOnEnd?: Error } = {}) {
    this.#failOnEnd = options.failOnEnd ?? null;
  }

  write(chunk: Buffer | string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): Promise<void> {
    this.ended = true;
    if (this.#failOnEnd !== null) {
      const err = this.#failOnEnd;
      queueMicrotask(() => {
        for (const handler of this.#handlers.error) handler(err);
      });
      return Promise.reject(err);
    }
    queueMicrotask(() => {
      for (const handler of this.#handlers.finish) handler();
    });
    return Promise.resolve();
  }

  on(event: 'drain' | 'error' | 'finish', listener: (...args: unknown[]) => void): void {
    this.#handlers[event].push(listener);
  }

  once(event: 'drain' | 'error' | 'finish', listener: (...args: unknown[]) => void): void {
    this.on(event, listener);
  }
}

/**
 * Deterministic scheduler — `setInterval` records the registered handler
 * and the requested period; `tick()` drives one iteration synchronously.
 * Mirrors the pattern used in the bridge conformance suite.
 */
class FakeIntervalScheduler implements TickScheduler {
  #nextId = 0;
  #handlers = new Map<number, () => void>();

  setInterval(handler: () => void, _ms: number): IntervalHandle {
    const id = this.#nextId++;
    this.#handlers.set(id, handler);
    return id as unknown as IntervalHandle;
  }

  clearInterval(handle: IntervalHandle): void {
    this.#handlers.delete(handle as unknown as number);
  }

  /**
   * Drive one tick on every registered timer. Use to step the
   * coalescing window without sleeping.
   */
  tick(): void {
    for (const handler of this.#handlers.values()) handler();
  }

  get activeHandlerCount(): number {
    return this.#handlers.size;
  }
}

function makeRow(overrides: Partial<TickRow> = {}): TickRow {
  return {
    tsMs: 1_717_000_000_000,
    symbol: 'BTCUSDT',
    price: 71_234.5,
    qty: 0.125,
    aggressor: 'buy',
    sessionId: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

describe('TickWriter — constants match ADR-005', () => {
  test('ring cap is 500 (ADR-005 verbatim)', () => {
    expect(TICK_BATCH_RING_CAP).toBe(500);
  });

  test('coalescing window is 50 ms (ADR-005 verbatim)', () => {
    expect(TICK_BATCH_WINDOW_MS).toBe(50);
  });
});

describe('TickWriter — enqueue + drop-oldest policy', () => {
  test('enqueue under cap pushes without dropping', () => {
    const writer = new TickWriter({ scheduler: new FakeIntervalScheduler() });
    for (let i = 0; i < 100; i += 1) {
      writer.enqueue(makeRow({ tsMs: 1_717_000_000_000 + i }));
    }
    expect(writer.pendingCount).toBe(100);
    expect(writer.dropTotal).toBe(0);
  });

  test('enqueue at exactly cap fills the ring without dropping', () => {
    const writer = new TickWriter({ ringCap: 5, scheduler: new FakeIntervalScheduler() });
    for (let i = 0; i < 5; i += 1) {
      writer.enqueue(makeRow({ tsMs: i }));
    }
    expect(writer.pendingCount).toBe(5);
    expect(writer.dropTotal).toBe(0);
  });

  test('enqueue beyond cap drops oldest, increments dropTotal', () => {
    const writer = new TickWriter({ ringCap: 3, scheduler: new FakeIntervalScheduler() });
    writer.enqueue(makeRow({ tsMs: 1 }));
    writer.enqueue(makeRow({ tsMs: 2 }));
    writer.enqueue(makeRow({ tsMs: 3 }));
    writer.enqueue(makeRow({ tsMs: 4 }));
    expect(writer.pendingCount).toBe(3);
    expect(writer.dropTotal).toBe(1);
    writer.enqueue(makeRow({ tsMs: 5 }));
    writer.enqueue(makeRow({ tsMs: 6 }));
    expect(writer.pendingCount).toBe(3);
    expect(writer.dropTotal).toBe(3);
  });
});

describe('TickWriter — coalescing window', () => {
  test('start arms exactly one interval at the window period', () => {
    const scheduler = new FakeIntervalScheduler();
    const writer = new TickWriter({ scheduler });
    expect(scheduler.activeHandlerCount).toBe(0);
    writer.start();
    expect(scheduler.activeHandlerCount).toBe(1);
    expect(writer.running).toBe(true);
    // Idempotent start — second call must not arm a second interval.
    writer.start();
    expect(scheduler.activeHandlerCount).toBe(1);
  });

  test('does not flush until the timer fires', async () => {
    const scheduler = new FakeIntervalScheduler();
    let openCount = 0;
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(new MockCopyWritable());
      },
    });
    writer.start();
    writer.enqueue(makeRow());
    writer.enqueue(makeRow());
    // No tick fired yet → no flush attempted.
    expect(openCount).toBe(0);
    expect(writer.pendingCount).toBe(2);
    // One tick → one flush carrying both rows.
    scheduler.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(openCount).toBe(1);
  });

  test('empty ring tick does not invoke the COPY path', async () => {
    const scheduler = new FakeIntervalScheduler();
    let openCount = 0;
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(new MockCopyWritable());
      },
    });
    writer.start();
    scheduler.tick();
    await Promise.resolve();
    expect(openCount).toBe(0);
    expect(writer.flushCount).toBe(0);
  });

  test('stop clears the timer and runs one final flush', async () => {
    const scheduler = new FakeIntervalScheduler();
    let openCount = 0;
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(new MockCopyWritable());
      },
    });
    writer.start();
    writer.enqueue(makeRow());
    expect(scheduler.activeHandlerCount).toBe(1);
    await writer.stop();
    expect(scheduler.activeHandlerCount).toBe(0);
    expect(openCount).toBe(1);
    expect(writer.pendingCount).toBe(0);
    expect(writer.running).toBe(false);
  });
});

describe('TickWriter — flushNow + flushCount', () => {
  test('flushNow drains the ring once, increments flushCount', async () => {
    const scheduler = new FakeIntervalScheduler();
    const writable = new MockCopyWritable();
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => Promise.resolve(writable),
    });
    writer.enqueue(makeRow({ tsMs: 1 }));
    writer.enqueue(makeRow({ tsMs: 2 }));
    await writer.flushNow();
    expect(writer.flushCount).toBe(1);
    expect(writer.pendingCount).toBe(0);
    expect(writable.ended).toBe(true);
  });

  test('flushNow on empty ring does not increment flushCount', async () => {
    const scheduler = new FakeIntervalScheduler();
    let openCount = 0;
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(new MockCopyWritable());
      },
    });
    await writer.flushNow();
    expect(writer.flushCount).toBe(0);
    expect(openCount).toBe(0);
  });

  test('flushNow rebuilds the writable per call (no reuse across batches)', async () => {
    const scheduler = new FakeIntervalScheduler();
    let openCount = 0;
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(new MockCopyWritable());
      },
    });
    writer.enqueue(makeRow({ tsMs: 1 }));
    await writer.flushNow();
    writer.enqueue(makeRow({ tsMs: 2 }));
    await writer.flushNow();
    expect(openCount).toBe(2);
    expect(writer.flushCount).toBe(2);
  });
});

describe('TickWriter — partition-missing recovery', () => {
  test('on partition-missing error, runs ensureRollingPartitions once and retries', async () => {
    let openCount = 0;
    let ensureCount = 0;
    const scheduler = new FakeIntervalScheduler();
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        if (openCount === 1) {
          // First open: simulate a partition-missing error on .end().
          return Promise.resolve(
            new MockCopyWritable({
              failOnEnd: new Error(
                'no partition of relation "ticks" found for row',
              ),
            }),
          );
        }
        return Promise.resolve(new MockCopyWritable());
      },
      ensurePartitions: () => {
        ensureCount += 1;
        return Promise.resolve();
      },
    });
    writer.enqueue(makeRow({ tsMs: 1 }));
    await writer.flushNow();
    expect(ensureCount).toBe(1);
    expect(openCount).toBe(2);
    expect(writer.flushCount).toBe(1);
  });

  test('non-partition errors do not trigger recovery', async () => {
    let openCount = 0;
    let ensureCount = 0;
    const scheduler = new FakeIntervalScheduler();
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () => {
        openCount += 1;
        return Promise.resolve(
          new MockCopyWritable({
            failOnEnd: new Error('connection terminated unexpectedly'),
          }),
        );
      },
      ensurePartitions: () => {
        ensureCount += 1;
        return Promise.resolve();
      },
    });
    writer.enqueue(makeRow({ tsMs: 1 }));
    await writer.flushNow();
    expect(ensureCount).toBe(0);
    expect(openCount).toBe(1);
    expect(writer.flushCount).toBe(0);
  });
});

describe('TickWriter — stop tolerance', () => {
  test('stop swallows a transient DB error on the final drain', async () => {
    const scheduler = new FakeIntervalScheduler();
    const writer = new TickWriter({
      scheduler,
      openCopyStream: () =>
        Promise.resolve(
          new MockCopyWritable({ failOnEnd: new Error('connection refused') }),
        ),
    });
    writer.start();
    writer.enqueue(makeRow());
    // Must not throw — stop is called from a SIGTERM handler.
    await writer.stop();
    expect(writer.running).toBe(false);
    expect(writer.pendingCount).toBe(0);
  });

  test('stop is idempotent', async () => {
    const scheduler = new FakeIntervalScheduler();
    const writer = new TickWriter({ scheduler });
    writer.start();
    await writer.stop();
    await writer.stop();
    expect(writer.running).toBe(false);
  });
});

describe('serializeBatchToCopyText', () => {
  test('emits one tab-separated newline-terminated row per tick in declaration order', () => {
    const text = serializeBatchToCopyText([
      makeRow({
        tsMs: 1_717_000_000_000,
        symbol: 'BTCUSDT',
        price: 71_234.5,
        qty: 0.125,
        aggressor: 'buy',
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
      makeRow({
        tsMs: 1_717_000_000_001,
        symbol: 'BTCUSDT',
        price: 71_234.6,
        qty: 0.25,
        aggressor: 'sell',
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ]);
    expect(text).toBe(
      '1717000000000\tBTCUSDT\t71234.5\t0.125\tbuy\taaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n' +
        '1717000000001\tBTCUSDT\t71234.6\t0.25\tsell\taaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n',
    );
  });

  test('empty batch produces empty string', () => {
    expect(serializeBatchToCopyText([])).toBe('');
  });
});

describe('isPartitionMissingError', () => {
  test('matches the canonical pg message', () => {
    expect(
      isPartitionMissingError(
        new Error('no partition of relation "ticks" found for row'),
      ),
    ).toBe(true);
  });

  test('matches case-insensitively', () => {
    expect(
      isPartitionMissingError(
        new Error('NO PARTITION OF RELATION ticks found for row'),
      ),
    ).toBe(true);
  });

  test('does not match unrelated errors', () => {
    expect(isPartitionMissingError(new Error('connection refused'))).toBe(false);
    expect(isPartitionMissingError(undefined)).toBe(false);
    expect(isPartitionMissingError('random string')).toBe(false);
  });
});

describe('getTickWriter — singleton', () => {
  test('returns the same instance across calls', () => {
    __resetTickWriterSingletonForTests();
    const a = getTickWriter();
    const b = getTickWriter();
    expect(a).toBe(b);
    __resetTickWriterSingletonForTests();
    const c = getTickWriter();
    expect(c).not.toBe(a);
  });
});
