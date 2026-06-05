import '@/lib/zod-config';

import { z } from 'zod';

import { currencySchema, idSchema, insuranceTierSchema } from './common';
import { driverSchema } from './driver';
import { priceQuoteSchema } from './price-quote';
import { dateRangeSchema } from './availability';

/**
 * ReservationDraft — the Zustand wizard state shape AND the persisted-shape
 * guard + submit projection (ADR-003).
 *
 * The DRAFT is permissive: most fields are optional because the wizard
 * accumulates them step by step. Insurance is a SEPARATE single-choice field
 * (`insuranceTier`), distinct from the `extras: string[]` multi-select array
 * (ADR-003 I-A). The carried configurator selection lives in `config` (the
 * spine thread). `savedAt` drives the 24 h TTL on rehydrate.
 *
 * The SUBMIT projection (`reservationSubmitSchema`) is the STRICT shape the
 * `reserveVehicle` server action re-validates — every field the confirmation
 * needs is required there. This is the single contract shared by the form
 * steps and the mocked submit (docs/conventions.md § 5).
 */

/** The five wizard steps as a discriminant. */
export const wizardStepSchema = z.enum([
  'vehicle',
  'dates-locations',
  'extras',
  'driver',
  'confirmation',
]);
export type WizardStep = z.infer<typeof wizardStepSchema>;

/** The carried configurator selection (colour + wheel ids). */
export const reservationConfigSchema = z.object({
  colorId: idSchema,
  wheelId: idSchema,
});
export type ReservationConfig = z.infer<typeof reservationConfigSchema>;

/** The permissive in-progress draft (Zustand state + persisted shape). */
export const reservationDraftSchema = z.object({
  step: wizardStepSchema,
  vehicleId: idSchema.optional(),
  config: reservationConfigSchema.optional(),
  range: dateRangeSchema.optional(),
  pickupLocationId: idSchema.optional(),
  returnLocationId: idSchema.optional(),
  /** Multi-select non-insurance add-on ids. */
  extras: z.array(idSchema),
  /** Single-choice insurance tier (ADR-003 I-A). */
  insuranceTier: insuranceTierSchema.optional(),
  driver: driverSchema.optional(),
  /** Epoch ms when the draft was last written (drives the TTL). */
  savedAt: z.number().int().min(0),
});
export type ReservationDraft = z.infer<typeof reservationDraftSchema>;

/**
 * The strict submit projection — every field the confirmation needs is
 * required here. The `reserveVehicle` server action re-validates against this.
 */
export const reservationSubmitSchema = z.object({
  vehicleId: idSchema,
  config: reservationConfigSchema.optional(),
  range: dateRangeSchema,
  pickupLocationId: idSchema,
  returnLocationId: idSchema,
  extras: z.array(idSchema),
  insuranceTier: insuranceTierSchema.optional(),
  driver: driverSchema,
});
export type ReservationSubmit = z.infer<typeof reservationSubmitSchema>;

/**
 * ConfirmedReservation — the deterministic object the mocked submit returns
 * (ADR-003). `isDemo` is always true; `reference` is a stable hash of the draft
 * so screenshots are reproducible. The nested vehicle/location/quote are
 * denormalised snapshots so the confirmation + `.ics` render without re-fetch.
 */
export const confirmedReservationSchema = z.object({
  reference: z.string().trim().min(1).max(32),
  vehicleName: z.string().trim().min(1).max(80),
  config: reservationConfigSchema.optional(),
  /** Display names for the carried config (for the confirmation + `.ics`). */
  colorName: z.string().trim().max(48).optional(),
  wheelName: z.string().trim().max(48).optional(),
  range: dateRangeSchema,
  rentalDays: z.number().int().min(1),
  pickupName: z.string().trim().min(1).max(80),
  pickupAddress: z.string().trim().min(1).max(160),
  returnName: z.string().trim().min(1).max(80),
  extras: z.array(z.string().trim().min(1).max(80)),
  insuranceTier: insuranceTierSchema.optional(),
  quote: priceQuoteSchema,
  currency: currencySchema,
  isDemo: z.literal(true),
});
export type ConfirmedReservation = z.infer<typeof confirmedReservationSchema>;
