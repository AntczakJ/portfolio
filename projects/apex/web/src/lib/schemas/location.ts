import '@/lib/zod-config';

import { z } from 'zod';

import {
  idSchema,
  latSchema,
  lngSchema,
  locationKindSchema,
  slugSchema,
} from './common';

/**
 * Location — a fixed rental pickup/return point (ADR-003 domain model).
 *
 * Drives the pickup/return selectors in the wizard's dates-locations step and
 * the locations section. `staticMapSrc` is a styled static-map AVIF (no live
 * embed — PLAN.md, to protect the performance budget); the interaction is a
 * maps click-through built from `lat`/`lng`.
 */
export const locationSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  kind: locationKindSchema,
  address: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(80),
  lat: latSchema,
  lng: lngSchema,
  /** Path to the styled static-map AVIF (same-origin static asset). */
  staticMapSrc: z.string().trim().min(1),
  /** Human-readable opening hours line (e.g. "Mon–Sun, 06:00–23:00"). */
  hours: z.string().trim().min(1).max(80),
});

export type Location = z.infer<typeof locationSchema>;

export const locationListSchema = z.array(locationSchema);
export type LocationList = z.infer<typeof locationListSchema>;
