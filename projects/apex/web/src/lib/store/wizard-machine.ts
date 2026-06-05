import { getRangeAvailability } from '@/lib/availability';
import { diffDays } from '@/lib/clock';
import {
  reservationSubmitSchema,
  type ReservationDraft,
  type ReservationSubmit,
  type WizardStep,
} from '@/lib/schemas/reservation-draft';
import { driverSchema } from '@/lib/schemas/driver';
import type { VehicleBooking } from '@/lib/schemas/vehicle-booking';

/**
 * Pure wizard machine (Task 5.4 / ADR-003).
 *
 * The step guards, the reachability rules, the earliest-incomplete-step
 * computation, and the draft → submit projection live here as PURE functions —
 * no React, no Zustand, no `Date.now()` / `Math.random()` (everything reads the
 * frozen clock indirectly through `getRangeAvailability`). This is the second
 * "domain logic" piece (alongside availability + pricing) the § 10 thesis says
 * tests perfectly in isolation; Phase 7 owns the exhaustive cases.
 *
 * The store (`reservation-store.ts`) is a thin imperative shell over these: it
 * holds the draft + persistence and delegates every "can I?" / "where to?"
 * decision here, so the rules have one home and one test surface.
 */

/** The five wizard steps, in order (the canonical sequence). */
export const WIZARD_STEPS: readonly WizardStep[] = [
  'vehicle',
  'dates-locations',
  'extras',
  'driver',
  'confirmation',
];

/** The four interactive (non-terminal) steps the indicator shows. */
export const WIZARD_INDICATOR_STEPS: readonly WizardStep[] = [
  'vehicle',
  'dates-locations',
  'extras',
  'driver',
];

/** The ordinal index of a step in the canonical sequence. */
export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** The step before `step` (clamped to the first). */
export function previousStep(step: WizardStep): WizardStep {
  const i = stepIndex(step);
  return WIZARD_STEPS[Math.max(0, i - 1)] ?? 'vehicle';
}

/** The step after `step` (clamped to the last). */
export function nextStep(step: WizardStep): WizardStep {
  const i = stepIndex(step);
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, i + 1)] ?? 'confirmation';
}

/**
 * Is the `vehicle` step satisfied? (A vehicle has been chosen.)
 */
export function isVehicleComplete(draft: ReservationDraft): boolean {
  return Boolean(draft.vehicleId);
}

/**
 * Is the `dates-locations` step satisfied? A valid available range AND both a
 * pickup and a return location. Availability is re-checked against the seeded
 * bookings + the frozen clock (the same pure function the picker uses), so the
 * guard never lets a stale/blacked-out range advance.
 */
export function isDatesLocationsComplete(
  draft: ReservationDraft,
  bookings: readonly VehicleBooking[],
): boolean {
  if (!draft.vehicleId || !draft.range) return false;
  if (!draft.pickupLocationId || !draft.returnLocationId) return false;
  const result = getRangeAvailability(
    {
      vehicleId: draft.vehicleId,
      fromISODate: draft.range.fromISODate,
      toISODate: draft.range.toISODate,
    },
    bookings,
  );
  return result.available;
}

/**
 * Is the `extras` step satisfied? Extras + insurance are OPTIONAL, so this is a
 * pass-through once the prior steps are complete — the step is still navigable
 * and shows the live price, it simply has no required selection.
 */
export function isExtrasComplete(
  draft: ReservationDraft,
  bookings: readonly VehicleBooking[],
): boolean {
  return isDatesLocationsComplete(draft, bookings);
}

/** Is the `driver` step satisfied? A valid driver per the shared schema. */
export function isDriverComplete(draft: ReservationDraft): boolean {
  if (!draft.driver) return false;
  return driverSchema.safeParse(draft.driver).success;
}

/**
 * Can the wizard ADVANCE from `step` (the Next button is enabled)? Each step's
 * own completion rule. The driver step does not "advance" via Next — it submits
 * — so it is excluded here (the submit path owns its gate).
 */
export function canAdvance(
  draft: ReservationDraft,
  step: WizardStep,
  bookings: readonly VehicleBooking[],
): boolean {
  switch (step) {
    case 'vehicle':
      return isVehicleComplete(draft);
    case 'dates-locations':
      return isDatesLocationsComplete(draft, bookings);
    case 'extras':
      return isExtrasComplete(draft, bookings);
    case 'driver':
    case 'confirmation':
      return false;
  }
}

/**
 * Can the user jump DIRECTLY to `target` (e.g. by clicking the step indicator)?
 * A step is reachable iff every step before it is complete — so the user can go
 * back freely but cannot skip ahead over an incomplete step.
 */
export function canReachStep(
  draft: ReservationDraft,
  target: WizardStep,
  bookings: readonly VehicleBooking[],
): boolean {
  const targetIndex = stepIndex(target);
  if (targetIndex <= 0) return true; // vehicle is always reachable
  // confirmation is reachable only via submit, never by clicking the indicator.
  if (target === 'confirmation') return false;
  for (let i = 0; i < targetIndex; i += 1) {
    const prior = WIZARD_STEPS[i];
    if (!prior) return false;
    switch (prior) {
      case 'vehicle':
        if (!isVehicleComplete(draft)) return false;
        break;
      case 'dates-locations':
        if (!isDatesLocationsComplete(draft, bookings)) return false;
        break;
      case 'extras':
        if (!isExtrasComplete(draft, bookings)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * The earliest step that is not yet complete — where a fresh / seeded draft
 * should land, and the furthest the user may have reached. Used to clamp a
 * deep-link / rehydrated `step` so the wizard never opens past an incomplete
 * stage.
 */
export function earliestIncompleteStep(
  draft: ReservationDraft,
  bookings: readonly VehicleBooking[],
): WizardStep {
  if (!isVehicleComplete(draft)) return 'vehicle';
  if (!isDatesLocationsComplete(draft, bookings)) return 'dates-locations';
  if (!isDriverComplete(draft)) {
    // extras is optional, so a complete dates step makes both extras AND driver
    // reachable; the earliest INCOMPLETE is driver (extras can never be
    // "incomplete"). But we land the user on extras first so they see it.
    return 'extras';
  }
  return 'driver';
}

/**
 * Clamp a candidate `step` (from a deep link or rehydrate) so it never exceeds
 * the furthest reachable step for the draft's completeness. `confirmation` is
 * never restored as the opening step (a reload after confirm starts fresh —
 * the store clears the draft on confirm anyway).
 */
export function clampStep(
  candidate: WizardStep,
  draft: ReservationDraft,
  bookings: readonly VehicleBooking[],
): WizardStep {
  if (candidate === 'confirmation') {
    return earliestIncompleteStep(draft, bookings);
  }
  if (canReachStep(draft, candidate, bookings)) return candidate;
  return earliestIncompleteStep(draft, bookings);
}

/**
 * Whole rental days for a draft's range (0 when absent/invalid). Accepts a
 * narrow structural slice so a shallow-selected price view (the summary rail,
 * A-20) can call it without subscribing to the whole draft.
 */
export function draftRentalDays(draft: Pick<ReservationDraft, 'range'>): number {
  if (!draft.range) return 0;
  const days = diffDays(draft.range.fromISODate, draft.range.toISODate);
  return days > 0 ? days : 0;
}

/** Does the draft have a different pickup vs return (the one-way surcharge)? */
export function draftIsOneWay(
  draft: Pick<ReservationDraft, 'pickupLocationId' | 'returnLocationId'>,
): boolean {
  return Boolean(
    draft.pickupLocationId &&
      draft.returnLocationId &&
      draft.pickupLocationId !== draft.returnLocationId,
  );
}

/**
 * Project the in-progress draft to the STRICT submit shape the `reserveVehicle`
 * server action re-validates (the shared-schema contract, § 5). Returns `null`
 * if the draft is incomplete — the caller surfaces a "something is missing"
 * message rather than calling the action with a hole.
 */
export function draftToSubmit(draft: ReservationDraft): ReservationSubmit | null {
  const candidate = {
    vehicleId: draft.vehicleId,
    ...(draft.config !== undefined && { config: draft.config }),
    range: draft.range,
    pickupLocationId: draft.pickupLocationId,
    returnLocationId: draft.returnLocationId,
    extras: draft.extras,
    ...(draft.insuranceTier !== undefined && {
      insuranceTier: draft.insuranceTier,
    }),
    driver: draft.driver,
  };
  const parsed = reservationSubmitSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
