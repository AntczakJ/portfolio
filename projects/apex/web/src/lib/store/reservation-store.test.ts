import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReservationDraft } from '@/lib/schemas/reservation-draft';

import { useReservationStore } from './reservation-store';

/**
 * Phase 7 (Task 7.1) — the persistence / rehydrate / reconciliation path that
 * the pure `wizard-machine.test.ts` cannot reach (it lives in the Zustand store
 * `merge` + `onRehydrateStorage`). THE NAMED GAP (AGENT_NOTES, ADR-003): the
 * forced-stale date-range reconciliation MUST be exercised here or it rots.
 *
 * We drive the real store's persist middleware by seeding `localStorage` and
 * calling `persist.rehydrate()`. The frozen clock is now = 2026-06-15 with a
 * 60-day window; the configurable hero `veh-lumen-gt` has a real seeded booking
 * [2026-06-21, 2026-06-26), so a draft range crossing it is FORCED stale.
 *
 * jsdom provides `localStorage`; no `Date.now()` is mocked, but the TTL window
 * is 24h and the savedAt we write is `Date.now()` (fresh), so non-expiry cases
 * stay non-expired deterministically.
 */

const PERSIST_KEY = 'apex:reservation-draft';

/** Write a persisted draft envelope (zustand persist v1 shape) to localStorage. */
function seedPersisted(draft: ReservationDraft): void {
  localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state: draft, version: 1 }),
  );
}

function freshDraft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    step: 'extras',
    vehicleId: 'veh-lumen-gt',
    config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
    range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' }, // clean, available
    pickupLocationId: 'loc-lis-city',
    returnLocationId: 'loc-lis-airport',
    extras: ['ext-gps'],
    savedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  // Reset the in-memory store so one test's rehydrate does not bleed into the
  // next assertion.
  useReservationStore.setState({
    step: 'vehicle',
    extras: [],
    savedAt: 0,
    hydrated: false,
    notice: null,
    confirmation: null,
    vehicleId: undefined,
    config: undefined,
    range: undefined,
    pickupLocationId: undefined,
    returnLocationId: undefined,
    insuranceTier: undefined,
    driver: undefined,
  });
});

describe('reservation-store rehydrate — clean draft', () => {
  it('restores a fresh, available draft intact and sets hydrated, no notice', async () => {
    seedPersisted(freshDraft());
    await useReservationStore.persist.rehydrate();
    const s = useReservationStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.notice).toBeNull();
    expect(s.vehicleId).toBe('veh-lumen-gt');
    expect(s.range).toEqual({ fromISODate: '2026-06-27', toISODate: '2026-06-30' });
    expect(s.config).toEqual({ colorId: 'col-voltaic', wheelId: 'whl-forged' });
  });
});

describe('reservation-store rehydrate — FORCED-STALE range reconciliation (the named gap)', () => {
  it('drops a range that now overlaps a booking, keeps vehicle + config, returns to dates, flags the notice', async () => {
    seedPersisted(
      freshDraft({
        step: 'driver',
        // [2026-06-22, 2026-06-25) overlaps the seeded hero booking
        // [2026-06-21, 2026-06-26) → no longer available.
        range: { fromISODate: '2026-06-22', toISODate: '2026-06-25' },
      }),
    );
    await useReservationStore.persist.rehydrate();
    const s = useReservationStore.getState();

    expect(s.notice).toBe('range-unavailable');
    expect(s.step).toBe('dates-locations'); // dropped back to choose a new range
    expect(s.range).toBeUndefined(); // the stale range is cleared
    // The rest of the draft is preserved.
    expect(s.vehicleId).toBe('veh-lumen-gt');
    expect(s.config).toEqual({ colorId: 'col-voltaic', wheelId: 'whl-forged' });
    expect(s.pickupLocationId).toBe('loc-lis-city');
    expect(s.extras).toEqual(['ext-gps']);
    expect(s.hydrated).toBe(true);
  });

  it('dismissNotice clears the surfaced reconciliation notice', async () => {
    seedPersisted(
      freshDraft({ range: { fromISODate: '2026-06-22', toISODate: '2026-06-25' } }),
    );
    await useReservationStore.persist.rehydrate();
    expect(useReservationStore.getState().notice).toBe('range-unavailable');
    useReservationStore.getState().dismissNotice();
    expect(useReservationStore.getState().notice).toBeNull();
  });
});

describe('reservation-store rehydrate — TTL expiry', () => {
  it('discards a draft older than the 24h TTL and flags expired', async () => {
    const stale = freshDraft({ savedAt: Date.now() - 25 * 60 * 60 * 1000 });
    seedPersisted(stale);
    await useReservationStore.persist.rehydrate();
    const s = useReservationStore.getState();
    expect(s.notice).toBe('expired');
    // The expired draft's fields are NOT adopted (current/empty kept).
    expect(s.vehicleId).toBeUndefined();
    expect(s.range).toBeUndefined();
    expect(s.hydrated).toBe(true);
  });
});

describe('reservation-store rehydrate — step clamping (P1-4)', () => {
  it('clamps a persisted step that the draft has not earned back to the earliest incomplete', async () => {
    // A draft with only a vehicle but a persisted step of `driver` must open on
    // dates-locations, not driver.
    seedPersisted({
      step: 'driver',
      vehicleId: 'veh-lumen-gt',
      extras: [],
      savedAt: Date.now(),
    });
    await useReservationStore.persist.rehydrate();
    expect(useReservationStore.getState().step).toBe('dates-locations');
  });

  it('never restores the confirmation step as the opening step', async () => {
    seedPersisted(freshDraft({ step: 'confirmation' }));
    await useReservationStore.persist.rehydrate();
    expect(useReservationStore.getState().step).not.toBe('confirmation');
  });
});

describe('reservation-store rehydrate — corrupt / malformed payloads', () => {
  it('ignores a structurally invalid persisted draft (keeps the empty current state)', async () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { step: 'not-a-real-step', extras: 'nope' }, version: 1 }),
    );
    await useReservationStore.persist.rehydrate();
    const s = useReservationStore.getState();
    expect(s.vehicleId).toBeUndefined();
    expect(s.hydrated).toBe(true); // hydration still completes (no crash)
  });
});

describe('reservation-store actions — selectVehicle on a vehicle change', () => {
  it('switches the vehicle and CLEARS the now-stale range + config', () => {
    useReservationStore.setState({
      vehicleId: 'veh-lumen-gt',
      config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
      range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
      extras: ['ext-gps'],
    });
    useReservationStore.getState().selectVehicle('veh-vella-sedan');
    const s = useReservationStore.getState();
    expect(s.vehicleId).toBe('veh-vella-sedan');
    expect(s.extras).toEqual(['ext-gps']); // extras are vehicle-independent, kept
    // Changing the vehicle invalidates a range chosen for the old one
    // (availability is per-vehicle) and the carried config. The clear now
    // actually clears: the fix assigns `undefined` explicitly rather than
    // `delete`-ing the key (a no-op under zustand v5's shallow `set` merge).
    expect(s.range).toBeUndefined();
    expect(s.config).toBeUndefined();
  });

  it('setRange(undefined) / setInsuranceTier(undefined) actually clear the key', () => {
    useReservationStore.setState({
      range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
      insuranceTier: 'plus',
    });
    useReservationStore.getState().setRange(undefined);
    useReservationStore.getState().setInsuranceTier(undefined);
    const s = useReservationStore.getState();
    // The clear now actually clears: `undefined` is assigned explicitly so
    // zustand's shallow merge removes the value (the `delete`-then-return form
    // was a no-op under the shallow `set` merge).
    expect(s.range).toBeUndefined();
    expect(s.insuranceTier).toBeUndefined();
  });

  it('keeps range + config when the SAME vehicle is reselected', () => {
    useReservationStore.setState({
      vehicleId: 'veh-lumen-gt',
      config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
      range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
    });
    useReservationStore.getState().selectVehicle('veh-lumen-gt');
    const s = useReservationStore.getState();
    expect(s.range).toEqual({ fromISODate: '2026-06-27', toISODate: '2026-06-30' });
    expect(s.config).toEqual({ colorId: 'col-voltaic', wheelId: 'whl-forged' });
  });
});
