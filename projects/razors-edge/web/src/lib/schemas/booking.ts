import { z } from 'zod';

import { contactDetailsSchema } from './contact';
import {
  currencySchema,
  isoDateSchema,
  minuteOfDaySchema,
  priceMinorSchema,
} from './common';

/**
 * Wizard steps (ADR-003) — `step` discriminant of the Zustand machine.
 */
export const bookingStepSchema = z.enum([
  'service',
  'barber',
  'date-time',
  'details',
  'confirmation',
]);
export type BookingStep = z.infer<typeof bookingStepSchema>;

/**
 * BookingDraft — the Zustand store shape AND the persisted-shape guard
 * (ADR-003). All selection fields are optional because the draft is built
 * up across steps. `savedAt` stamps the persist write for the 24h TTL.
 *
 * The submit projection (below) is the validated subset sent to the mocked
 * server action.
 */
export const bookingDraftSchema = z.object({
  step: bookingStepSchema,
  serviceId: z.string().min(1).optional(),
  barberId: z.string().min(1).optional(),
  /** "Any available barber" sentinel — resolved at selection time. */
  anyBarber: z.boolean().optional(),
  date: isoDateSchema.optional(),
  startMin: minuteOfDaySchema.optional(),
  contact: contactDetailsSchema.optional(),
  /** Epoch ms of the last persist write (TTL reconciliation). */
  savedAt: z.number().int().optional(),
});
export type BookingDraft = z.infer<typeof bookingDraftSchema>;

/**
 * The validated submit payload — the projection of a complete draft the
 * mocked `bookAppointment` server action re-validates with this schema
 * (the shared-contract guarantee of docs/conventions.md § 5).
 */
export const bookingSubmissionSchema = z.object({
  serviceId: z.string().min(1),
  barberId: z.string().min(1),
  date: isoDateSchema,
  startMin: minuteOfDaySchema,
  contact: contactDetailsSchema,
});
export type BookingSubmission = z.infer<typeof bookingSubmissionSchema>;

/**
 * ConfirmedBooking — the deterministic mocked submit return (ADR-003).
 * `reference` is derived from the submission (stable for screenshots);
 * `isDemo` is always true and the confirmation copy says so gracefully.
 */
export const confirmedBookingSchema = z.object({
  reference: z
    .string()
    .regex(/^RE-[A-Z0-9]{6}$/, 'reference like RE-XXXXXX'),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  barberId: z.string().min(1),
  barberName: z.string().min(1),
  date: isoDateSchema,
  startMin: minuteOfDaySchema,
  durationMin: z.number().int().positive(),
  priceMinor: priceMinorSchema,
  currency: currencySchema,
  contact: contactDetailsSchema,
  isDemo: z.literal(true),
});
export type ConfirmedBooking = z.infer<typeof confirmedBookingSchema>;
