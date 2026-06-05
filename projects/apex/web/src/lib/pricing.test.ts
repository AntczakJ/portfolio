import { describe, expect, it } from 'vitest';

import { ONE_WAY_FEE_MINOR, priceQuote } from './pricing';
import type { Extra } from './schemas/extra';

/**
 * Sanity coverage for the pure price logic (Task 3.4). The full suite (every
 * discount boundary, per-day vs flat, tier edge cases) is Phase 7.
 */

const VEHICLE = { dailyPriceMinor: 10000, currency: 'EUR' } as const;

const CATALOG: Extra[] = [
  { id: 'ext-gps', name: 'GPS', description: 'd', priceMinor: 600, pricing: 'per-day', kind: 'gps' },
  { id: 'ext-flat', name: 'Driver', description: 'd', priceMinor: 3500, pricing: 'flat', kind: 'additional-driver' },
  { id: 'ins-plus', name: 'Plus', description: 'd', priceMinor: 2900, pricing: 'per-day', kind: 'insurance', tier: 'plus', excessMinor: 40000 },
];

describe('priceQuote', () => {
  it('computes base = daily × days', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 3, extras: [], oneWay: false, catalog: CATALOG });
    expect(q.base).toBe(30000);
    expect(q.total).toBe(30000);
  });

  it('sums per-day and flat extras correctly', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 2, extras: ['ext-gps', 'ext-flat'], oneWay: false, catalog: CATALOG });
    // base 20000 + gps 600×2 + flat 3500 = 24700
    expect(q.extrasTotal).toBe(600 * 2 + 3500);
    expect(q.total).toBe(20000 + 1200 + 3500);
  });

  it('adds per-day insurance for the chosen tier', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 4, extras: [], insuranceTier: 'plus', oneWay: false, catalog: CATALOG });
    expect(q.insuranceTotal).toBe(2900 * 4);
  });

  it('adds the one-way fee when pickup != return', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 1, extras: [], oneWay: true, catalog: CATALOG });
    expect(q.oneWayFee).toBe(ONE_WAY_FEE_MINOR);
  });

  it('applies the multi-day discount at the 7-day boundary (5% off base)', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 7, extras: [], oneWay: false, catalog: CATALOG });
    expect(q.discount).toBe(Math.round(70000 * 0.05));
    expect(q.total).toBe(70000 - q.discount);
  });

  it('returns all-zero for a non-positive day count', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 0, extras: ['ext-gps'], oneWay: true, catalog: CATALOG });
    expect(q.total).toBe(0);
    expect(q.base).toBe(0);
  });
});
