/**
 * Snapshot cache behavior tests — Task 1.6b per ADR-006.
 *
 * Asserts:
 *  - `update` maintains the WS_SNAPSHOT_CELLS_PIN / WS_SNAPSHOT_TICKS_PIN
 *    ring sizes (oldest entries fall out when the pin is exceeded).
 *  - `current()` returns a copy (mutating it does not corrupt the
 *    cache), matches the shape `WSSnapshotPayload` exactly.
 *  - `cacheHitRate()` math — null pre-connect, hits / connects ratio
 *    post-connect.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  WS_SNAPSHOT_CELLS_PIN,
  WS_SNAPSHOT_TICKS_PIN,
  wsSnapshotPayloadSchema,
  type WSCellClosePayload,
  type WSTickPayload,
} from '../../schemas/ws';
import { SnapshotCache } from '../snapshot-cache';

const SYMBOL = 'BTCUSDT-PERP';

function makeCell(bucketTs: number, priceBucket: number): WSCellClosePayload {
  return {
    symbol: SYMBOL,
    bucketTs,
    priceBucket,
    bidVolume: 1,
    askVolume: 2,
    trades: 3,
  };
}

function makeTick(tsMs: number): WSTickPayload {
  return {
    tsMs,
    price: 71_200,
    qty: 0.1,
    aggressor: 'buy',
  };
}

let cache: SnapshotCache;

beforeEach(() => {
  cache = new SnapshotCache();
});

describe('current() shape', () => {
  test('returns null before any update', () => {
    expect(cache.current(SYMBOL)).toBeNull();
  });

  test('returns a payload validated by wsSnapshotPayloadSchema after update', () => {
    cache.update(SYMBOL, {
      symbol: SYMBOL,
      currentBarTs: 60_000,
      cells: [makeCell(60_000, 71_200)],
      cellsOpen: [],
      recentTicks: [makeTick(60_100)],
    });
    const snapshot = cache.current(SYMBOL);
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;
    // The schema parse must succeed — the cache is the producer for
    // the wire-side snapshot frame, so the shape must round-trip
    // through the same Zod schema the WS handler uses.
    const parsed = wsSnapshotPayloadSchema.parse(snapshot);
    expect(parsed.symbol).toBe(SYMBOL);
    expect(parsed.cells.length).toBe(1);
    expect(parsed.recentTicks.length).toBe(1);
  });

  test('returns a defensive copy — mutating result does not corrupt cache', () => {
    cache.update(SYMBOL, {
      symbol: SYMBOL,
      currentBarTs: 60_000,
      cells: [makeCell(60_000, 71_200)],
      recentTicks: [makeTick(60_000)],
    });
    const first = cache.current(SYMBOL);
    expect(first).not.toBeNull();
    if (first === null) return;
    first.cells.length = 0;
    first.recentTicks.length = 0;
    const second = cache.current(SYMBOL);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second.cells.length).toBe(1);
    expect(second.recentTicks.length).toBe(1);
  });
});

describe('ring sizes', () => {
  test('cells ring trims to WS_SNAPSHOT_CELLS_PIN', () => {
    expect(WS_SNAPSHOT_CELLS_PIN).toBe(120);
    const cells = Array.from({ length: WS_SNAPSHOT_CELLS_PIN + 50 }, (_, i) =>
      makeCell(i * 60_000, 71_200 + i),
    );
    cache.update(SYMBOL, { symbol: SYMBOL, currentBarTs: 60_000, cells });
    const snap = cache.current(SYMBOL);
    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.cells.length).toBe(WS_SNAPSHOT_CELLS_PIN);
    // Oldest should have fallen out — the surviving first entry's
    // bucketTs corresponds to index 50 of the original sequence.
    expect(snap.cells[0]?.bucketTs).toBe(50 * 60_000);
  });

  test('recentTicks ring trims to WS_SNAPSHOT_TICKS_PIN', () => {
    expect(WS_SNAPSHOT_TICKS_PIN).toBe(200);
    const ticks = Array.from({ length: WS_SNAPSHOT_TICKS_PIN + 30 }, (_, i) =>
      makeTick(1_000_000 + i),
    );
    cache.update(SYMBOL, {
      symbol: SYMBOL,
      currentBarTs: 60_000,
      recentTicks: ticks,
    });
    const snap = cache.current(SYMBOL);
    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.recentTicks.length).toBe(WS_SNAPSHOT_TICKS_PIN);
    expect(snap.recentTicks[0]?.tsMs).toBe(1_000_000 + 30);
  });

  test('incremental appends respect the cells pin across multiple updates', () => {
    for (let i = 0; i < WS_SNAPSHOT_CELLS_PIN + 10; i++) {
      cache.update(SYMBOL, {
        symbol: SYMBOL,
        currentBarTs: 60_000,
        cells: [makeCell(i * 60_000, 71_200 + i)],
      });
    }
    const snap = cache.current(SYMBOL);
    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.cells.length).toBe(WS_SNAPSHOT_CELLS_PIN);
  });

  test('resetCellsOpen clears the open-delta tail', () => {
    cache.update(SYMBOL, {
      symbol: SYMBOL,
      currentBarTs: 60_000,
      cellsOpen: [
        {
          tsMs: 60_100,
          bucketTs: 60_000,
          priceBucket: 71_200,
          bidVolumeDelta: 0.1,
          askVolumeDelta: 0.2,
          tradesDelta: 1,
        },
      ],
    });
    cache.resetCellsOpen(SYMBOL);
    const snap = cache.current(SYMBOL);
    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.cellsOpen.length).toBe(0);
  });
});

describe('cacheHitRate math', () => {
  test('null before any connect events', () => {
    expect(cache.cacheHitRate()).toBeNull();
  });

  test('0 after one connect with no hit', () => {
    cache.recordConnect();
    expect(cache.cacheHitRate()).toBe(0);
  });

  test('1 after one connect with one hit', () => {
    cache.recordConnect();
    cache.recordHit();
    expect(cache.cacheHitRate()).toBe(1);
  });

  test('hits / connects ratio over many events', () => {
    for (let i = 0; i < 10; i++) cache.recordConnect();
    for (let i = 0; i < 7; i++) cache.recordHit();
    expect(cache.cacheHitRate()).toBeCloseTo(0.7);
    expect(cache.connectTotal).toBe(10);
    expect(cache.hitTotal).toBe(7);
  });
});
