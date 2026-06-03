import { z } from 'zod';

import {
  currencySchema,
  priceMinorSchema,
  serviceCategorySchema,
} from './common';

/**
 * Service (ADR-003). A fixed, hand-curated menu row. `durationMin` is the
 * SINGLE driver of slot length — combos simply carry a larger `durationMin`
 * (e.g. cut 45, cut+beard 75) and `category: 'combo'`; there is no separate
 * combo-composition model, so `getAvailability` stays one uniform function.
 */
export const serviceSchema = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'kebab-case slug'),
  name: z.string().min(1),
  category: serviceCategorySchema,
  description: z.string().min(1),
  /** Service length in minutes — drives the contiguous block availability
   * must find. Multiple of the 15-minute slot grid. */
  durationMin: z.number().int().positive().max(8 * 60),
  priceMinor: priceMinorSchema,
  currency: currencySchema,
  /** Editorial flag for the "popular" tag on the menu; optional. */
  popular: z.boolean().optional(),
});

export type Service = z.infer<typeof serviceSchema>;
