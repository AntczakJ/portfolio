/**
 * CompactionSweep unit tests — Task 1.5 per ADR-003.
 *
 * Covers:
 *  - `runCompactionSweepImpl` flushes ONLY rooms whose un-flushed ops
 *    backlog exceeds the configured threshold.
 *  - Rooms below the threshold are NOT flushed.
 *  - Rooms whose backlog reader returns `null` (board row missing — test
 *    / smoke document name) are skipped.
 *  - The result reflects the inspected vs compacted counts.
 *  - The threshold is configurable via the env var
 *    `WS_COMPACTION_OPS_THRESHOLD` AND via the constructor option.
 *  - `start()` arms the interval at the configured cadence.
 *  - `stop()` cancels and is idempotent.
 *  - Storage metrics are written: `compactionSweepRuns` increments per
 *    run; `roomsCompactedThisSweep` overwrites with the latest count.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { storageMetrics } from '../../ws/storage-metrics';
import {
  CompactionSweep,
  DEFAULT_COMPACTION_OPS_THRESHOLD,
  DEFAULT_COMPACTION_SWEEP_INTERVAL_MS,
  __resetCompactionSweepSingletonForTests,
  getCompactionSweep,
  readCompactionOpsThresholdFromEnv,
  runCompactionSweepImpl,
  type CompactionBacklogReader,
  type CompactionDocument,
  type CompactionRoomRegistry,
  type IntervalHandle,
  type IntervalScheduler,
} from '../compaction-sweep';

afterEach(() => {
  storageMetrics.reset();
});

// ----- test fakes -----------------------------------------------------------

class FakeIntervalScheduler implements IntervalScheduler {
  #nextId = 0;
  #handlers = new Map<number, { handler: () => void; ms: number }>();
  lastDelayMs: number | null = null;

  setInterval(handler: () => void, ms: number): IntervalHandle {
    this.lastDelayMs = ms;
    const id = this.#nextId++;
    this.#handlers.set(id, { handler, ms });
    return id as unknown as IntervalHandle;
  }

  clearInterval(handle: IntervalHandle): void {
    this.#handlers.delete(handle as unknown as number);
  }

  get pendingCount(): number {
    return this.#handlers.size;
  }
}

/**
 * Build a fake CompactionDocument backed by a stub `Document`. The
 * actual `Document` instance is never touched by the sweep when the
 * fake registry's `flushDocument` ignores its argument — we still need
 * the field to satisfy the TypeScript interface.
 */
function fakeRoom(name: string): CompactionDocument {
  // The sweep only passes the document through to `flushDocument` —
  // the fake registry below ignores the value. We cast a minimal stub
  // to `Document` to satisfy the type.
  return {
    name,
    document: { name } as unknown as CompactionDocument['document'],
  };
}

interface FakeRegistryCalls {
  flushed: string[];
}

function makeFakeRegistry(rooms: CompactionDocument[]): {
  registry: CompactionRoomRegistry;
  calls: FakeRegistryCalls;
} {
  const calls: FakeRegistryCalls = { flushed: [] };
  const registry: CompactionRoomRegistry = {
    listRooms(): CompactionDocument[] {
      return rooms;
    },
    flushRoom(room): void {
      calls.flushed.push(room.name);
    },
  };
  return { registry, calls };
}

function makeBacklogReader(
  backlogByName: Record<string, number | null>,
): CompactionBacklogReader {
  return {
    readBacklog(boardId: string): Promise<number | null> {
      const value = backlogByName[boardId];
      return Promise.resolve(value === undefined ? 0 : value);
    },
  };
}

// ----- ADR pins -------------------------------------------------------------

void describe('Compaction constants pin ADR-003', () => {
  void it('default sweep interval is 6 hours', () => {
    assert.equal(DEFAULT_COMPACTION_SWEEP_INTERVAL_MS, 6 * 60 * 60 * 1000);
  });

  void it('default ops threshold is 100', () => {
    assert.equal(DEFAULT_COMPACTION_OPS_THRESHOLD, 100);
  });

  void it('readCompactionOpsThresholdFromEnv honours WS_COMPACTION_OPS_THRESHOLD', () => {
    const prev = process.env.WS_COMPACTION_OPS_THRESHOLD;
    process.env.WS_COMPACTION_OPS_THRESHOLD = '250';
    try {
      assert.equal(readCompactionOpsThresholdFromEnv(), 250);
    } finally {
      if (prev === undefined) delete process.env.WS_COMPACTION_OPS_THRESHOLD;
      else process.env.WS_COMPACTION_OPS_THRESHOLD = prev;
    }
  });

  void it('readCompactionOpsThresholdFromEnv falls back on a non-numeric value', () => {
    const prev = process.env.WS_COMPACTION_OPS_THRESHOLD;
    process.env.WS_COMPACTION_OPS_THRESHOLD = 'abc';
    try {
      assert.equal(
        readCompactionOpsThresholdFromEnv(),
        DEFAULT_COMPACTION_OPS_THRESHOLD,
      );
    } finally {
      if (prev === undefined) delete process.env.WS_COMPACTION_OPS_THRESHOLD;
      else process.env.WS_COMPACTION_OPS_THRESHOLD = prev;
    }
  });
});

// ----- runCompactionSweepImpl — threshold semantics -------------------------

void describe('runCompactionSweepImpl — flushes ONLY rooms above the threshold', () => {
  void it('500-ops backlog and 50-ops backlog: only the 500 flushes (threshold 100)', async () => {
    const big = fakeRoom('big-room');
    const small = fakeRoom('small-room');
    const { registry, calls } = makeFakeRegistry([big, small]);
    const reader = makeBacklogReader({
      'big-room': 500,
      'small-room': 50,
    });

    const result = await runCompactionSweepImpl(registry, reader, 100);

    assert.equal(result.roomsInspected, 2);
    assert.equal(result.roomsCompacted, 1);
    assert.deepEqual(calls.flushed, ['big-room']);
  });

  void it('rooms exactly at the threshold flush (>= is inclusive)', async () => {
    const exact = fakeRoom('exact-room');
    const { registry, calls } = makeFakeRegistry([exact]);
    const reader = makeBacklogReader({ 'exact-room': 100 });

    const result = await runCompactionSweepImpl(registry, reader, 100);

    assert.equal(result.roomsCompacted, 1);
    assert.deepEqual(calls.flushed, ['exact-room']);
  });

  void it('rooms one below the threshold do NOT flush', async () => {
    const just = fakeRoom('just-room');
    const { registry, calls } = makeFakeRegistry([just]);
    const reader = makeBacklogReader({ 'just-room': 99 });

    const result = await runCompactionSweepImpl(registry, reader, 100);

    assert.equal(result.roomsCompacted, 0);
    assert.deepEqual(calls.flushed, []);
  });

  void it('rooms with null backlog (missing DB row) are skipped', async () => {
    const ghost = fakeRoom('ghost-room');
    const real = fakeRoom('real-room');
    const { registry, calls } = makeFakeRegistry([ghost, real]);
    const reader = makeBacklogReader({
      'ghost-room': null,
      'real-room': 500,
    });

    const result = await runCompactionSweepImpl(registry, reader, 100);

    assert.equal(result.roomsInspected, 2);
    assert.equal(result.roomsCompacted, 1);
    assert.deepEqual(calls.flushed, ['real-room']);
  });

  void it('empty registry short-circuits', async () => {
    const { registry, calls } = makeFakeRegistry([]);
    const reader = makeBacklogReader({});

    const result = await runCompactionSweepImpl(registry, reader, 100);

    assert.equal(result.roomsInspected, 0);
    assert.equal(result.roomsCompacted, 0);
    assert.deepEqual(calls.flushed, []);
  });

  void it('null registry short-circuits cleanly (no Hocuspocus injected)', async () => {
    const reader = makeBacklogReader({});
    const result = await runCompactionSweepImpl(null, reader, 100);
    assert.equal(result.roomsInspected, 0);
    assert.equal(result.roomsCompacted, 0);
  });
});

// ----- CompactionSweep — start / stop / interval ----------------------------

void describe('CompactionSweep — start / stop lifecycle', () => {
  void it('start arms a setInterval at the configured cadence', () => {
    const scheduler = new FakeIntervalScheduler();
    const { registry } = makeFakeRegistry([]);
    const sweep = new CompactionSweep({
      registry,
      backlogReader: makeBacklogReader({}),
      intervalMs: 5000,
      scheduler,
    });
    sweep.start();
    assert.equal(scheduler.pendingCount, 1);
    assert.equal(scheduler.lastDelayMs, 5000);
    assert.equal(sweep.running, true);
  });

  void it('start is idempotent', () => {
    const scheduler = new FakeIntervalScheduler();
    const { registry } = makeFakeRegistry([]);
    const sweep = new CompactionSweep({
      registry,
      backlogReader: makeBacklogReader({}),
      intervalMs: 5000,
      scheduler,
    });
    sweep.start();
    sweep.start();
    assert.equal(scheduler.pendingCount, 1);
  });

  void it('stop cancels the interval', () => {
    const scheduler = new FakeIntervalScheduler();
    const { registry } = makeFakeRegistry([]);
    const sweep = new CompactionSweep({
      registry,
      backlogReader: makeBacklogReader({}),
      intervalMs: 5000,
      scheduler,
    });
    sweep.start();
    sweep.stop();
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(sweep.running, false);
  });

  void it('stop is idempotent', () => {
    const scheduler = new FakeIntervalScheduler();
    const { registry } = makeFakeRegistry([]);
    const sweep = new CompactionSweep({
      registry,
      backlogReader: makeBacklogReader({}),
      intervalMs: 5000,
      scheduler,
    });
    sweep.start();
    sweep.stop();
    sweep.stop();
    assert.equal(sweep.running, false);
  });

  void it('default cadence is 6 hours when no override is set', () => {
    const scheduler = new FakeIntervalScheduler();
    const sweep = new CompactionSweep({
      registry: makeFakeRegistry([]).registry,
      backlogReader: makeBacklogReader({}),
      scheduler,
    });
    sweep.start();
    assert.equal(scheduler.lastDelayMs, DEFAULT_COMPACTION_SWEEP_INTERVAL_MS);
  });
});

// ----- CompactionSweep — runSweepNow + metrics ------------------------------

void describe('CompactionSweep — runSweepNow updates storage metrics', () => {
  void it('first run sets compactionSweepRuns=1 and roomsCompactedThisSweep=N', async () => {
    storageMetrics.reset();
    const big = fakeRoom('big-1');
    const huge = fakeRoom('big-2');
    const small = fakeRoom('small-1');
    const { registry } = makeFakeRegistry([big, huge, small]);
    const reader = makeBacklogReader({
      'big-1': 500,
      'big-2': 1000,
      'small-1': 10,
    });
    const sweep = new CompactionSweep({
      registry,
      backlogReader: reader,
      opsThreshold: 100,
      scheduler: new FakeIntervalScheduler(),
      now: () => Date.UTC(2026, 4, 15, 6, 0, 0, 0),
    });
    const result = await sweep.runSweepNow();
    assert.equal(result.roomsInspected, 3);
    assert.equal(result.roomsCompacted, 2);
    const snap = storageMetrics.snapshot();
    assert.equal(snap.compactionSweepRuns, 1);
    assert.equal(snap.roomsCompactedThisSweep, 2);
  });

  void it('subsequent runs accumulate compactionSweepRuns and overwrite roomsCompactedThisSweep', async () => {
    storageMetrics.reset();
    const big = fakeRoom('big-1');
    const { registry } = makeFakeRegistry([big]);
    const reader = makeBacklogReader({ 'big-1': 500 });
    const sweep = new CompactionSweep({
      registry,
      backlogReader: reader,
      opsThreshold: 100,
      scheduler: new FakeIntervalScheduler(),
      now: () => 0,
    });
    await sweep.runSweepNow();
    await sweep.runSweepNow();
    await sweep.runSweepNow();
    const snap = storageMetrics.snapshot();
    assert.equal(snap.compactionSweepRuns, 3);
    // Each sweep flushed 1 room; the LAST sweep's count is what shows.
    assert.equal(snap.roomsCompactedThisSweep, 1);
  });

  void it('lastResult is populated after runSweepNow', async () => {
    const big = fakeRoom('big-1');
    const { registry } = makeFakeRegistry([big]);
    const reader = makeBacklogReader({ 'big-1': 500 });
    const sweep = new CompactionSweep({
      registry,
      backlogReader: reader,
      opsThreshold: 100,
      scheduler: new FakeIntervalScheduler(),
    });
    await sweep.runSweepNow();
    assert.ok(sweep.lastResult !== null);
    assert.equal(sweep.lastResult.roomsCompacted, 1);
  });
});

// ----- singleton ------------------------------------------------------------

void describe('getCompactionSweep — singleton', () => {
  void it('returns the same instance until reset', () => {
    __resetCompactionSweepSingletonForTests();
    const a = getCompactionSweep();
    const b = getCompactionSweep();
    assert.equal(a, b);
    __resetCompactionSweepSingletonForTests();
    const c = getCompactionSweep();
    assert.notEqual(c, a);
  });
});
