import { describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { upcomingISODates } from '@/lib/clock';
import { BARBERS, PRE_BOOKINGS, SERVICES, getServiceById } from '@/mocks';
import type { BookingDraft } from '@/lib/schemas/booking';

import {
  DRAFT_TTL_MS,
  barberPerformsService,
  canReachStep,
  clampStep,
  draftToSubmission,
  earliestIncompleteStep,
  reconcileDraft,
  resolveAnyBarber,
  seedDraftFromParams,
} from '../booking-machine';

/**
 * Unit suite for the pure wizard state machine (ADR-003 / Task 6.1).
 *
 * Covers the step guards, deep-link preselect seeding, the "any barber"
 * resolution, and the rehydrate reconciliation (TTL expiry + the
 * forced-stale held-slot path — the ADR-003 reconciliation rule that is
 * otherwise dormant under the frozen clock, so it MUST be exercised here).
 *
 * Everything reads the seeded mock catalog + frozen clock, so the fixtures
 * are derived from the same deterministic source the UI uses.
 */

/** Assert a value is defined, narrowing away `undefined` for fixtures the
 * seeded catalog/frozen window guarantees exist. Throws (failing the test)
 * rather than masking a real `undefined` with a non-null assertion. */
function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

const DATES = upcomingISODates(14);
const WED = must(DATES[0], 'DATES[0]'); // frozen today (Wed 2026-06-10)

// A barber + service known to be compatible (Marco does everything).
const MARCO = must(
  BARBERS.find((b) => b.id === 'brb-marco'),
  'brb-marco',
);
const SIGNATURE_CUT = must(getServiceById('svc-signature-cut'), 'svc-signature-cut'); // cut, 45 min
const HOT_TOWEL_SHAVE = must(getServiceById('svc-hot-towel-shave'), 'svc-hot-towel-shave'); // shave
// Jonah does cut + beard only (no shave) — used for the incompatible case.
const JONAH = must(
  BARBERS.find((b) => b.id === 'brb-jonah'),
  'brb-jonah',
);

/** Find the first available slot for a barber/service/date in the seed. */
function firstAvailableSlot(
  barberId: string,
  serviceDurationMin: number,
  date: string,
): number {
  const barber = must(
    BARBERS.find((b) => b.id === barberId),
    `barber ${barberId}`,
  );
  const slots = getAvailability({
    barber,
    serviceDurationMin,
    date,
    preBookings: PRE_BOOKINGS,
  });
  const slot = slots.find((s) => s.available);
  if (!slot) throw new Error('no available slot in fixture');
  return slot.startMin;
}

/**
 * Find a (barber, date, startMin) with a BOOKED slot for a given service —
 * the forced-stale fixture for the reconciliation path. Searches the seeded
 * pre-bookings + the frozen window so it is deterministic but not brittle to
 * any one barber/day having a gap.
 */
function findBookedFixture(serviceDurationMin: number): {
  barberId: string;
  date: string;
  startMin: number;
} {
  for (const date of DATES) {
    for (const barber of BARBERS) {
      const slots = getAvailability({
        barber,
        serviceDurationMin,
        date,
        preBookings: PRE_BOOKINGS,
      });
      const booked = slots.find(
        (s) => !s.available && s.reason === 'booked',
      );
      if (booked) {
        return { barberId: barber.id, date, startMin: booked.startMin };
      }
    }
  }
  throw new Error('no booked slot anywhere in the seed');
}

describe('barberPerformsService', () => {
  it('is true when the barber performs the service', () => {
    expect(barberPerformsService(MARCO.id, SIGNATURE_CUT.id)).toBe(true);
  });

  it('is false for an incompatible barber', () => {
    // Jonah does not do shaves.
    expect(barberPerformsService(JONAH.id, HOT_TOWEL_SHAVE.id)).toBe(false);
  });

  it('is false for unknown ids', () => {
    expect(barberPerformsService('nope', SIGNATURE_CUT.id)).toBe(false);
    expect(barberPerformsService(MARCO.id, 'nope')).toBe(false);
  });
});

describe('earliestIncompleteStep / canReachStep (guards)', () => {
  it('an empty draft is incomplete at service', () => {
    expect(earliestIncompleteStep({ step: 'service' })).toBe('service');
  });

  it('cannot reach barber without a valid service', () => {
    const draft: BookingDraft = { step: 'service' };
    expect(canReachStep(draft, 'barber')).toBe(false);
    expect(canReachStep(draft, 'service')).toBe(true);
  });

  it('cannot reach date-time without a barber', () => {
    const draft: BookingDraft = {
      step: 'barber',
      serviceId: SIGNATURE_CUT.id,
    };
    expect(earliestIncompleteStep(draft)).toBe('barber');
    expect(canReachStep(draft, 'date-time')).toBe(false);
    expect(canReachStep(draft, 'barber')).toBe(true);
  });

  it('cannot reach details without date + slot', () => {
    const draft: BookingDraft = {
      step: 'date-time',
      serviceId: SIGNATURE_CUT.id,
      barberId: MARCO.id,
    };
    expect(earliestIncompleteStep(draft)).toBe('date-time');
    expect(canReachStep(draft, 'details')).toBe(false);
  });

  it('reaches confirmation only with a valid contact', () => {
    const startMin = firstAvailableSlot(
      MARCO.id,
      SIGNATURE_CUT.durationMin,
      WED,
    );
    const base: BookingDraft = {
      step: 'details',
      serviceId: SIGNATURE_CUT.id,
      barberId: MARCO.id,
      date: WED,
      startMin,
    };
    expect(earliestIncompleteStep(base)).toBe('details');
    const withContact: BookingDraft = {
      ...base,
      contact: {
        name: 'Jan Antczak',
        email: 'jan@example.com',
        phone: '+48 600 100 200',
      },
    };
    expect(earliestIncompleteStep(withContact)).toBe('confirmation');
    expect(canReachStep(withContact, 'confirmation')).toBe(true);
  });

  it('an incompatible barber is treated as no barber', () => {
    const draft: BookingDraft = {
      step: 'date-time',
      serviceId: HOT_TOWEL_SHAVE.id,
      barberId: JONAH.id, // cannot shave
    };
    expect(earliestIncompleteStep(draft)).toBe('barber');
  });

  it('the "any barber" flag satisfies the barber guard', () => {
    const draft: BookingDraft = {
      step: 'barber',
      serviceId: SIGNATURE_CUT.id,
      anyBarber: true,
    };
    expect(earliestIncompleteStep(draft)).toBe('date-time');
  });
});

describe('clampStep', () => {
  it('clamps a too-far step back to the earliest incomplete one', () => {
    const draft: BookingDraft = { step: 'details', serviceId: undefined };
    expect(clampStep(draft)).toBe('service');
  });

  it('keeps a legitimately-reachable step', () => {
    const draft: BookingDraft = {
      step: 'barber',
      serviceId: SIGNATURE_CUT.id,
    };
    expect(clampStep(draft)).toBe('barber');
  });
});

describe('seedDraftFromParams (deep-link preselect)', () => {
  it('seeds a valid service and advances to barber', () => {
    const draft = seedDraftFromParams({ service: SIGNATURE_CUT.id });
    expect(draft.serviceId).toBe(SIGNATURE_CUT.id);
    expect(draft.step).toBe('barber');
  });

  it('seeds a valid barber and advances to date-time', () => {
    const draft = seedDraftFromParams({
      service: SIGNATURE_CUT.id,
      barber: MARCO.id,
    });
    expect(draft.serviceId).toBe(SIGNATURE_CUT.id);
    expect(draft.barberId).toBe(MARCO.id);
    expect(draft.step).toBe('date-time');
  });

  it('ignores unknown ids (does not error)', () => {
    const draft = seedDraftFromParams({ service: 'nope', barber: 'nope' });
    expect(draft.serviceId).toBeUndefined();
    expect(draft.barberId).toBeUndefined();
    expect(draft.step).toBe('service');
  });

  it('drops an incompatible seeded barber but keeps the service', () => {
    // Jonah cannot shave → barber dropped, service kept, step = barber.
    const draft = seedDraftFromParams({
      service: HOT_TOWEL_SHAVE.id,
      barber: JONAH.id,
    });
    expect(draft.serviceId).toBe(HOT_TOWEL_SHAVE.id);
    expect(draft.barberId).toBeUndefined();
    expect(draft.step).toBe('barber');
  });

  it('seeds a barber alone (no service) for the barber-card entry', () => {
    const draft = seedDraftFromParams({ barber: MARCO.id });
    expect(draft.barberId).toBe(MARCO.id);
    // No service yet → still gated at the service step.
    expect(draft.step).toBe('service');
  });
});

describe('resolveAnyBarber', () => {
  it('resolves to a concrete compatible barber with a free slot', () => {
    const id = resolveAnyBarber(SIGNATURE_CUT.id, WED);
    expect(id).toBeTruthy();
    expect(barberPerformsService(must(id, 'resolved barber id'), SIGNATURE_CUT.id)).toBe(
      true,
    );
  });

  it('returns undefined for an unknown service', () => {
    expect(resolveAnyBarber('nope', WED)).toBeUndefined();
  });
});

describe('reconcileDraft (rehydrate reconciliation)', () => {
  const NOW = 1_700_000_000_000; // arbitrary fixed "now" for TTL math

  it('restores a fresh, valid draft as-is (ok)', () => {
    const startMin = firstAvailableSlot(
      MARCO.id,
      SIGNATURE_CUT.durationMin,
      WED,
    );
    const draft: BookingDraft = {
      step: 'date-time',
      serviceId: SIGNATURE_CUT.id,
      barberId: MARCO.id,
      date: WED,
      startMin,
      savedAt: NOW - 1000,
    };
    const outcome = reconcileDraft(draft, NOW);
    expect(outcome.kind).toBe('ok');
    expect(outcome.draft.startMin).toBe(startMin);
  });

  it('discards an expired draft past the 24h TTL (expired)', () => {
    const draft: BookingDraft = {
      step: 'details',
      serviceId: SIGNATURE_CUT.id,
      barberId: MARCO.id,
      date: WED,
      startMin: firstAvailableSlot(MARCO.id, SIGNATURE_CUT.durationMin, WED),
      savedAt: NOW - DRAFT_TTL_MS - 1,
    };
    const outcome = reconcileDraft(draft, NOW);
    expect(outcome.kind).toBe('expired');
    expect(outcome.draft).toEqual({ step: 'service' });
  });

  it('releases a held slot that is no longer free (slot-taken), keeping service/barber/date', () => {
    // Force-stale: pretend the user held a slot that is actually BOOKED in
    // the seed — `getAvailability` reports it unavailable on rehydrate.
    // Every barber performs the Signature Cut, so the found barber is
    // compatible with the service we attach to the draft.
    const { barberId, date, startMin } = findBookedFixture(
      SIGNATURE_CUT.durationMin,
    );
    const draft: BookingDraft = {
      step: 'details',
      serviceId: SIGNATURE_CUT.id,
      barberId,
      date,
      startMin,
      contact: {
        name: 'Jan Antczak',
        email: 'jan@example.com',
        phone: '+48 600 100 200',
      },
      savedAt: NOW - 1000,
    };
    const outcome = reconcileDraft(draft, NOW);
    expect(outcome.kind).toBe('slot-taken');
    // Service / barber / date survive; the time is released; back to date-time.
    expect(outcome.draft.serviceId).toBe(SIGNATURE_CUT.id);
    expect(outcome.draft.barberId).toBe(barberId);
    expect(outcome.draft.date).toBe(date);
    expect(outcome.draft.startMin).toBeUndefined();
    expect(outcome.draft.step).toBe('date-time');
    // The typed contact is preserved (the user does not retype it).
    expect(outcome.draft.contact?.name).toBe('Jan Antczak');
  });

  it('does not run the stale check when no slot is held', () => {
    const draft: BookingDraft = {
      step: 'barber',
      serviceId: SIGNATURE_CUT.id,
      savedAt: NOW - 1000,
    };
    const outcome = reconcileDraft(draft, NOW);
    expect(outcome.kind).toBe('ok');
  });
});

describe('draftToSubmission', () => {
  it('projects a complete draft to the submit payload', () => {
    const startMin = firstAvailableSlot(
      MARCO.id,
      SIGNATURE_CUT.durationMin,
      WED,
    );
    const draft: BookingDraft = {
      step: 'details',
      serviceId: SIGNATURE_CUT.id,
      barberId: MARCO.id,
      date: WED,
      startMin,
      contact: {
        name: 'Jan Antczak',
        email: 'jan@example.com',
        phone: '+48 600 100 200',
      },
    };
    const submission = must(draftToSubmission(draft), 'submission');
    expect(submission.serviceId).toBe(SIGNATURE_CUT.id);
    expect(submission.barberId).toBe(MARCO.id);
    expect(submission.startMin).toBe(startMin);
  });

  it('returns null for an incomplete draft', () => {
    expect(draftToSubmission({ step: 'service' })).toBeNull();
  });
});

// Sanity: the menu + roster the machine relies on exist.
describe('fixtures', () => {
  it('has the expected catalog', () => {
    expect(SERVICES.length).toBeGreaterThan(0);
    expect(MARCO).toBeTruthy();
    expect(JONAH).toBeTruthy();
  });
});
