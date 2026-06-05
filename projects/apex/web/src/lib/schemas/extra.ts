import '@/lib/zod-config';

import { z } from 'zod';

import {
  extraKindSchema,
  extraPricingSchema,
  idSchema,
  insuranceTierSchema,
  priceMinorSchema,
} from './common';

/**
 * Extra — a rental add-on (ADR-003 domain model).
 *
 * Insurance is modelled in the CATALOG as `Extra` rows with `kind:
 * 'insurance'` + a `tier` (so the catalog is uniform), but the reservation
 * DRAFT holds a single `insuranceTier` field separate from the `extras: string[]`
 * multi-select array (ADR-003 decision I-A: insurance is exactly-one-of, extras
 * are zero-or-more). `priceQuote` reads insurance rows by tier and sums the
 * selected non-insurance extras.
 *
 * The `tier` field is required on insurance rows and absent on others — encoded
 * as a discriminated union so the type is precise. `exactOptionalPropertyTypes`
 * is satisfied: the insurance variant has `tier` as a required key, the
 * non-insurance variant simply does not declare it.
 */

const baseExtraFields = {
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(200),
  priceMinor: priceMinorSchema,
  pricing: extraPricingSchema,
} as const;

/** A non-insurance add-on (GPS, child seat, additional driver). */
export const addOnExtraSchema = z.object({
  ...baseExtraFields,
  kind: extraKindSchema.exclude(['insurance']),
});

/** An insurance tier row — carries the `tier` discriminant. */
export const insuranceExtraSchema = z.object({
  ...baseExtraFields,
  kind: z.literal('insurance'),
  tier: insuranceTierSchema,
  /** A short ranked benefit line for the tier card. */
  excessMinor: priceMinorSchema,
});

export const extraSchema = z.discriminatedUnion('kind', [
  addOnExtraSchema,
  insuranceExtraSchema,
]);

export type AddOnExtra = z.infer<typeof addOnExtraSchema>;
export type InsuranceExtra = z.infer<typeof insuranceExtraSchema>;
export type Extra = z.infer<typeof extraSchema>;

export const extraListSchema = z.array(extraSchema);
export type ExtraList = z.infer<typeof extraListSchema>;

/** Narrowing helper: is this extra an insurance row? */
export function isInsuranceExtra(extra: Extra): extra is InsuranceExtra {
  return extra.kind === 'insurance';
}
