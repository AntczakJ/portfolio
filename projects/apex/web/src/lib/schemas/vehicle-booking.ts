import '@/lib/zod-config';

import { z } from 'zod';

import { dateIsoSchema, idSchema } from './common';

/**
 * VehicleBooking — a seeded pre-booking / blackout range (ADR-003).
 *
 * A half-open calendar range `[fromISODate, toISODate)`: the car is unavailable
 * on every day from `from` (inclusive) up to but NOT including `to`. Seeded per
 * vehicle so each car has realistic gaps; deterministic from the faker seed.
 * `getRangeAvailability` composes these against a requested range with
 * half-open interval overlap (`from < booking.to && booking.from < to`).
 */
export const vehicleBookingSchema = z
  .object({
    id: idSchema,
    vehicleId: idSchema,
    fromISODate: dateIsoSchema,
    toISODate: dateIsoSchema,
    /** Why the car is out (display reason for accessible "unavailable" copy). */
    reason: z.enum(['booked', 'maintenance', 'transfer']),
  })
  .refine((b) => b.fromISODate < b.toISODate, {
    message: 'fromISODate must be strictly before toISODate',
    path: ['toISODate'],
  });

export type VehicleBooking = z.infer<typeof vehicleBookingSchema>;

export const vehicleBookingListSchema = z.array(vehicleBookingSchema);
export type VehicleBookingList = z.infer<typeof vehicleBookingListSchema>;
