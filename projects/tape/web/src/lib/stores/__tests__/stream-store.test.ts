import { afterEach, describe, expect, it } from 'vitest';

import {
  STREAM_CLOSED_CELLS_CAP,
  STREAM_CVD_SERIES_CAP,
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

  it('derives CVD by folding askVolume - bidVolume per cell.close (ADR-008)', () => {
    const store = useStreamStore.getState();
    expect(useStreamStore.getState().cvd).toBe(0);
    // Net +5 (buys dominate).
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 1, priceBucket: 71_000, bidVolume: 5, askVolume: 10 }),
      ),
    );
    expect(useStreamStore.getState().cvd).toBe(5);
    // Net -8 (sells dominate). Running CVD: 5 + (-8) = -3.
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 2, priceBucket: 71_000, bidVolume: 12, askVolume: 4 }),
      ),
    );
    expect(useStreamStore.getState().cvd).toBe(-3);
  });

  it('CVD accumulator is not trimmed when the closed-cell ring overflows', () => {
    const store = useStreamStore.getState();
    // Push CAP + 20 closing cells, each contributing +1 to CVD. The
    // ring keeps only CAP cells but the CVD must reflect every fold.
    const n = STREAM_CLOSED_CELLS_CAP + 20;
    for (let i = 0; i < n; i++) {
      store.ingestFrame(
        closeFrame(
          makeClose({
            bucketTs: 1000 + i,
            priceBucket: 71_000,
            bidVolume: 0,
            askVolume: 1,
          }),
        ),
      );
    }
    const state = useStreamStore.getState();
    expect(state.closedCells).toHaveLength(STREAM_CLOSED_CELLS_CAP);
    expect(state.cvd).toBe(n);
  });

  it('ingestSnapshot seeds CVD from the full snapshot closed-cell history', () => {
    const store = useStreamStore.getState();
    // Pre-fold a closed cell so the snapshot reset can be observed.
    store.ingestFrame(
      closeFrame(makeClose({ bidVolume: 0, askVolume: 99 })),
    );
    expect(useStreamStore.getState().cvd).toBe(99);
    store.ingestSnapshot(
      makeSnapshot({
        cells: [
          makeClose({ bucketTs: 500, bidVolume: 3, askVolume: 10 }), // +7
          makeClose({ bucketTs: 560, bidVolume: 8, askVolume: 2 }), // -6
        ],
      }),
    );
    // Snapshot is a fresh fold: 7 + (-6) = 1, NOT 99 + 1.
    expect(useStreamStore.getState().cvd).toBe(1);
  });

  it('cvdSeries appends one running-CVD point per distinct bar (3.2c)', () => {
    const store = useStreamStore.getState();
    expect(useStreamStore.getState().cvdSeries).toEqual([]);
    // Bar 1: two closes (two price buckets) — net +5 then +2 → running 7.
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 100, priceBucket: 1, bidVolume: 0, askVolume: 5 }),
      ),
    );
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 100, priceBucket: 2, bidVolume: 1, askVolume: 3 }),
      ),
    );
    // One series point for bar 100, running cvd = 5 + 2 = 7.
    expect(useStreamStore.getState().cvdSeries).toEqual([
      { bucketTs: 100, cvd: 7 },
    ]);
    // Bar 2: net -10 → running 7 - 10 = -3, appends a new point.
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 160, priceBucket: 1, bidVolume: 10, askVolume: 0 }),
      ),
    );
    expect(useStreamStore.getState().cvdSeries).toEqual([
      { bucketTs: 100, cvd: 7 },
      { bucketTs: 160, cvd: -3 },
    ]);
  });

  it('cvdSeries trailing point updates in place for same-bar closes', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 200, priceBucket: 1, bidVolume: 0, askVolume: 4 }),
      ),
    );
    expect(useStreamStore.getState().cvdSeries).toHaveLength(1);
    store.ingestFrame(
      closeFrame(
        makeClose({ bucketTs: 200, priceBucket: 2, bidVolume: 0, askVolume: 6 }),
      ),
    );
    const series = useStreamStore.getState().cvdSeries;
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ bucketTs: 200, cvd: 10 });
  });

  it('cvdSeries ring is bounded at STREAM_CVD_SERIES_CAP', () => {
    const store = useStreamStore.getState();
    const n = STREAM_CVD_SERIES_CAP + 15;
    for (let i = 0; i < n; i++) {
      store.ingestFrame(
        closeFrame(
          makeClose({
            bucketTs: 1000 + i * 60,
            priceBucket: 1,
            bidVolume: 0,
            askVolume: 1,
          }),
        ),
      );
    }
    const series = useStreamStore.getState().cvdSeries;
    expect(series).toHaveLength(STREAM_CVD_SERIES_CAP);
    // Oldest retained bar is the 16th we pushed (index 15).
    expect(series[0]!.bucketTs).toBe(1000 + 15 * 60);
    // Newest point carries the full running CVD (every cell was +1).
    expect(series[series.length - 1]!.cvd).toBe(n);
  });

  it('ingestSnapshot rebuilds cvdSeries from snapshot closed cells (3.2c)', () => {
    const store = useStreamStore.getState();
    // Pre-fold a stale point so the snapshot reset can be observed.
    store.ingestFrame(
      closeFrame(makeClose({ bucketTs: 1, bidVolume: 0, askVolume: 99 })),
    );
    expect(useStreamStore.getState().cvdSeries).toHaveLength(1);
    store.ingestSnapshot(
      makeSnapshot({
        cells: [
          makeClose({ bucketTs: 500, bidVolume: 0, askVolume: 10 }), // +10
          makeClose({ bucketTs: 500, bidVolume: 4, askVolume: 0 }), // -4 → 6
          makeClose({ bucketTs: 560, bidVolume: 0, askVolume: 3 }), // +3 → 9
        ],
      }),
    );
    expect(useStreamStore.getState().cvdSeries).toEqual([
      { bucketTs: 500, cvd: 6 },
      { bucketTs: 560, cvd: 9 },
    ]);
  });

  it('resetSession clears cvdSeries', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(closeFrame(makeClose({ bidVolume: 0, askVolume: 5 })));
    expect(useStreamStore.getState().cvdSeries).toHaveLength(1);
    store.resetSession();
    expect(useStreamStore.getState().cvdSeries).toEqual([]);
  });

  it('resetSession zeroes CVD', () => {
    const store = useStreamStore.getState();
    store.ingestFrame(closeFrame(makeClose({ bidVolume: 0, askVolume: 5 })));
    expect(useStreamStore.getState().cvd).toBe(5);
    store.resetSession();
    expect(useStreamStore.getState().cvd).toBe(0);
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
    expect(state.cvd).toBe(0);
    expect(state.lastSnapshot).toBeNull();
  });
});
