/**
 * RetentionScheduler unit tests — Task 1.5 per ADR-003.
 *
 * Covers:
 *  - `computeNext3amUtc` returns the correct moment for the 5 canonical
 *    inputs (midnight, just-before-3am, just-after-3am, midday,
 *    end-of-month edge) — the brief lists these five exactly.
 *  - `runSweepImpl` SELECTs the over-threshold board ids, broadcasts one
 *    `control.board-deleted` stateless frame per live room (counting one
 *    `controlFramesOut` per delivery), closes each connection with code
 *    4404, then DELETEs the boards. All in one transaction.
 *  - A broadcast failure does NOT abort the sweep — the close pass and
 *    the delete still run.
 *  - Empty inactive-board set short-circuits — no transactions, no emits.
 *  - `start()` is idempotent and arms the next 03:00 UTC timer.
 *  - `stop()` cancels the pending timer and is idempotent.
 *
 * The DB path is fully mocked. No live Postgres dependency. The room
 * registry is a small in-memory stub that records emitted frames + close
 * calls.
 *
 * Test runner: `node:test` via the package `test` script
 * `node --test --import tsx 'src/**\/*.test.ts'`. Matches the precedent
 * from `src/lib/session/__tests__/fnv1a.test.ts` and
 * `src/routes/__tests__/boards.test.ts`.
 *
 * The `describe`/`it` calls return Promises that the runtime awaits
 * internally; ESLint's `no-floating-promises` does not know this, so we
 * `void` each call to mark the floating Promise as intentional.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { wsBoardDeletedFrameSchema } from '../../schemas/ws/board-deleted';
import { wsMetrics } from '../../ws/metrics';
import { retentionMetrics } from '../retention-metrics';
import {
  DEFAULT_BOARD_RETENTION_DAYS,
  MS_PER_DAY,
  RETENTION_SWEEP_HOUR_UTC,
  RetentionScheduler,
  __resetRetentionSchedulerSingletonForTests,
  computeNext3amUtc,
  getRetentionScheduler,
  readBoardRetentionDaysFromEnv,
  runSweepImpl,
  type RetentionConnection,
  type RetentionDb,
  type RetentionDocument,
  type RetentionRoomRegistry,
  type RetentionSweepResult,
  type RetentionTransaction,
  type TimeoutHandle,
  type TimeoutScheduler,
} from '../retention-scheduler';

// ----- test fakes -----------------------------------------------------------

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
}

interface FakeConnectionState {
  closeCalls: { code?: number; reason?: string }[];
}

function makeFakeConnection(): {
  connection: RetentionConnection;
  state: FakeConnectionState;
} {
  const state: FakeConnectionState = {
    closeCalls: [],
  };
  const connection: RetentionConnection = {
    close(event?: { code?: number; reason?: string }): void {
      state.closeCalls.push(event ?? {});
    },
  };
  return { connection, state };
}

interface FakeDocumentState {
  /** Each successful `broadcastStateless(payload)` call's payload. */
  broadcasts: string[];
}

/**
 * Build a fake `RetentionDocument` over a fixed connection set. The
 * board-deleted frame is now delivered via the document-level
 * `broadcastStateless` (ADR-011), so the per-room broadcast tracking lives
 * here rather than on each connection. `throwOnBroadcast` simulates a
 * framework broadcast throw.
 */
function makeFakeDocument(
  connections: RetentionConnection[],
  throwOnBroadcast = false,
): { doc: RetentionDocument; state: FakeDocumentState } {
  const state: FakeDocumentState = { broadcasts: [] };
  const doc: RetentionDocument = {
    broadcastStateless(payload: string): void {
      if (throwOnBroadcast) {
        throw new Error('broadcast failed');
      }
      state.broadcasts.push(payload);
    },
    getConnectionsCount(): number {
      return connections.length;
    },
    getConnections(): RetentionConnection[] {
      return connections;
    },
  };
  return { doc, state };
}

function makeFakeRegistry(
  rooms: Map<string, RetentionDocument>,
): RetentionRoomRegistry {
  return {
    getDocument(boardId: string): RetentionDocument | undefined {
      return rooms.get(boardId);
    },
  };
}

interface FakeDbCalls {
  transactions: number;
  findCalls: number[];
  deleteCalls: string[][];
}

function makeFakeDb(
  inactiveIdsByCall: string[][],
  options: { deleteThrows?: boolean } = {},
): { db: RetentionDb; calls: FakeDbCalls } {
  const calls: FakeDbCalls = {
    transactions: 0,
    findCalls: [],
    deleteCalls: [],
  };
  let callIdx = 0;
  const db: RetentionDb = {
    async runSweepTransaction(body) {
      calls.transactions += 1;
      const tx: RetentionTransaction = {
        findInactiveBoardIds(retentionDays: number): Promise<string[]> {
          calls.findCalls.push(retentionDays);
          const ids = inactiveIdsByCall[callIdx] ?? [];
          callIdx += 1;
          return Promise.resolve(ids);
        },
        deleteBoardsById(ids: readonly string[]): Promise<number> {
          calls.deleteCalls.push([...ids]);
          if (options.deleteThrows) {
            return Promise.reject<number>(new Error('delete failed'));
          }
          return Promise.resolve(ids.length);
        },
      };
      return body(tx);
    },
  };
  return { db, calls };
}

// Each test resets the shared metrics (wsMetrics + retentionMetrics)
// so counter assertions are isolated.
afterEach(() => {
  wsMetrics.reset();
  retentionMetrics.reset();
});

// ----- computeNext3amUtc — five canonical inputs ----------------------------

void describe('computeNext3amUtc', () => {
  void it('midnight UTC -> today 03:00 UTC (same day)', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 0, 0, 0, 0));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-05-15T03:00:00.000Z');
  });

  void it('just-before-3am UTC -> today 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 2, 59, 59, 999));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-05-15T03:00:00.000Z');
  });

  void it('just-after-3am UTC -> tomorrow 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 3, 0, 0, 1));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-05-16T03:00:00.000Z');
  });

  void it('midday UTC -> tomorrow 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 12, 0, 0, 0));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-05-16T03:00:00.000Z');
  });

  void it('end-of-month edge (May 31 23:00 UTC) -> June 1 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 4, 31, 23, 0, 0, 0));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-06-01T03:00:00.000Z');
  });

  void it('end-of-year edge (Dec 31 23:00 UTC) -> Jan 1 next year 03:00 UTC', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 0, 0, 0));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2027-01-01T03:00:00.000Z');
  });

  void it('exact 03:00:00.000 UTC -> tomorrow (strict-after semantics)', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 3, 0, 0, 0));
    const next = computeNext3amUtc(now);
    assert.equal(next.toISOString(), '2026-05-16T03:00:00.000Z');
  });
});

// ----- ADR pins -------------------------------------------------------------

void describe('Retention constants pin ADR-003', () => {
  void it('sweep hour is 03:00 UTC', () => {
    assert.equal(RETENTION_SWEEP_HOUR_UTC, 3);
  });

  void it('default retention horizon is 30 days', () => {
    assert.equal(DEFAULT_BOARD_RETENTION_DAYS, 30);
  });

  void it('day constant is 86_400_000 ms', () => {
    assert.equal(MS_PER_DAY, 86_400_000);
  });

  void it('readBoardRetentionDaysFromEnv honours BOARD_RETENTION_DAYS', () => {
    const prev = process.env.BOARD_RETENTION_DAYS;
    process.env.BOARD_RETENTION_DAYS = '14';
    try {
      assert.equal(readBoardRetentionDaysFromEnv(), 14);
    } finally {
      if (prev === undefined) delete process.env.BOARD_RETENTION_DAYS;
      else process.env.BOARD_RETENTION_DAYS = prev;
    }
  });

  void it('readBoardRetentionDaysFromEnv falls back on a non-numeric value', () => {
    const prev = process.env.BOARD_RETENTION_DAYS;
    process.env.BOARD_RETENTION_DAYS = 'abc';
    try {
      assert.equal(readBoardRetentionDaysFromEnv(), DEFAULT_BOARD_RETENTION_DAYS);
    } finally {
      if (prev === undefined) delete process.env.BOARD_RETENTION_DAYS;
      else process.env.BOARD_RETENTION_DAYS = prev;
    }
  });
});

// ----- runSweepImpl — the SELECT -> emit -> CLOSE -> DELETE flow -----------

void describe('runSweepImpl — happy path with one live connection', () => {
  void it(
    'broadcasts one control.board-deleted stateless frame, closes with code 4404, deletes the board',
    async () => {
      const boardId = '11111111-1111-4111-8111-111111111111';
      const { connection, state } = makeFakeConnection();
      const { doc, state: docState } = makeFakeDocument([connection]);
      const registry = makeFakeRegistry(new Map([[boardId, doc]]));
      const { db, calls } = makeFakeDb([[boardId]]);

      const result = await runSweepImpl(db, registry, 30);

      // One transaction; one find with the configured retention days;
      // one delete with the exact id set.
      assert.equal(calls.transactions, 1);
      assert.deepEqual(calls.findCalls, [30]);
      assert.deepEqual(calls.deleteCalls, [[boardId]]);

      // One broadcast, validated against the schema.
      assert.equal(docState.broadcasts.length, 1);
      assert.ok(docState.broadcasts[0] !== undefined);
      const parsed = wsBoardDeletedFrameSchema.parse(
        JSON.parse(docState.broadcasts[0]),
      );
      assert.equal(parsed.kind, 'control.board-deleted');
      assert.equal(parsed.boardId, boardId);
      assert.equal(parsed.reason, 'retention-expired');

      // Close code 4404 with the documented reason.
      assert.equal(state.closeCalls.length, 1);
      const closeCall = state.closeCalls[0];
      assert.ok(closeCall !== undefined);
      assert.equal(closeCall.code, 4404);
      assert.equal(closeCall.reason, 'retention-expired');

      // Result reflects the counts — one delivery to the single connection.
      assert.equal(result.deletedCount, 1);
      assert.equal(result.emittedCount, 1);
      assert.equal(result.emitFailureCount, 0);
    },
  );
});

void describe('runSweepImpl — sweep continues past a broadcast failure', () => {
  void it(
    'broadcast throws, both connections still close, the delete still runs',
    async () => {
      const boardId = '22222222-2222-4222-8222-222222222222';
      const connA = makeFakeConnection();
      const connB = makeFakeConnection();
      // throwOnBroadcast simulates a framework `broadcastStateless` throw.
      const { doc } = makeFakeDocument(
        [connA.connection, connB.connection],
        true,
      );
      const registry = makeFakeRegistry(new Map([[boardId, doc]]));
      const { db, calls } = makeFakeDb([[boardId]]);

      const result = await runSweepImpl(db, registry, 30);

      // Broadcast threw => zero deliveries counted, one room failure.
      assert.equal(result.emittedCount, 0);
      assert.equal(result.emitFailureCount, 1);
      // Both connections close cleanly — broadcast failure does NOT
      // abort the close pass.
      assert.equal(connA.state.closeCalls.length, 1);
      assert.equal(connB.state.closeCalls.length, 1);
      // DELETE still runs.
      assert.deepEqual(calls.deleteCalls, [[boardId]]);
      assert.equal(result.deletedCount, 1);
    },
  );
});

void describe('runSweepImpl — no live room', () => {
  void it('over-threshold board with no Hocuspocus room still gets deleted with zero emits', async () => {
    const boardId = '33333333-3333-4333-8333-333333333333';
    // Empty registry — no document for the id.
    const registry = makeFakeRegistry(new Map());
    const { db, calls } = makeFakeDb([[boardId]]);

    const result = await runSweepImpl(db, registry, 30);

    assert.equal(result.emittedCount, 0);
    assert.equal(result.emitFailureCount, 0);
    assert.deepEqual(calls.deleteCalls, [[boardId]]);
    assert.equal(result.deletedCount, 1);
  });
});

void describe('runSweepImpl — empty inactive-board set', () => {
  void it('short-circuits the delete and emits nothing', async () => {
    const registry = makeFakeRegistry(new Map());
    const { db, calls } = makeFakeDb([[]]);

    const result = await runSweepImpl(db, registry, 30);

    assert.equal(result.deletedCount, 0);
    assert.equal(result.emittedCount, 0);
    assert.equal(result.emitFailureCount, 0);
    // The find still ran (the SELECT is the trigger), but no delete.
    assert.deepEqual(calls.findCalls, [30]);
    assert.deepEqual(calls.deleteCalls, []);
  });
});

void describe('runSweepImpl — multiple boards, mixed live rooms', () => {
  void it(
    'emits per-connection across every live room and deletes every id in one transaction',
    async () => {
      const a = '44444444-4444-4444-8444-444444444444';
      const b = '55555555-5555-4555-8555-555555555555';
      const c = '66666666-6666-4666-8666-666666666666';
      const ac1 = makeFakeConnection();
      const ac2 = makeFakeConnection();
      const bc1 = makeFakeConnection();
      // c has no room — silent.
      const { doc: docA } = makeFakeDocument([ac1.connection, ac2.connection]);
      const { doc: docB } = makeFakeDocument([bc1.connection]);
      const registry = makeFakeRegistry(
        new Map([
          [a, docA],
          [b, docB],
        ]),
      );
      const { db, calls } = makeFakeDb([[a, b, c]]);

      const result = await runSweepImpl(db, registry, 7);

      // 3 total live connections across 2 rooms => 3 deliveries, 3 closes.
      assert.equal(result.emittedCount, 3);
      assert.equal(ac1.state.closeCalls.length, 1);
      assert.equal(ac2.state.closeCalls.length, 1);
      assert.equal(bc1.state.closeCalls.length, 1);
      // Single delete call with all three ids.
      assert.equal(calls.deleteCalls.length, 1);
      assert.deepEqual([...(calls.deleteCalls[0] ?? [])].sort(), [a, b, c].sort());
      assert.equal(result.deletedCount, 3);
      // The configured retention horizon was passed through.
      assert.deepEqual(calls.findCalls, [7]);
    },
  );
});

// ----- bootstrap-once-on-start ---------------------------------------------

void describe('RetentionScheduler — bootstrap-once-on-start', () => {
  void it('start runs ONE sweep and arms the next 03:00 UTC timer', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const { db, calls } = makeFakeDb([[]]);
    const registry = makeFakeRegistry(new Map());
    const retention = new RetentionScheduler({
      db,
      registry,
      retentionDays: 30,
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });

    assert.equal(scheduler.pendingCount, 0);
    await retention.start();

    // One transaction => one sweep on start.
    assert.equal(calls.transactions, 1);
    // After the boot sweep, the next 03:00 UTC timer is armed.
    assert.equal(scheduler.pendingCount, 1);
    assert.equal(retention.running, true);
    // Delay points at tomorrow's 03:00 UTC.
    const expectedNextMs = Date.UTC(2026, 4, 16, 3, 0, 0, 0);
    const nowMs = Date.UTC(2026, 4, 15, 12, 0, 0, 0);
    assert.equal(scheduler.lastDelayMs, expectedNextMs - nowMs);
  });

  void it('start is idempotent — second call does not re-bootstrap', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const { db, calls } = makeFakeDb([[], []]);
    const retention = new RetentionScheduler({
      db,
      registry: makeFakeRegistry(new Map()),
      retentionDays: 30,
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });

    await retention.start();
    await retention.start();

    assert.equal(calls.transactions, 1);
    assert.equal(scheduler.pendingCount, 1);
  });

  void it('lastResult is populated after the boot sweep', async () => {
    const boardId = '77777777-7777-4777-8777-777777777777';
    const { db } = makeFakeDb([[boardId]]);
    const { connection } = makeFakeConnection();
    const { doc } = makeFakeDocument([connection]);
    const registry = makeFakeRegistry(new Map([[boardId, doc]]));
    const scheduler = new FakeTimeoutScheduler();
    const retention = new RetentionScheduler({
      db,
      registry,
      retentionDays: 30,
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    const result: RetentionSweepResult | null = retention.lastResult;
    assert.ok(result !== null);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.emittedCount, 1);
  });
});

void describe('RetentionScheduler — metrics integration', () => {
  void it('retentionMetrics receive deletedCount + emittedCount + lastRunMs', async () => {
    const boardId = '88888888-8888-4888-8888-888888888888';
    const { db } = makeFakeDb([[boardId]]);
    const { connection } = makeFakeConnection();
    const { doc } = makeFakeDocument([connection]);
    const registry = makeFakeRegistry(new Map([[boardId, doc]]));
    const scheduler = new FakeTimeoutScheduler();
    const fakeNow = Date.UTC(2026, 4, 15, 12, 0, 0, 0);
    const retention = new RetentionScheduler({
      db,
      registry,
      retentionDays: 30,
      scheduler,
      now: () => fakeNow,
    });
    await retention.start();
    const snap = retentionMetrics.snapshot();
    assert.equal(snap.retentionDeletedCount, 1);
    assert.equal(snap.retentionEmittedCount, 1);
    assert.equal(snap.retentionLastRunMs, fakeNow);
  });

  void it('wsMetrics.controlFramesOut increments per successful emit', async () => {
    wsMetrics.reset();
    const a = '99999999-9999-4999-8999-999999999999';
    const b = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const aConn = makeFakeConnection();
    const bConn = makeFakeConnection();
    const { doc: aDoc } = makeFakeDocument([aConn.connection]);
    const { doc: bDoc } = makeFakeDocument([bConn.connection]);
    const registry = makeFakeRegistry(
      new Map([
        [a, aDoc],
        [b, bDoc],
      ]),
    );
    const { db } = makeFakeDb([[a, b]]);
    await runSweepImpl(db, registry, 30);
    assert.equal(wsMetrics.snapshot().controlFramesOut, 2);
  });
});

// ----- stop -----------------------------------------------------------------

void describe('RetentionScheduler — stop', () => {
  void it('cancels the pending timer', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const { db } = makeFakeDb([[]]);
    const retention = new RetentionScheduler({
      db,
      registry: makeFakeRegistry(new Map()),
      retentionDays: 30,
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    assert.equal(scheduler.pendingCount, 1);
    retention.stop();
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(retention.running, false);
  });

  void it('is idempotent', async () => {
    const scheduler = new FakeTimeoutScheduler();
    const { db } = makeFakeDb([[]]);
    const retention = new RetentionScheduler({
      db,
      registry: makeFakeRegistry(new Map()),
      retentionDays: 30,
      scheduler,
      now: () => Date.UTC(2026, 4, 15, 12, 0, 0, 0),
    });
    await retention.start();
    retention.stop();
    retention.stop();
    assert.equal(retention.running, false);
  });
});

// ----- singleton -----------------------------------------------------------

void describe('getRetentionScheduler — singleton', () => {
  void it('returns the same instance across calls until reset', () => {
    __resetRetentionSchedulerSingletonForTests();
    const a = getRetentionScheduler();
    const b = getRetentionScheduler();
    assert.equal(a, b);
    __resetRetentionSchedulerSingletonForTests();
    const c = getRetentionScheduler();
    assert.notEqual(c, a);
  });
});
