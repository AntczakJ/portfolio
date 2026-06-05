import '@/lib/zod-config';

import { z } from 'zod';

import { currencySchema, idSchema, priceMinorSchema } from './common';

/**
 * Shop — the rental business itself (ADR-003 / PLAN.md).
 *
 * Drives the footer brand block and the `AutoRental` (schema.org) JSON-LD: the
 * business name, support contact, hours, the location id references, and a
 * price-range hint. Single fixed record; faker fills only flavour copy.
 */
export const shopSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  /** One-line positioning ("Premium EVs, by the day."). */
  tagline: z.string().trim().min(1).max(160),
  /** Longer "about" paragraph for the brand-story / footer. */
  about: z.string().trim().min(1).max(600),
  supportEmail: z.email().max(160),
  supportPhone: z.string().trim().min(6).max(24),
  /** Free-text hours line for the footer. */
  hours: z.string().trim().min(1).max(120),
  /** References into the locations catalog (footer + JSON-LD). */
  locationIds: z.array(idSchema).min(1),
  currency: currencySchema,
  /** Price-range bounds (minor units) for the JSON-LD `priceRange`. */
  priceRangeMinMinor: priceMinorSchema,
  priceRangeMaxMinor: priceMinorSchema,
  /** Social handles for the footer (URLs; brand glyphs hand-rolled). */
  social: z.object({
    instagram: z.url().optional(),
    facebook: z.url().optional(),
    tiktok: z.url().optional(),
    x: z.url().optional(),
  }),
});

export type Shop = z.infer<typeof shopSchema>;
