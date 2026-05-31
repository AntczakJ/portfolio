import { describe, expect, it } from 'vitest';

import {
  computeImbalance,
  computeIntensity,
  formatCellVolume,
  isLowConfidence,
  LOW_CONFIDENCE_TRADE_THRESHOLD,
  normalizeClose,
  normalizeDelta,
  type NormalizedCell,
} from '../cells';

function cell(over: Partial<NormalizedCell> = {}): NormalizedCell {
  return {
    bucketTs: 0,
    priceBucket: 71_000,
    bidVolume: 0,
    askVolume: 0,
    trades: 0,
    ...over,
  };
}

describe('computeImbalance', () => {
  it('returns 0 for a balanced cell', () => {
    expect(computeImbalance(cell({ bidVolume: 10, askVolume: 10 }))).toBe(0);
  });

  it('returns 0 for a zero-volume cell', () => {
    expect(computeImbalance(cell())).toBe(0);
  });

  it('is +1 for an ask-dominated cell', () => {
    expect(computeImbalance(cell({ askVolume: 5 }))).toBe(1);
  });

  it('is -1 for a bid-dominated cell', () => {
    expect(computeImbalance(cell({ bidVolume: 5 }))).toBe(-1);
  });

  it('is in (-1, 0) for a sell-leaning cell', () => {
    const v = computeImbalance(cell({ bidVolume: 7, askVolume: 3 }));
    expect(v).toBeCloseTo(-0.4);
  });
});

describe('computeIntensity', () => {
  it('returns 0 when session max is unknown', () => {
    expect(computeIntensity(cell({ trades: 50 }), 0)).toBe(0);
    expect(computeIntensity(cell({ trades: 50 }), Number.NaN)).toBe(0);
  });

  it('scales linearly under session max', () => {
    expect(computeIntensity(cell({ trades: 25 }), 100)).toBeCloseTo(0.25);
  });

  it('clamps above 1', () => {
    expect(computeIntensity(cell({ trades: 200 }), 100)).toBe(1);
  });
});

describe('isLowConfidence', () => {
  it('treats cells below the threshold as low confidence', () => {
    expect(isLowConfidence(cell({ trades: LOW_CONFIDENCE_TRADE_THRESHOLD - 1 }))).toBe(
      true,
    );
  });
  it('does not treat cells at the threshold as low confidence', () => {
    expect(isLowConfidence(cell({ trades: LOW_CONFIDENCE_TRADE_THRESHOLD }))).toBe(
      false,
    );
  });
});

describe('formatCellVolume', () => {
  it('returns empty string for zero volume', () => {
    expect(formatCellVolume(cell())).toBe('');
  });

  it('shows one decimal for sub-10 volumes', () => {
    expect(formatCellVolume(cell({ bidVolume: 0.42 }))).toBe('0.4');
  });

  it('rounds to integer between 10 and 1000', () => {
    expect(formatCellVolume(cell({ bidVolume: 123.4 }))).toBe('123');
  });

  it('uses K-notation above 1000', () => {
    expect(formatCellVolume(cell({ bidVolume: 1500 }))).toBe('1.5K');
    expect(formatCellVolume(cell({ bidVolume: 15_000 }))).toBe('15K');
  });
});

describe('normalize helpers', () => {
  it('normalizeDelta maps delta payload fields', () => {
    const out = normalizeDelta({
      tsMs: 1,
      bucketTs: 1_000,
      priceBucket: 71_000,
      bidVolumeDelta: 1.5,
      askVolumeDelta: 0.5,
      tradesDelta: 3,
    });
    expect(out.bidVolume).toBe(1.5);
    expect(out.askVolume).toBe(0.5);
    expect(out.trades).toBe(3);
  });

  it('normalizeClose maps close payload fields', () => {
    const out = normalizeClose({
      symbol: 'BTCUSDT-PERP',
      bucketTs: 1_000,
      priceBucket: 71_000,
      bidVolume: 12.5,
      askVolume: 7.25,
      trades: 10,
    });
    expect(out.bidVolume).toBe(12.5);
    expect(out.askVolume).toBe(7.25);
    expect(out.trades).toBe(10);
  });
});
