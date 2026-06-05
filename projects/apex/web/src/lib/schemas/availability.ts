import '@/lib/zod-config';

import { z } from 'zod';

import { dateIsoSchema, idSchema } from './common';
import { vehicleBookingSchema } from './vehicle-booking';

/**
 * Availability — the query + result contract for `getRangeAvailability`
 * (ADR-003). The function itself is pure and lives in `src/lib/availability.ts`
 * (Task 3.3); these schemas describe its input/output so the TanStack Query
 * layer + tests share one shape.
 *
 * A requested half-open range `[from, to)` is available iff it sits inside the
 * bookable window, has a valid rental length, and overlaps NO seeded booking
 * for the vehicle. `conflicts` is returned (not just a boolean) so the UI can
 * explain WHY a range is unavailable — accessible reasons, not silent disabling.
 */

/** A half-open calendar range `[fromISODate, toISODate)`. */
export const dateRangeSchema = z
  .object({
    fromISODate: dateIsoSchema,
    toISODate: dateIsoSchema,
  })
  .refine((r) => r.fromISODate < r.toISODate, {
    message: 'fromISODate must be strictly before toISODate',
    path: ['toISODate'],
  });
export type DateRange = z.infer<typeof dateRangeSchema>;

/** The `getRangeAvailability` input — a vehicle + a requested range. */
export const availabilityQuerySchema = z.object({
  vehicleId: idSchema,
  fromISODate: dateIsoSchema,
  toISODate: dateIsoSchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** Why a requested range failed (drives accessible, specific UI copy). */
export const availabilityReasonSchema = z.enum([
  'available',
  'before-window',
  'after-window',
  'invalid-range',
  'too-short',
  'too-long',
  'conflict',
]);
export type AvailabilityReason = z.infer<typeof availabilityReasonSchema>;

/** The `getRangeAvailability` result. */
export const availabilityResultSchema = z.object({
  available: z.boolean(),
  reason: availabilityReasonSchema,
  /** Bookings the requested range overlaps (empty when available). */
  conflicts: z.array(vehicleBookingSchema),
  /** Whole rental days `to - from` (0 when the range is invalid). */
  rentalDays: z.number().int().min(0),
});
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;

/** A single disabled range surfaced to the date-range picker. */
export const disabledRangeSchema = dateRangeSchema;
export type DisabledRange = z.infer<typeof disabledRangeSchema>;
