import { describe, expect, it } from 'vitest';

import {
  advanceCursor,
  BAR_DURATION_MS,
  barCloseMs,
  barToReplayPayload,
  countClosedBars,
  groupCellsByBucket,
} from '../virtual-clock';
import type { ReplayCellRow } from 'tape-server';

function row(overrides: Partial<ReplayCellRow> = {}): ReplayCellRow {
  return {
    symbol: 'BTCUSDT-PERP',
    bucketTs: 0,
    priceBucket: 1,
    bidVolume: 1,
    askVolume: 2,
    trades: 1,
    delta: 1,
    ...overrides,
  };
}

describe('groupCellsByBucket', () => {
  it('groups rows by bucketTs, sorted ascending, preserving cell order', () => {
    const bars = groupCellsByBucket([
      row({ bucketTs: 60_000, priceBucket: 1 }),
      row({ bucketTs: 60_000, priceBucket: 2 }),
      row({ bucketTs: 120_000, priceBucket: 1 }),
    ]);
    expect(bars.map((b) => b.bucketTs)).toEqual([60_000, 120_000]);
    expect(bars[0]!.cells.map((c) => c.priceBucket)).toEqual([1, 2]);
    expect(bars[1]!.cells).toHaveLength(1);
  });

  it('sorts out-of-order bars and still groups correctly', () => {
    const bars = groupCellsByBucket([
      row({ bucketTs: 120_000, priceBucket: 1 }),
      row({ bucketTs: 60_000, priceBucket: 1 }),
      row({ bucketTs: 120_000, priceBucket: 2 }),
    ]);
    expect(bars.map((b) => b.bucketTs)).toEqual([60_000, 120_000]);
    expect(bars[1]!.cells).toHaveLength(2);
  });

  it('returns an empty array for no rows (empty day)', () => {
    expect(groupCellsByBucket([])).toEqual([]);
  });
});

describe('barCloseMs', () => {
  it('a bar closes one bar-duration after its bucket start', () => {
    expect(barCloseMs(60_000)).toBe(60_000 + BAR_DURATION_MS);
  });
});

describe('countClosedBars', () => {
  const bars = groupCellsByBucket([
    row({ bucketTs: 0 }),
    row({ bucketTs: 60_000 }),
    row({ bucketTs: 120_000 }),
  ]);

  it('counts zero before the first bar closes', () => {
    // First bar closes at 60_000; a cursor at 59_999 has closed none.
    expect(countClosedBars(bars, 59_999)).toBe(0);
  });

  it('counts a bar exactly at its close boundary (inclusive)', () => {
    expect(countClosedBars(bars, 60_000)).toBe(1);
    expect(countClosedBars(bars, 120_000)).toBe(2);
    expect(countClosedBars(bars, 180_000)).toBe(3);
  });

  it('returns the full count past the last close', () => {
    expect(countClosedBars(bars, 10_000_000)).toBe(3);
  });

  it('is a prefix count — the closed set is always the leading bars', () => {
    expect(countClosedBars(bars, 130_000)).toBe(2);
  });
});

describe('advanceCursor', () => {
  it('advances by wallDelta * speed', () => {
    expect(advanceCursor(0, 16, 30, 86_400_000)).toBe(480);
  });

  it('1x advances real-time, 30x is 30x faster', () => {
    expect(advanceCursor(1000, 1000, 1, 86_400_000)).toBe(2000);
    expect(advanceCursor(1000, 1000, 30, 86_400_000)).toBe(31_000);
  });

  it('at 30x a 1-min bar lands every 2 s of wall-clock (ADR-006)', () => {
    // 2000 ms wall-clock at 30x advances 60_000 ms = one bar.
    expect(advanceCursor(0, 2000, 30, 86_400_000)).toBe(BAR_DURATION_MS);
  });

  it('clamps to [0, maxMs]', () => {
    expect(advanceCursor(0, -10_000, 1, 86_400_000)).toBe(0);
    expect(advanceCursor(86_399_000, 5000, 30, 86_400_000)).toBe(86_400_000);
  });
});

describe('barToReplayPayload', () => {
  it('projects a grouped bar into a replay.bar payload (totals + delta)', () => {
    const [bar] = groupCellsByBucket([
      row({
        bucketTs: 60_000,
        priceBucket: 7,
        bidVolume: 3,
        askVolume: 9,
        trades: 4,
        delta: 6,
      }),
    ]);
    const payload = barToReplayPayload('BTCUSDT-PERP', bar!);
    expect(payload.symbol).toBe('BTCUSDT-PERP');
    expect(payload.bucketTs).toBe(60_000);
    expect(payload.cells).toEqual([
      { priceBucket: 7, bidVolume: 3, askVolume: 9, trades: 4, delta: 6 },
    ]);
    // The per-cell symbol is dropped (it lives once on the frame).
    expect('symbol' in payload.cells[0]!).toBe(false);
  });
});
