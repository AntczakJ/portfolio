import '@/lib/zod-config';

import { z } from 'zod';

import { currencySchema, priceMinorSchema } from './common';

/**
 * PriceQuote — the derived price breakdown returned by `priceQuote` (ADR-003).
 *
 * The function is pure and lives in `src/lib/pricing.ts` (Task 3.4); this
 * schema is the shape it returns and the summary rail + confirmation render.
 *
 *   base         = dailyPriceMinor × rentalDays
 *   extrasTotal  = Σ selected non-insurance extras (per-day → × rentalDays)
 *   insuranceTotal = insuranceTier ? (its per-day row) × rentalDays : 0
 *   oneWayFee    = pickup ≠ return ? ONE_WAY_FEE_MINOR : 0   (ADR-003 R-A)
 *   discount     = multi-day discount off `base` (≥ threshold days)
 *   total        = base + extrasTotal + insuranceTotal + oneWayFee − discount
 *
 * All amounts are non-negative minor units; `total` is clamped at 0.
 */
export const priceQuoteSchema = z.object({
  base: priceMinorSchema,
  extrasTotal: priceMinorSchema,
  insuranceTotal: priceMinorSchema,
  oneWayFee: priceMinorSchema,
  /** Discount as a positive amount SUBTRACTED from the subtotal. */
  discount: priceMinorSchema,
  total: priceMinorSchema,
  currency: currencySchema,
  /** Echoed for display/audit — the day count that drove the quote. */
  rentalDays: z.number().int().min(0),
});

export type PriceQuote = z.infer<typeof priceQuoteSchema>;
