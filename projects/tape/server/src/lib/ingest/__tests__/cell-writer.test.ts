/**
 * CellWriter unit tests — Task 1.5f per ADR-005.
 *
 * Covers the cell-close persistence path contract:
 *  - enqueue -> flush: a complete bar is upserted once a NEWER bar's
 *    close arrives (bar-boundary detection), and the trailing bar is
 *    flushed by `flushPending()`.
 *  - transaction-per-bar: each bar is written inside exactly one
 *    `db.transaction(...)`, all its price levels together.
 *  - upsert idempotency: re-emitting the same closed bar (worker drain /
 *    recovery replay) upserts the same rows, never duplicates and never
 *    throws — the mock records that the SAME PK is written twice.
 *  - DB-absent tolerance: with `DATABASE_URL` absent the writer no-ops
 *    the DB work (no transaction opened) and never throws — the live
 *    board is unaffected.
 *  - error tolerance: a transaction throw degrades persistence (one bar
 *    dropped, `writeErrors` incremented) but does not propagate.
 *
 * The DB path is fully mocked via the `openDb` seam — no live Postgres.
 * The live round-trip (real pipeline writes cells -> replay endpoint
 * serves them) is proven separately against a docker Postgres in the
 * task report.
 *
 * Test runner: `bun test` (bun:test). Same choice as the rest of the
 * ingest suite — the server is Bun-native.
 */

import { describe, expect, test } from 'bun:test';

import {
  CellWriter,
  type CellWriterDb,
  type CellWriterTx,
  type ClosedCell,
  __resetCellWriterForTests,
  getCellWriter,
} from '../cell-writer';

/**
 * Records every bar handed to a transaction. Each entry is the set of
 * cells written in one `db.transaction(...)` call — so the test can
 * assert "one transaction per bar" and inspect upsert idempotency by
 * counting how many times a given PK shows up.
 */
class MockCellWriterDb implements CellWriterDb {
  /** One entry per transaction; each entry is that bar's cells. */
  readonly bars: ClosedCell[][] = [];
  /** Total `transaction()` invocations (== bars flushed). */
  txCount = 0;
  /** When set, the NEXT transaction throws (one-shot). */
  #failOnce: Error | null = null;

  failNextTransaction(err: Error): void {
    this.#failOnce = err;
  }

  async transaction<T>(fn: (tx: CellWriterTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    if (this.#failOnce !== null) {
      const err = this.#failOnce;
      this.#failOnce = null;
      throw err;
    }
    const captured: ClosedCell[] = [];
    const tx: CellWriterTx = {
      upsertCells(rows: readonly ClosedCell[]): Promise<void> {
        captured.push(...rows);
        return Promise.resolve();
      },
    };
    const result = await fn(tx);
    this.bars.push(captured);
    return result;
  }

  /** Flat list of every cell written across all bars. */
  get allCells(): ClosedCell[] {
    return this.bars.flat();
  }
}

function makeCell(overrides: Partial<ClosedCell> = {}): ClosedCell {
  return {
    symbol: 'BTCUSDT-PERP',
    bucketTs: 1_717_000_000_000,
    priceBucket: 14_240,
    bidVolume: 1.5,
    askVolume: 2.25,
    trades: 7,
    sessionId: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

function makeWriter(
  db: MockCellWriterDb,
  hasDb = true,
): CellWriter {
  return new CellWriter({
    openDb: () => db,
    hasDatabaseUrl: () => hasDb,
  });
}

describe('CellWriter — bar-boundary flush', () => {
  test('buffers a bar until a NEWER bar close arrives, then flushes it in one transaction', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);

    // Bar A: three price levels, contiguous (worker emits sorted).
    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 10 }));
    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 11 }));
    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 12 }));

    // Nothing flushed yet — bar A is still the open buffer.
    expect(db.txCount).toBe(0);

    // First close of bar B triggers bar A's flush.
    writer.enqueueClose(makeCell({ bucketTs: 2000, priceBucket: 9 }));
    await writer.flushPending();

    // Two transactions total: bar A (on boundary) + bar B (on flushPending).
    expect(db.txCount).toBe(2);
    // Bar A carried exactly its three price levels, in one transaction.
    expect(db.bars[0]?.map((c) => c.priceBucket)).toEqual([10, 11, 12]);
    expect(db.bars[0]?.every((c) => c.bucketTs === 1000)).toBe(true);
    // Bar B carried its single level.
    expect(db.bars[1]?.map((c) => c.priceBucket)).toEqual([9]);
    expect(writer.barsWritten).toBe(2);
    expect(writer.cellsWritten).toBe(4);
    expect(writer.writeErrors).toBe(0);
  });

  test('a different symbol at the same bucketTs is treated as a bar boundary', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);

    writer.enqueueClose(makeCell({ symbol: 'BTCUSDT-PERP', bucketTs: 1000 }));
    writer.enqueueClose(makeCell({ symbol: 'ETHUSDT-PERP', bucketTs: 1000 }));
    await writer.flushPending();

    expect(db.txCount).toBe(2);
    expect(db.bars[0]?.[0]?.symbol).toBe('BTCUSDT-PERP');
    expect(db.bars[1]?.[0]?.symbol).toBe('ETHUSDT-PERP');
  });

  test('flushPending with no buffered bar is a no-op', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);
    await writer.flushPending();
    expect(db.txCount).toBe(0);
  });
});

describe('CellWriter — upsert idempotency', () => {
  test('re-emitting the same closed bar upserts the same PKs without throwing', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);

    const barCells = [
      makeCell({ bucketTs: 1000, priceBucket: 10, bidVolume: 1, askVolume: 2 }),
      makeCell({ bucketTs: 1000, priceBucket: 11, bidVolume: 3, askVolume: 4 }),
    ];

    // First emission of bar A, flushed by the boundary close of bar B.
    for (const c of barCells) writer.enqueueClose(c);
    writer.enqueueClose(makeCell({ bucketTs: 2000, priceBucket: 9 }));
    // Re-emit bar A (worker drain / recovery replay) — SAME PKs.
    for (const c of barCells) writer.enqueueClose(c);
    await writer.flushPending();

    // bar A (first), bar B, bar A (replay) = 3 transactions.
    expect(db.txCount).toBe(3);
    // The (bucketTs=1000, priceBucket=10) PK was written twice — the
    // upsert (ON CONFLICT DO UPDATE) makes that idempotent at the DB
    // layer; here we assert the writer faithfully re-issued it.
    const pk10 = db.allCells.filter(
      (c) => c.bucketTs === 1000 && c.priceBucket === 10,
    );
    expect(pk10.length).toBe(2);
    // No errors — re-emission is a normal, tolerated event.
    expect(writer.writeErrors).toBe(0);
  });
});

describe('CellWriter — DB-absent tolerance', () => {
  test('does not open a transaction and never throws when DATABASE_URL is absent', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db, /* hasDb */ false);

    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 10 }));
    writer.enqueueClose(makeCell({ bucketTs: 2000, priceBucket: 9 })); // boundary
    await writer.flushPending();

    // Persistence is OFF — no transaction opened, no rows written.
    expect(db.txCount).toBe(0);
    expect(writer.barsWritten).toBe(0);
    expect(writer.cellsWritten).toBe(0);
    // And crucially: the enqueue path never threw — the live board is
    // unaffected.
    expect(writer.writeErrors).toBe(0);
  });
});

describe('CellWriter — error tolerance', () => {
  test('a transaction failure degrades persistence (bar dropped) without propagating', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);
    db.failNextTransaction(new Error('connection reset'));

    // Bar A will hit the failing transaction on boundary flush.
    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 10 }));
    writer.enqueueClose(makeCell({ bucketTs: 2000, priceBucket: 9 })); // boundary -> bar A flush fails
    // Bar B flushes cleanly on flushPending.
    await writer.flushPending();

    expect(writer.writeErrors).toBe(1);
    // Bar B still persisted — one bad bar does not poison the writer.
    expect(writer.barsWritten).toBe(1);
    expect(db.bars[0]?.[0]?.bucketTs).toBe(2000);
  });

  test('flushPending awaits in-flight bar writes', async () => {
    const db = new MockCellWriterDb();
    const writer = makeWriter(db);

    writer.enqueueClose(makeCell({ bucketTs: 1000, priceBucket: 10 }));
    writer.enqueueClose(makeCell({ bucketTs: 2000, priceBucket: 9 })); // boundary fires bar A flush (async)
    // Without awaiting flushPending, the boundary flush may still be in
    // flight. flushPending must await it AND the trailing bar B.
    await writer.flushPending();

    expect(writer.barsWritten).toBe(2);
    expect(writer.cellsWritten).toBe(2);
  });
});

describe('CellWriter — singleton', () => {
  test('getCellWriter returns a stable instance until reset', () => {
    __resetCellWriterForTests();
    const a = getCellWriter();
    const b = getCellWriter();
    expect(a).toBe(b);
    __resetCellWriterForTests();
    const c = getCellWriter();
    expect(c).not.toBe(a);
  });
});
