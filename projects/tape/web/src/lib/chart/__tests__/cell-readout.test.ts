/**
 * Cell readout formatter coverage (Task 3.5).
 *
 * The SR mirror's load-bearing claim is that it speaks a clean,
 * deterministic sentence per hovered cell. These tests pin the exact
 * sentence shape so a refactor cannot silently change what a
 * screen-reader user hears.
 */
import { describe, expect, it } from 'vitest';

import {
  cellReadoutKey,
  formatCellReadoutSr,
} from '../cell-readout';
import type { NormalizedCell } from '../cells';

const cell = { bucketTs: 1_780_000_000_000, priceBucket: 14_250 };

function data(bid: number, ask: number): NormalizedCell {
  return {
    bucketTs: cell.bucketTs,
    priceBucket: cell.priceBucket,
    bidVolume: bid,
    askVolume: ask,
    trades: 1,
  };
}

describe('cellReadoutKey', () => {
  it('is stable for the same cell and distinct across cells', () => {
    expect(cellReadoutKey({ bucketTs: 100, priceBucket: 2 })).toBe('100:2');
    expect(cellReadoutKey({ bucketTs: 100, priceBucket: 3 })).not.toBe(
      cellReadoutKey({ bucketTs: 100, priceBucket: 2 }),
    );
  });
});

describe('formatCellReadoutSr', () => {
  it('speaks price, bid, ask, delta and ask-dominant imbalance', () => {
    // INDEX 14_250 × $5 = $71,250. Ask 3.4 vs Bid 2.1 → delta +1.3,
    // imbalance = 1.3 / 5.5 ≈ 0.236 → 24% ask. Matches the brief's
    // example shape "Price 71,250. Bid 2.1, Ask 3.4, Delta +1.3,
    // Imbalance 62% ask." (different magnitudes, same grammar).
    const out = formatCellReadoutSr(cell, data(2.1, 3.4));
    expect(out).toBe(
      'Price 71,250. Bid 2.1, Ask 3.4, Delta +1.3, Imbalance 24% ask.',
    );
  });

  it('uses the "bid" side word when selling dominates', () => {
    const out = formatCellReadoutSr(cell, data(8, 2));
    // delta = 2 - 8 = -6, imbalance = -6/10 = -0.6 → 60% bid.
    expect(out).toContain('Delta -6.0');
    expect(out).toContain('Imbalance 60% bid.');
  });

  it('says "balanced" at exactly zero imbalance', () => {
    const out = formatCellReadoutSr(cell, data(5, 5));
    // Zero delta is spoken without a sign ("Delta 0.0") — the natural
    // spoken form; the sign only appears for non-zero values.
    expect(out).toContain('Delta 0.0');
    expect(out).toContain('Imbalance balanced.');
  });

  it('announces a full zero sentence for an empty cell (data null)', () => {
    const out = formatCellReadoutSr(cell, null);
    expect(out).toBe(
      'Price 71,250. Bid 0.0, Ask 0.0, Delta 0.0, Imbalance balanced.',
    );
  });
});
