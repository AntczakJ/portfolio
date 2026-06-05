import type { InsuranceTier } from './schemas/common';
import { isInsuranceExtra, type Extra } from './schemas/extra';
import type { PriceQuote } from './schemas/price-quote';
import type { Vehicle } from './schemas/vehicle';

/**
 * Pure deterministic pricing (Task 3.4 / ADR-003).
 *
 * No React, no `Date.now()` / `Math.random()`. Unit-tested in isolation
 * (Phase 7). All amounts are integer minor units (e.g. cents).
 *
 *   base           = vehicle.dailyPriceMinor × rentalDays
 *   extrasTotal    = Σ selected non-insurance extras
 *                      (pricing === 'per-day' ? priceMinor × rentalDays : priceMinor)
 *   insuranceTotal = insuranceTier ? (its per-day Extra row) × rentalDays : 0
 *   oneWayFee      = oneWay ? ONE_WAY_FEE_MINOR : 0   (ADR-003 R-A)
 *   discount       = multi-day discount off `base` (see thresholds below)
 *   total          = base + extrasTotal + insuranceTotal + oneWayFee − discount
 */

/** Flat surcharge when pickup ≠ return (ADR-003 R-A), minor units. */
export const ONE_WAY_FEE_MINOR = 4900;

/**
 * Multi-day discount tiers off `base`, as basis points (1/100 of a percent),
 * applied at the LONGEST satisfied threshold. Kept simple + tested at the
 * boundary (Phase 7). Half-up rounding to whole minor units.
 */
export const MULTI_DAY_DISCOUNT_TIERS: readonly {
  minDays: number;
  bps: number;
}[] = [
  { minDays: 7, bps: 500 }, // ≥ 7 days → 5% off base
  { minDays: 14, bps: 1000 }, // ≥ 14 days → 10% off base
  { minDays: 28, bps: 1500 }, // ≥ 28 days → 15% off base
];

interface PriceQuoteInput {
  vehicle: Pick<Vehicle, 'dailyPriceMinor' | 'currency'>;
  rentalDays: number;
  /** Selected non-insurance extra ids. */
  extras: readonly string[];
  /** The selected insurance tier, if any. */
  insuranceTier?: InsuranceTier;
  /** Whether pickup ≠ return (adds the one-way fee). */
  oneWay: boolean;
  /** The full extras catalog (insurance + add-ons), to look up prices. */
  catalog: readonly Extra[];
}

/** Round half-up to a whole minor unit. */
function roundMinor(value: number): number {
  return Math.round(value);
}

/** The discount basis points for a given rental length (longest tier wins). */
function discountBpsForDays(rentalDays: number): number {
  let bps = 0;
  for (const tier of MULTI_DAY_DISCOUNT_TIERS) {
    if (rentalDays >= tier.minDays) bps = tier.bps;
  }
  return bps;
}

/**
 * `priceQuote` — the pure price breakdown. `rentalDays` is the whole-day range
 * length (computed upstream from the date range via `diffDays`). When
 * `rentalDays <= 0` everything is zero (an incomplete draft).
 */
export function priceQuote(input: PriceQuoteInput): PriceQuote {
  const { vehicle, rentalDays, extras, insuranceTier, oneWay, catalog } = input;
  const currency = vehicle.currency;

  if (rentalDays <= 0) {
    return {
      base: 0,
      extrasTotal: 0,
      insuranceTotal: 0,
      oneWayFee: 0,
      discount: 0,
      total: 0,
      currency,
      rentalDays: 0,
    };
  }

  const base = vehicle.dailyPriceMinor * rentalDays;

  // Selected non-insurance extras.
  const selected = new Set(extras);
  let extrasTotal = 0;
  for (const extra of catalog) {
    if (isInsuranceExtra(extra)) continue;
    if (!selected.has(extra.id)) continue;
    extrasTotal +=
      extra.pricing === 'per-day'
        ? extra.priceMinor * rentalDays
        : extra.priceMinor;
  }

  // Insurance — read the catalog row for the chosen tier (always per-day).
  let insuranceTotal = 0;
  if (insuranceTier) {
    const row = catalog.find(
      (e) => isInsuranceExtra(e) && e.tier === insuranceTier,
    );
    if (row) {
      insuranceTotal =
        row.pricing === 'per-day'
          ? row.priceMinor * rentalDays
          : row.priceMinor;
    }
  }

  const oneWayFee = oneWay ? ONE_WAY_FEE_MINOR : 0;

  const discount = roundMinor((base * discountBpsForDays(rentalDays)) / 10_000);

  const total = Math.max(
    0,
    base + extrasTotal + insuranceTotal + oneWayFee - discount,
  );

  return {
    base,
    extrasTotal,
    insuranceTotal,
    oneWayFee,
    discount,
    total,
    currency,
    rentalDays,
  };
}
