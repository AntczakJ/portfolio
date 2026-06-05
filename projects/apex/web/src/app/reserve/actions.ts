'use server';

import { getRangeAvailability } from '@/lib/availability';
import { diffDays } from '@/lib/clock';
import { reservationReference } from '@/lib/booking-reference';
import { priceQuote } from '@/lib/pricing';
import {
  confirmedReservationSchema,
  reservationSubmitSchema,
  type ConfirmedReservation,
} from '@/lib/schemas/reservation-draft';
import {
  EXTRAS,
  getBookingsForVehicle,
  getExtraById,
  getInsuranceByTier,
  getLocationById,
  getVehicleById,
  CONFIGURATOR_OPTIONS,
} from '@/mocks';

/**
 * The mocked submit surface (ADR-003 / Task 5.6): a Next.js server action.
 *
 * It re-validates the submission with the SHARED Zod schema
 * (`reservationSubmitSchema` — the same `src/lib/schemas` the form steps use,
 * the docs/conventions.md § 5 contract honoured even without a backend), waits
 * a realistic beat, re-checks the range is still available against the
 * deterministic generator (defence in depth — the wizard reconciles, but the
 * submit must not confirm a stale range), recomputes the price, and returns a
 * deterministic `ConfirmedReservation` (`reference` derived from the submission
 * so screenshots are stable; `isDemo: true`).
 *
 * Nothing persists server-side. There is no network, no DB, no PII stored — a
 * reload of the confirmation starts fresh. The confirmation UI says so.
 */

export type ReserveVehicleResult =
  | { ok: true; confirmation: ConfirmedReservation }
  | { ok: false; error: 'invalid' | 'range-unavailable' | 'unknown' };

/** A short, realistic server beat (constant → deterministic for tests). */
const SUBMIT_LATENCY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reserveVehicle(
  input: unknown,
): Promise<ReserveVehicleResult> {
  // 1. Re-validate against the shared strict schema.
  const parsed = reservationSubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const submit = parsed.data;

  // 2. Resolve the catalog rows.
  const vehicle = getVehicleById(submit.vehicleId);
  const pickup = getLocationById(submit.pickupLocationId);
  const ret = getLocationById(submit.returnLocationId);
  if (!vehicle || !pickup || !ret) return { ok: false, error: 'unknown' };

  // 3. Re-check the range is still available.
  const availability = getRangeAvailability(
    {
      vehicleId: submit.vehicleId,
      fromISODate: submit.range.fromISODate,
      toISODate: submit.range.toISODate,
    },
    getBookingsForVehicle(submit.vehicleId),
  );
  if (!availability.available) return { ok: false, error: 'range-unavailable' };

  // 4. Realistic beat.
  await delay(SUBMIT_LATENCY_MS);

  // 5. Recompute the price (server-side, from the same pure function).
  const rentalDays = diffDays(submit.range.fromISODate, submit.range.toISODate);
  const oneWay = submit.pickupLocationId !== submit.returnLocationId;
  const quote = priceQuote({
    vehicle,
    rentalDays,
    extras: submit.extras,
    ...(submit.insuranceTier !== undefined && {
      insuranceTier: submit.insuranceTier,
    }),
    oneWay,
    catalog: EXTRAS,
  });

  // 6. Denormalise display names for the confirmation + the `.ics`.
  const extraNames = submit.extras
    .map((id) => getExtraById(id)?.name)
    .filter((n): n is string => Boolean(n));

  const color = submit.config
    ? CONFIGURATOR_OPTIONS.colors.find((c) => c.id === submit.config?.colorId)
    : undefined;
  const wheel = submit.config
    ? CONFIGURATOR_OPTIONS.wheels.find((w) => w.id === submit.config?.wheelId)
    : undefined;

  // 7. Build the deterministic confirmation.
  const confirmation = confirmedReservationSchema.parse({
    reference: reservationReference(submit),
    vehicleName: vehicle.name,
    ...(submit.config !== undefined && { config: submit.config }),
    ...(color?.name !== undefined && { colorName: color.name }),
    ...(wheel?.name !== undefined && { wheelName: wheel.name }),
    range: submit.range,
    rentalDays,
    pickupName: pickup.name,
    pickupAddress: `${pickup.address}, ${pickup.city}`,
    returnName: ret.name,
    extras: extraNames,
    ...(submit.insuranceTier !== undefined && {
      insuranceTier: submit.insuranceTier,
    }),
    quote,
    currency: vehicle.currency,
    isDemo: true,
  } satisfies ConfirmedReservation);

  // Note: `getInsuranceByTier` is exported for the confirmation UI; referenced
  // here to keep the catalog the single source of truth (insurance row exists).
  if (submit.insuranceTier && !getInsuranceByTier(submit.insuranceTier)) {
    return { ok: false, error: 'unknown' };
  }

  return { ok: true, confirmation };
}
