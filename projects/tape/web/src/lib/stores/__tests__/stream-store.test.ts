import { afterEach, describe, expect, it } from 'vitest';

import {
  STREAM_CLOSED_CELLS_CAP,
  STREAM_RECENT_TICKS_CAP,
  useStreamStore,
} from '../stream-store';
import type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSFrame,
  WSSnapshotPayload,
  WSTickPayload,
} from 'tape-server';

function makeTick(overrides: Partial<WSTickPayload> = {}): WSTickPayload {
  return {
    tsMs: 1_780_000_000_000,
    price: 71_000,
    qty: 0.1,
    aggressor: 'buy',
    ...overrides,
  };
}

function makeDelta(
  overrides: Partial<WSCellDeltaPayload> = {},
): WSCellDeltaPayload {
  return {
    tsMs: 1_780_000_000_000,
    bucketTs: 1_780_000_000_000,
    priceBucket: 71_000,
    bidVolumeDelta: 0.5,
    askVolumeDelta: 0.25,
    tradesDelta: 1,
    ...overrides,
  };
}

function makeClose(
  overrides: Partial<WSCellClosePayload> = {},
): WSCellClosePayload {
  return {
    symbol: 'BTCUSDT-PERP',
    bucketTs: 1_780_000_000_000,
    priceBucket: 71_000,
    bidVolume: 10,
    askVolume: 5,
    trades: 3,
    ...overrides,
  };
}

function tickFrame(payload: WSTickPayload): WSFrame {
  return { topic: 'ticks.btc', kind: 'tick', payload };
}

function deltaFrame(payload: WSCellDeltaPayload): WSFrame {
  return { topic: 'cells.btc', kind: 'cell.delta', payload };
}

function closeFrame(payload: WSCellClosePayload): WSFrame {
  return { topic: 'cells.btc', kind: 'cell.close', payload };
}

function makeSnapshot(
  overrides: Partial<WSSnapshotPayload> = {},
): WSSnapshotPayload {
  return {
    symbol: 'BTCUSDT-PERP',
    currentBarTs: 1_780_000_000_000,
    cells: [],
    cellsOpen: [],
    recentTicks: [],
    ...overrides,
  };
}

describe('useStreamStore', () => {
  afterEach(() => {
    useStreamStore.getState().resetSession();
  });

  it('ingestFrame(tick) updates lastTickTsMs, tickCount, recentTicks', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(tickFrame(makeTick({ tsMs: 1, price: 100 })));
    store.ingestFrame(tickFrame(makeTick({ tsMs: 2, price: 101 })));
    const state = useStreamStore.getState();
    expect(state.tickCount).toBe(2);
    expect(state.lastTickTsMs).toBe(2);
    expect(state.recentTicks.map((t) => t.tsMs)).toEqual([1, 2]);
  });

  it('recentTicks ring is bounded at STREAM_RECENT_TICKS_CAP', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < STREAM_RECENT_TICKS_CAP + 50; i++) {
      store.ingestFrame(tickFrame(makeTick({ tsMs: i + 1 })));
    }
    const state = useStreamStore.getState();
    expect(state.recentTicks).toHaveLength(STREAM_RECENT_TICKS_CAP);
    // Oldest tick at index 0 must be 51 (we dropped the first 50).
    expect(state.recentTicks[0]!.tsMs).toBe(51);
    expect(state.recentTicks[state.recentTicks.length - 1]!.tsMs).toBe(
      STREAM_RECENT_TICKS_CAP + 50,
    );
  });

  it('ingestFrame(cell.delta) seeds + accumulates an open-cell map entry', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(
      deltaFrame(
        makeDelta({
          bucketTs: 100,
          priceBucket: 71_000,
          bidVolumeDelta: 1,
          askVolumeDelta: 2,
          tradesDelta: 3,
        }),
      ),
    );
    store.ingestFrame(
      deltaFrame(
        makeDelta({
          bucketTs: 100,
          priceBucket: 71_000,
          bidVolumeDelta: 0.5,
          askVolumeDelta: 0.25,
          tradesDelta: 1,
        }),
      ),
    );
    const state = useStreamStore.getState();
    const entry = state.openCells.get('100:71000');
    expect(entry).toBeDefined();
    expect(entry?.bidVolumeDelta).toBeCloseTo(1.5);
    expect(entry?.askVolumeDelta).toBeCloseTo(2.25);
    expect(entry?.tradesDelta).toBe(4);
  });

  it('ingestFrame(cell.close) evicts the open cell and pushes to closedCells', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(
      deltaFrame(makeDelta({ bucketTs: 200, priceBucket: 71_005 })),
    );
    expect(useStreamStore.getState().openCells.size).toBe(1);
    store.ingestFrame(
      closeFrame(makeClose({ bucketTs: 200, priceBucket: 71_005 })),
    );
    const state = useStreamStore.getState();
    expect(state.openCells.has('200:71005')).toBe(false);
    expect(state.closedCells).toHaveLength(1);
    expect(state.closedCells[0]!.priceBucket).toBe(71_005);
  });

  it('closedCells ring is bounded at STREAM_CLOSED_CELLS_CAP', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < STREAM_CLOSED_CELLS_CAP + 20; i++) {
      store.ingestFrame(
        closeFrame(makeClose({ bucketTs: 1000 + i, priceBucket: 71_000 })),
      );
    }
    const state = useStreamStore.getState();
    expect(state.closedCells).toHaveLength(STREAM_CLOSED_CELLS_CAP);
    // Oldest closed at index 0 must be the 21st we pushed.
    expect(state.closedCells[0]!.bucketTs).toBe(1020);
  });

  it('ingestSnapshot resets tickCount to 0 and seeds closedCells + openCells', () => {
    const store = useStreamStore.getState();
    // Pre-fill so the snapshot reset can be observed.
    store.ingestFrame(tickFrame(makeTick({ tsMs: 1 })));
    store.ingestFrame(tickFrame(makeTick({ tsMs: 2 })));
    expect(useStreamStore.getState().tickCount).toBe(2);

    store.ingestSnapshot(
      makeSnapshot({
        cells: [
          makeClose({ bucketTs: 500, priceBucket: 71_000 }),
          makeClose({ bucketTs: 560, priceBucket: 71_005 }),
        ],
        cellsOpen: [makeDelta({ bucketTs: 620, priceBucket: 71_010 })],
        recentTicks: [makeTick({ tsMs: 600 })],
      }),
    );
    const state = useStreamStore.getState();
    expect(state.tickCount).toBe(0);
    expect(state.closedCells).toHaveLength(2);
    expect(state.openCells.size).toBe(1);
    expect(state.openCells.has('620:71010')).toBe(true);
    expect(state.recentTicks).toHaveLength(1);
    expect(state.lastTickTsMs).toBe(600);
    expect(state.lastSnapshot).not.toBeNull();
  });

  it('openCells map is keyed by `${bucketTs}:${priceBucket}` deterministically', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(
      deltaFrame(makeDelta({ bucketTs: 1, priceBucket: 2 })),
    );
    store.ingestFrame(
      deltaFrame(makeDelta({ bucketTs: 1, priceBucket: 3 })),
    );
    store.ingestFrame(
      deltaFrame(makeDelta({ bucketTs: 2, priceBucket: 2 })),
    );
    const map = useStreamStore.getState().openCells;
    expect(map.size).toBe(3);
    expect(map.has('1:2')).toBe(true);
    expect(map.has('1:3')).toBe(true);
    expect(map.has('2:2')).toBe(true);
  });

  it('control frames do not mutate domain state', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(tickFrame(makeTick({ tsMs: 10 })));
    const beforeTickCount = useStreamStore.getState().tickCount;
    store.ingestFrame({
      topic: 'control',
      kind: 'control.heartbeat',
      payload: { serverTsMs: 1, framesPerSecOut: 5 },
    });
    store.ingestFrame({
      topic: 'control',
      kind: 'control.overrun',
      payload: { reason: 'queue.overflow', droppedFrames: 1, lastTickTsMs: 1 },
    });
    const afterTickCount = useStreamStore.getState().tickCount;
    expect(afterTickCount).toBe(beforeTickCount);
  });

  it('setConnectionState updates connectionState', () => {
    useStreamStore.getState().setConnectionState('reconnecting');
    expect(useStreamStore.getState().connectionState).toBe('reconnecting');
  });

  it('resetSession returns store to clean defaults', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(tickFrame(makeTick({ tsMs: 1 })));
    store.setConnectionState('connected');
    store.resetSession();
    const state = useStreamStore.getState();
    expect(state.connectionState).toBe('idle');
    expect(state.tickCount).toBe(0);
    expect(state.lastTickTsMs).toBeNull();
    expect(state.recentTicks).toEqual([]);
    expect(state.openCells.size).toBe(0);
    expect(state.closedCells).toEqual([]);
    expect(state.lastSnapshot).toBeNull();
  });
});
