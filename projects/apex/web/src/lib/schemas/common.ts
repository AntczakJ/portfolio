// Side-effect FIRST (ADR-002 §5): ensure zod is configured jitless before any
// schema in this module graph compiles a validator under the strict CSP.
import '@/lib/zod-config';

import { z } from 'zod';

/**
 * Shared primitives for the apex schema contract (Task 3.1).
 *
 * These are the small, reused building blocks every entity schema composes —
 * kept in one place so the contract is consistent (a calendar date is a
 * calendar date everywhere). All schemas live in `src/lib/schemas/` and are
 * the single source of truth shared by the wizard form steps and the mocked
 * `reserveVehicle` submit (docs/conventions.md § 5).
 */

/** A non-empty trimmed identifier slug (`kebab-case`, lowercase). */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase kebab-case slug');

/** A stable string id (catalog rows, bookings, etc.). */
export const idSchema = z.string().trim().min(1).max(80);

/**
 * A calendar date `YYYY-MM-DD` (UTC, no time component). The booking/range
 * domain operates on whole days, so dates — not instants — are the unit.
 */
export const dateIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD calendar date')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Must be a valid calendar date',
  });

/** A price in minor units (e.g. cents), non-negative integer. */
export const priceMinorSchema = z.number().int().min(0);

/** ISO-4217 currency code (uppercase, 3 letters). v1 is single-currency. */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be an ISO-4217 currency code');

/** A WGS84 latitude / longitude pair component. */
export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

/** Vehicle tier ladder (drives the fleet grouping + filtering). */
export const vehicleTierSchema = z.enum([
  'compact',
  'sedan',
  'suv',
  'performance',
]);
export type VehicleTier = z.infer<typeof vehicleTierSchema>;

/** Insurance tier ladder — a single-choice (exactly-one-of) enum (ADR-003 I-A). */
export const insuranceTierSchema = z.enum(['basic', 'plus', 'premium']);
export type InsuranceTier = z.infer<typeof insuranceTierSchema>;

/** Extra kind discriminator. Insurance rows carry `kind: 'insurance'` + a tier. */
export const extraKindSchema = z.enum([
  'gps',
  'child-seat',
  'additional-driver',
  'insurance',
]);
export type ExtraKind = z.infer<typeof extraKindSchema>;

/** How an extra is priced. */
export const extraPricingSchema = z.enum(['per-day', 'flat']);
export type ExtraPricing = z.infer<typeof extraPricingSchema>;

/** Location kind (drives the icon + the locations section grouping). */
export const locationKindSchema = z.enum(['airport', 'city', 'depot']);
export type LocationKind = z.infer<typeof locationKindSchema>;
