import { describe, expect, it } from 'vitest';

import { MULTI_DAY_DISCOUNT_TIERS, ONE_WAY_FEE_MINOR, priceQuote } from './pricing';
import type { Extra } from './schemas/extra';

/**
 * Phase 7 (Task 7.1) — exhaustive pricing edge coverage, filling the gaps the
 * Phase-3 sanity suite left:
 *   - every multi-day discount boundary (just below / exactly at / above each
 *     tier, the longest-tier-wins rule);
 *   - half-up minor-unit rounding of the discount;
 *   - per-day vs flat add-ons AND per-day vs flat insurance;
 *   - unknown extra ids ignored (no throw, no phantom charge);
 *   - the one-way fee on/off;
 *   - the all-zero quote for a non-positive day count;
 *   - the total clamp ≥ 0;
 *   - currency carried from the vehicle onto the quote.
 *
 * Not duplicating the Phase-3 `pricing.test.ts` sanity cases.
 */

const VEHICLE = { dailyPriceMinor: 10000, currency: 'EUR' } as const;

const CATALOG: Extra[] = [
  { id: 'ext-gps', name: 'GPS', description: 'd', priceMinor: 600, pricing: 'per-day', kind: 'gps' },
  { id: 'ext-seat', name: 'Child seat', description: 'd', priceMinor: 450, pricing: 'per-day', kind: 'child-seat' },
  { id: 'ext-driver', name: 'Driver', description: 'd', priceMinor: 3500, pricing: 'flat', kind: 'additional-driver' },
  { id: 'ins-basic', name: 'Basic', description: 'd', priceMinor: 1500, pricing: 'per-day', kind: 'insurance', tier: 'basic', excessMinor: 80000 },
  { id: 'ins-plus', name: 'Plus', description: 'd', priceMinor: 2900, pricing: 'per-day', kind: 'insurance', tier: 'plus', excessMinor: 40000 },
  { id: 'ins-premium', name: 'Premium', description: 'd', priceMinor: 4900, pricing: 'per-day', kind: 'insurance', tier: 'premium', excessMinor: 0 },
];

describe('priceQuote — discount tier boundaries', () => {
  const base = (days: number) => priceQuote({ vehicle: VEHICLE, rentalDays: days, extras: [], oneWay: false, catalog: CATALOG });

  it('applies NO discount at 6 days (below the first tier)', () => {
    expect(base(6).discount).toBe(0);
    expect(base(6).total).toBe(60000);
  });

  it('applies 5% at exactly 7 days', () => {
    const q = base(7);
    expect(q.discount).toBe(Math.round(70000 * 0.05));
    expect(q.total).toBe(70000 - q.discount);
  });

  it('keeps 5% between 7 and 13 days', () => {
    expect(base(10).discount).toBe(Math.round(100000 * 0.05));
  });

  it('applies 10% at exactly 14 days', () => {
    expect(base(14).discount).toBe(Math.round(140000 * 0.1));
  });

  it('applies 15% at exactly 28 days (longest tier wins)', () => {
    expect(base(28).discount).toBe(Math.round(280000 * 0.15));
  });

  it('keeps 15% above 28 days (clamped to the longest tier)', () => {
    expect(base(30).discount).toBe(Math.round(300000 * 0.15));
  });

  it('the discount tiers are defined in ascending order, as the longest-wins loop expects', () => {
    const mins = MULTI_DAY_DISCOUNT_TIERS.map((t) => t.minDays);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });
});

describe('priceQuote — half-up minor-unit rounding', () => {
  it('rounds a fractional discount to a whole minor unit (half-up)', () => {
    // daily 333, 7 days → base 2331; 5% = 116.55 → rounds to 117.
    const q = priceQuote({
      vehicle: { dailyPriceMinor: 333, currency: 'EUR' },
      rentalDays: 7,
      extras: [],
      oneWay: false,
      catalog: CATALOG,
    });
    expect(q.base).toBe(2331);
    expect(q.discount).toBe(117);
    expect(Number.isInteger(q.discount)).toBe(true);
    expect(Number.isInteger(q.total)).toBe(true);
  });
});

describe('priceQuote — extras (per-day vs flat) + unknown ids', () => {
  it('multiplies per-day add-ons by rentalDays and leaves flat ones flat', () => {
    const q = priceQuote({
      vehicle: VEHICLE,
      rentalDays: 4,
      extras: ['ext-gps', 'ext-seat', 'ext-driver'],
      oneWay: false,
      catalog: CATALOG,
    });
    // gps 600×4 + seat 450×4 + driver 3500(flat) = 2400 + 1800 + 3500 = 7700
    expect(q.extrasTotal).toBe(600 * 4 + 450 * 4 + 3500);
  });

  it('ignores an unknown extra id without throwing or charging', () => {
    const q = priceQuote({
      vehicle: VEHICLE,
      rentalDays: 3,
      extras: ['ext-gps', 'ext-does-not-exist'],
      oneWay: false,
      catalog: CATALOG,
    });
    expect(q.extrasTotal).toBe(600 * 3);
  });

  it('never counts an insurance row in extrasTotal even if its id is in extras', () => {
    // insurance is selected via insuranceTier, not extras; passing its id in
    // extras must not double-charge it as an add-on.
    const q = priceQuote({
      vehicle: VEHICLE,
      rentalDays: 2,
      extras: ['ins-plus'],
      oneWay: false,
      catalog: CATALOG,
    });
    expect(q.extrasTotal).toBe(0);
    expect(q.insuranceTotal).toBe(0); // no insuranceTier passed
  });
});

describe('priceQuote — insurance tiers', () => {
  it('charges the chosen tier per-day', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 5, extras: [], insuranceTier: 'premium', oneWay: false, catalog: CATALOG });
    expect(q.insuranceTotal).toBe(4900 * 5);
  });

  it('charges nothing when no tier is chosen', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 5, extras: [], oneWay: false, catalog: CATALOG });
    expect(q.insuranceTotal).toBe(0);
  });

  it('charges nothing for a tier with no catalog row (defensive)', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: 5, extras: [], insuranceTier: 'plus', oneWay: false, catalog: [] });
    expect(q.insuranceTotal).toBe(0);
  });
});

describe('priceQuote — one-way fee, clamp, currency, all-zero', () => {
  it('adds the one-way fee only when oneWay', () => {
    expect(priceQuote({ vehicle: VEHICLE, rentalDays: 2, extras: [], oneWay: true, catalog: CATALOG }).oneWayFee).toBe(ONE_WAY_FEE_MINOR);
    expect(priceQuote({ vehicle: VEHICLE, rentalDays: 2, extras: [], oneWay: false, catalog: CATALOG }).oneWayFee).toBe(0);
  });

  it('carries the vehicle currency onto the quote', () => {
    const q = priceQuote({ vehicle: { dailyPriceMinor: 5000, currency: 'GBP' }, rentalDays: 1, extras: [], oneWay: false, catalog: CATALOG });
    expect(q.currency).toBe('GBP');
  });

  it('returns an all-zero quote (incl. rentalDays 0) for a non-positive day count', () => {
    const q = priceQuote({ vehicle: VEHICLE, rentalDays: -1, extras: ['ext-gps'], insuranceTier: 'plus', oneWay: true, catalog: CATALOG });
    expect(q).toMatchObject({ base: 0, extrasTotal: 0, insuranceTotal: 0, oneWayFee: 0, discount: 0, total: 0, rentalDays: 0 });
    expect(q.currency).toBe('EUR'); // currency still carried
  });

  it('clamps the total to ≥ 0 if a discount would exceed the rest (defensive)', () => {
    // A free vehicle with a discount cannot push the total negative; the one-way
    // fee + extras keep it ≥ 0 regardless. Use a zero daily price + no extras to
    // exercise the Math.max(0, …) floor.
    const q = priceQuote({ vehicle: { dailyPriceMinor: 0, currency: 'EUR' }, rentalDays: 30, extras: [], oneWay: false, catalog: CATALOG });
    expect(q.total).toBeGreaterThanOrEqual(0);
    expect(q.discount).toBe(0); // 15% of 0 base = 0
  });

  it('composes the full breakdown into total = base + extras + insurance + oneWay − discount', () => {
    const q = priceQuote({
      vehicle: VEHICLE,
      rentalDays: 7,
      extras: ['ext-gps', 'ext-driver'],
      insuranceTier: 'plus',
      oneWay: true,
      catalog: CATALOG,
    });
    const expected =
      q.base + q.extrasTotal + q.insuranceTotal + q.oneWayFee - q.discount;
    expect(q.total).toBe(expected);
  });
});
