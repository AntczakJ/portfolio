import { getAvailability } from '@/lib/availability';
import { BARBERS, getBarberById, getServiceById, PRE_BOOKINGS } from '@/mocks';
import type { BookingDraft, BookingStep } from '@/lib/schemas/booking';

/**
 * Pure wizard state-machine logic (ADR-003), separated from the Zustand
 * store + React so it can be unit-tested in isolation (Phase 6 / Task 6.1):
 * the step guards, the deep-link seeding, and the rehydrate reconciliation.
 *
 * The store (`booking-store.ts`) is a thin shell over these functions — all
 * the rules live here, with NO React, NO browser, NO randomness.
 */

/** Canonical step order — the wizard advances and rewinds along this. */
export const STEP_ORDER: readonly BookingStep[] = [
  'service',
  'barber',
  'date-time',
  'details',
  'confirmation',
];

export function stepIndex(step: BookingStep): number {
  return STEP_ORDER.indexOf(step);
}

/**
 * Is a barber compatible with the chosen service? A barber performs a
 * service iff the service id is in the barber's `serviceIds` (which is
 * derived from `specialties` in the mock). Unknown ids → false.
 */
export function barberPerformsService(
  barberId: string,
  serviceId: string,
): boolean {
  const barber = getBarberById(barberId);
  const service = getServiceById(serviceId);
  if (!barber || !service) return false;
  return barber.serviceIds.includes(serviceId);
}

/**
 * The earliest step a draft is NOT yet complete enough to be past. Used by
 * the step guards: you cannot legitimately sit on a step later than this.
 *
 *  - no valid service                 → 'service'
 *  - no valid barber (or "any")       → 'barber'
 *  - no date + startMin               → 'date-time'
 *  - no valid contact                 → 'details'
 *  - otherwise                        → 'confirmation'
 */
export function earliestIncompleteStep(draft: BookingDraft): BookingStep {
  const service = draft.serviceId
    ? getServiceById(draft.serviceId)
    : undefined;
  if (!service) return 'service';

  const hasBarber =
    draft.anyBarber === true ||
    (typeof draft.barberId === 'string' &&
      getBarberById(draft.barberId) !== undefined &&
      barberPerformsService(draft.barberId, service.id));
  if (!hasBarber) return 'barber';

  if (typeof draft.date !== 'string' || typeof draft.startMin !== 'number') {
    return 'date-time';
  }

  const contact = draft.contact;
  const hasContact =
    !!contact &&
    contact.name.trim().length >= 2 &&
    contact.email.trim().length > 0 &&
    contact.phone.trim().length >= 6;
  if (!hasContact) return 'details';

  return 'confirmation';
}

/**
 * Can the wizard legitimately show `target`, given the draft? A step is
 * reachable iff it is at or before the earliest-incomplete step (you may
 * always go BACK to a completed step, never SKIP forward past an
 * incomplete one). The confirmation step is reachable only once everything
 * before it is complete.
 */
export function canReachStep(
  draft: BookingDraft,
  target: BookingStep,
): boolean {
  return stepIndex(target) <= stepIndex(earliestIncompleteStep(draft));
}

/**
 * Clamp a requested `step` to the furthest legitimately-reachable step.
 * Deep-linking to a later step with an incomplete draft lands the user on
 * the earliest incomplete step instead of a broken later one.
 */
export function clampStep(draft: BookingDraft): BookingStep {
  const requested = draft.step;
  const furthest = earliestIncompleteStep(draft);
  return stepIndex(requested) <= stepIndex(furthest) ? requested : furthest;
}

export interface SeedParams {
  service?: string | undefined;
  barber?: string | undefined;
}

/**
 * Build the initial draft from deep-link params (ADR-003 deep-link
 * seeding). Validates ids against the mock catalog; unknown params are
 * IGNORED (not errored). If the seeded barber does not perform the seeded
 * service, the barber is dropped (the service wins — reconcile, do not
 * error). The step is advanced past whatever is satisfied.
 */
export function seedDraftFromParams(params: SeedParams): BookingDraft {
  const draft: BookingDraft = { step: 'service' };

  const service = params.service ? getServiceById(params.service) : undefined;
  if (service) {
    draft.serviceId = service.id;
  }

  const barber = params.barber ? getBarberById(params.barber) : undefined;
  if (barber) {
    // Only keep the seeded barber if compatible with the seeded service
    // (or if no service was seeded — then the barber is provisional and
    // the service step still gates forward progress).
    if (!service || barber.serviceIds.includes(service.id)) {
      draft.barberId = barber.id;
    }
  }

  // Advance to the earliest step still incomplete after seeding.
  draft.step = earliestIncompleteStep(draft);
  return draft;
}

/**
 * Resolve the "Any available barber" sentinel to a concrete barber for a
 * given service + date (ADR-003: resolved at selection time). Deterministic:
 * returns the FIRST barber in roster order who (a) performs the service and
 * (b) has at least one available slot on that date. Returns `undefined` if
 * nobody is free that day.
 */
export function resolveAnyBarber(
  serviceId: string,
  date: string,
): string | undefined {
  const service = getServiceById(serviceId);
  if (!service) return undefined;
  for (const barber of BARBERS) {
    if (!barber.serviceIds.includes(serviceId)) continue;
    const slots = getAvailability({
      barber,
      serviceDurationMin: service.durationMin,
      date,
      preBookings: PRE_BOOKINGS,
    });
    if (slots.some((s) => s.available)) return barber.id;
  }
  return undefined;
}

export type ReconcileOutcome =
  | { kind: 'ok'; draft: BookingDraft }
  | { kind: 'expired'; draft: BookingDraft }
  | { kind: 'slot-taken'; draft: BookingDraft };

/** TTL for a persisted draft (ADR-003): 24 hours. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reconcile a rehydrated draft (ADR-003 — the refresh-reconciliation rule).
 *
 *  1. TTL: if `now − savedAt > 24h`, the draft is stale → discard entirely,
 *     start clean (`expired`).
 *  2. Stale slot: if the draft holds a `date` + `startMin`, re-run
 *     `getAvailability` for `(barber, serviceDuration, date)` and re-check
 *     the held slot. If it is no longer free, KEEP service/barber/date,
 *     CLEAR `startMin`, drop to the `date-time` step, and signal
 *     `slot-taken` so the UI can show a calm notice. Service/barber/date
 *     survive; only the held time is released.
 *  3. Otherwise the draft restores as-is, clamped to a reachable step.
 *
 * `nowMs` is injected (the frozen clock in prod, a forced value in tests)
 * so the TTL + stale paths are deterministically testable.
 */
export function reconcileDraft(
  draft: BookingDraft,
  nowMs: number,
): ReconcileOutcome {
  // 1. TTL expiry.
  if (typeof draft.savedAt === 'number' && nowMs - draft.savedAt > DRAFT_TTL_MS) {
    return { kind: 'expired', draft: { step: 'service' } };
  }

  // 2. Stale-slot check — only relevant if a slot is actually held.
  if (
    typeof draft.serviceId === 'string' &&
    typeof draft.barberId === 'string' &&
    typeof draft.date === 'string' &&
    typeof draft.startMin === 'number'
  ) {
    const barber = getBarberById(draft.barberId);
    const service = getServiceById(draft.serviceId);
    if (barber && service) {
      const slots = getAvailability({
        barber,
        serviceDurationMin: service.durationMin,
        date: draft.date,
        preBookings: PRE_BOOKINGS,
      });
      const held = slots.find((s) => s.startMin === draft.startMin);
      const stillFree = held?.available === true;
      if (!stillFree) {
        // Keep service/barber/date, release the time, return to date-time.
        const next: BookingDraft = {
          step: 'date-time',
          serviceId: draft.serviceId,
          barberId: draft.barberId,
          date: draft.date,
          ...(draft.anyBarber !== undefined
            ? { anyBarber: draft.anyBarber }
            : {}),
          ...(draft.contact ? { contact: draft.contact } : {}),
        };
        return { kind: 'slot-taken', draft: next };
      }
    }
  }

  // 3. Restore as-is, clamped to a reachable step.
  return { kind: 'ok', draft: { ...draft, step: clampStep(draft) } };
}

/**
 * Project a complete draft to the validated submit payload shape. Returns
 * `null` if the draft is not complete enough to submit (the caller treats
 * that as "not ready"). Resolves the "any available barber" sentinel to a
 * concrete barber id is the store's job BEFORE submit; here we require a
 * concrete `barberId`.
 */
export function draftToSubmission(draft: BookingDraft): {
  serviceId: string;
  barberId: string;
  date: string;
  startMin: number;
  contact: NonNullable<BookingDraft['contact']>;
} | null {
  if (
    typeof draft.serviceId !== 'string' ||
    typeof draft.barberId !== 'string' ||
    typeof draft.date !== 'string' ||
    typeof draft.startMin !== 'number' ||
    !draft.contact
  ) {
    return null;
  }
  return {
    serviceId: draft.serviceId,
    barberId: draft.barberId,
    date: draft.date,
    startMin: draft.startMin,
    contact: draft.contact,
  };
}
