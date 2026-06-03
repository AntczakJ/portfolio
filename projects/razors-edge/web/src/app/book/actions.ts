'use server';

import { getAvailability } from '@/lib/availability';
import { bookingReference } from '@/lib/booking-reference';
import {
  bookingSubmissionSchema,
  confirmedBookingSchema,
  type ConfirmedBooking,
} from '@/lib/schemas/booking';
import { getBarberById, getServiceById, PRE_BOOKINGS } from '@/mocks';

/**
 * The mocked submit surface (ADR-003): a Next.js server action.
 *
 * It re-validates the submission with the SHARED Zod schema (the same
 * `src/lib/schemas/booking` the form steps use — the
 * docs/conventions.md § 5 contract, honoured even without a backend),
 * waits a realistic beat, re-checks the slot is still free against the
 * deterministic availability generator, and returns a deterministic
 * `ConfirmedBooking` (`reference` derived from the submission so
 * screenshots are stable; `isDemo: true`).
 *
 * Nothing persists server-side. There is no network, no DB, no PII stored
 * — a reload of the confirmation starts a fresh booking. The honesty copy
 * in the confirmation UI says so.
 */

export type BookAppointmentResult =
  | { ok: true; confirmation: ConfirmedBooking }
  | { ok: false; error: 'invalid' | 'slot-taken' | 'unknown' };

/** A short, realistic server beat (constant → deterministic for tests). */
const SUBMIT_LATENCY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bookAppointment(
  input: unknown,
): Promise<BookAppointmentResult> {
  // 1. Re-validate against the shared schema.
  const parsed = bookingSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid' };
  }
  const submission = parsed.data;

  // 2. Resolve the catalog rows.
  const service = getServiceById(submission.serviceId);
  const barber = getBarberById(submission.barberId);
  if (!service || !barber) {
    return { ok: false, error: 'unknown' };
  }

  // 3. Re-check the slot is still free (defence in depth — the wizard
  //    already reconciles, but the submit must not confirm a stale slot).
  const slots = getAvailability({
    barber,
    serviceDurationMin: service.durationMin,
    date: submission.date,
    preBookings: PRE_BOOKINGS,
  });
  const held = slots.find((s) => s.startMin === submission.startMin);
  if (held?.available !== true) {
    return { ok: false, error: 'slot-taken' };
  }

  // 4. Realistic beat.
  await delay(SUBMIT_LATENCY_MS);

  // 5. Build the deterministic confirmation.
  const confirmation = confirmedBookingSchema.parse({
    reference: bookingReference(submission),
    serviceId: service.id,
    serviceName: service.name,
    barberId: barber.id,
    barberName: barber.name,
    date: submission.date,
    startMin: submission.startMin,
    durationMin: service.durationMin,
    priceMinor: service.priceMinor,
    currency: service.currency,
    contact: submission.contact,
    isDemo: true,
  } satisfies ConfirmedBooking);

  return { ok: true, confirmation };
}
