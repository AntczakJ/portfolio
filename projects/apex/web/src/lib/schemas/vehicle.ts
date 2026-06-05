import '@/lib/zod-config';

import { z } from 'zod';

import {
  currencySchema,
  idSchema,
  priceMinorSchema,
  slugSchema,
  vehicleTierSchema,
} from './common';

/**
 * Vehicle — a fixed, hand-curated fleet entry (ADR-003 domain model).
 *
 * `dailyPriceMinor` is the single driver of the base price. Exactly one
 * vehicle in the catalog has `configurable: true` (the hero car with the GLB
 * model + colour/wheel options + the live R3F scene); the rest use static
 * renders. `heroRenderSrc` is the AVIF still used as the card / hero image and,
 * for the configurable car, as the LCP static render the seam hands off from.
 */
export const vehicleSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  /** Short marketing tagline (faker-baked flavour copy). */
  tagline: z.string().trim().min(1).max(160),
  tier: vehicleTierSchema,
  /** WLTP-style range, kilometres. */
  rangeKm: z.number().int().min(50).max(1200),
  /** 0–100 km/h acceleration, seconds. */
  accel0to100: z.number().min(1).max(20),
  /** Top speed, km/h — a spec-sheet flourish. */
  topSpeedKph: z.number().int().min(120).max(400),
  /** Usable battery capacity, kWh. */
  batteryKwh: z.number().min(20).max(200),
  seats: z.number().int().min(2).max(9),
  dailyPriceMinor: priceMinorSchema,
  currency: currencySchema,
  /** Path to the AVIF hero/card render (same-origin static asset). */
  heroRenderSrc: z.string().trim().min(1),
  /** True for the single hero car that has the live configurator. */
  configurable: z.boolean(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;

/** The fleet as an array (the `['vehicles']` query payload). */
export const vehicleListSchema = z.array(vehicleSchema);
export type VehicleList = z.infer<typeof vehicleListSchema>;
