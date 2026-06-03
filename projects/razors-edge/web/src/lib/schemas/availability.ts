import { z } from 'zod';

import { isoDateSchema, minuteOfDaySchema } from './common';

/**
 * The reason a slot is disabled — surfaced as accessible labelling on the
 * grid (the slot is rendered DISABLED, never hidden; ADR-003).
 */
export const slotUnavailableReasonSchema = z.enum([
  'closed', // barber/studio closed that weekday
  'day-off', // barber day off
  'booked', // collides with a seeded pre-booking
  'lunch', // intersects the lunch break
  'past', // start is in the past relative to the frozen now
  'overflows-close', // block would end after closing time
]);
export type SlotUnavailableReason = z.infer<
  typeof slotUnavailableReasonSchema
>;

/**
 * A derived availability slot (ADR-003). `available: false` carries a
 * `reason`; `available: true` omits it. Discriminated so the UI can render
 * a disabled slot with an accessible reason without guessing.
 */
export const availabilitySlotSchema = z.discriminatedUnion('available', [
  z.object({
    startMin: minuteOfDaySchema,
    available: z.literal(true),
  }),
  z.object({
    startMin: minuteOfDaySchema,
    available: z.literal(false),
    reason: slotUnavailableReasonSchema,
  }),
]);
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

/** Input contract for `getAvailability` (ADR-003). */
export const availabilityQuerySchema = z.object({
  barberId: z.string().min(1),
  serviceDurationMin: z.number().int().positive(),
  date: isoDateSchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * A seeded pre-booking that carves a hole in availability (ADR-003). Not
 * user-facing; the mock layer seeds a believable set per barber.
 */
export const preBookingSchema = z.object({
  id: z.string().min(1),
  barberId: z.string().min(1),
  date: isoDateSchema,
  startMin: minuteOfDaySchema,
  durationMin: z.number().int().positive(),
});
export type PreBooking = z.infer<typeof preBookingSchema>;
