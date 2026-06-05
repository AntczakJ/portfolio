import {
  extraListSchema,
  isInsuranceExtra,
  type AddOnExtra,
  type Extra,
  type InsuranceExtra,
} from '@/lib/schemas/extra';
import type { InsuranceTier } from '@/lib/schemas/common';

import { SEED_EXTRAS } from './seed-data';

/**
 * Extras mock accessor (Task 3.2).
 *
 * The catalog is uniform (insurance rows are `Extra`s with `kind: 'insurance'`
 * + a `tier`), but the helpers split it into the add-on multi-select and the
 * insurance tier ladder (ADR-003 I-A) that the step-3 UI + `priceQuote` use.
 */
export const EXTRAS: readonly Extra[] = extraListSchema.parse(
  SEED_EXTRAS,
);

/** Non-insurance add-ons (the multi-select checkboxes). */
export const ADD_ONS: readonly AddOnExtra[] = EXTRAS.filter(
  (e): e is AddOnExtra => !isInsuranceExtra(e),
);

/** Insurance tiers (the single-choice radio ladder), ordered basic → premium. */
const TIER_ORDER: Record<InsuranceTier, number> = {
  basic: 0,
  plus: 1,
  premium: 2,
};
export const INSURANCE_TIERS: readonly InsuranceExtra[] = EXTRAS.filter(
  isInsuranceExtra,
).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

/** Look up an extra by id. */
export function getExtraById(id: string): Extra | undefined {
  return EXTRAS.find((e) => e.id === id);
}

/** Look up the insurance row for a tier. */
export function getInsuranceByTier(
  tier: InsuranceTier,
): InsuranceExtra | undefined {
  return INSURANCE_TIERS.find((e) => e.tier === tier);
}
