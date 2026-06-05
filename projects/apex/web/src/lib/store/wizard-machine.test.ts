import { describe, expect, it } from 'vitest';

import type { ReservationDraft } from '@/lib/schemas/reservation-draft';
import type { VehicleBooking } from '@/lib/schemas/vehicle-booking';

import {
  canAdvance,
  canReachStep,
  clampStep,
  draftIsOneWay,
  draftRentalDays,
  draftToSubmit,
  earliestIncompleteStep,
  isDatesLocationsComplete,
  isDriverComplete,
  isVehicleComplete,
  nextStep,
  previousStep,
  stepIndex,
} from './wizard-machine';

/**
 * Sanity coverage for the pure wizard machine (Task 5.4). The exhaustive suite
 * (forced-stale reconciliation fixture, submit-projection edge cases) is
 * Phase 7. The frozen `now` is 2026-06-15 with a 60-day window, so the range
 * below (2026-06-20 → 23) is comfortably inside it.
 */

const NO_BOOKINGS: VehicleBooking[] = [];

const VALID_DRIVER = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+44 20 7946 0000',
  licenceNo: 'LOVEL12345',
};

function draft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    step: 'vehicle',
    extras: [],
    savedAt: 0,
    ...overrides,
  };
}

const COMPLETE_DATES = draft({
  step: 'dates-locations',
  vehicleId: 'veh-1',
  range: { fromISODate: '2026-06-20', toISODate: '2026-06-23' },
  pickupLocationId: 'loc-a',
  returnLocationId: 'loc-b',
});

describe('step ordering', () => {
  it('orders the five steps', () => {
    expect(stepIndex('vehicle')).toBe(0);
    expect(stepIndex('confirmation')).toBe(4);
  });
  it('clamps next/previous at the ends', () => {
    expect(previousStep('vehicle')).toBe('vehicle');
    expect(nextStep('confirmation')).toBe('confirmation');
    expect(nextStep('vehicle')).toBe('dates-locations');
  });
});

describe('completion guards', () => {
  it('vehicle needs a vehicleId', () => {
    expect(isVehicleComplete(draft())).toBe(false);
    expect(isVehicleComplete(draft({ vehicleId: 'veh-1' }))).toBe(true);
  });

  it('dates-locations needs an available range + both locations', () => {
    expect(isDatesLocationsComplete(COMPLETE_DATES, NO_BOOKINGS)).toBe(true);
    const noReturn = { ...COMPLETE_DATES };
    delete noReturn.returnLocationId;
    expect(isDatesLocationsComplete(noReturn, NO_BOOKINGS)).toBe(false);
  });

  it('dates-locations rejects a range that overlaps a booking', () => {
    const conflict: VehicleBooking[] = [
      {
        id: 'b1',
        vehicleId: 'veh-1',
        fromISODate: '2026-06-21',
        toISODate: '2026-06-22',
        reason: 'booked',
      },
    ];
    expect(isDatesLocationsComplete(COMPLETE_DATES, conflict)).toBe(false);
  });

  it('driver needs a schema-valid driver', () => {
    expect(isDriverComplete(draft())).toBe(false);
    expect(isDriverComplete(draft({ driver: VALID_DRIVER }))).toBe(true);
    expect(
      isDriverComplete(draft({ driver: { ...VALID_DRIVER, email: 'nope' } })),
    ).toBe(false);
  });
});

describe('advance + reachability', () => {
  it('cannot advance the vehicle step without a vehicle', () => {
    expect(canAdvance(draft(), 'vehicle', NO_BOOKINGS)).toBe(false);
    expect(
      canAdvance(draft({ vehicleId: 'veh-1' }), 'vehicle', NO_BOOKINGS),
    ).toBe(true);
  });

  it('extras advances once dates are complete (extras optional)', () => {
    const onExtras = { ...COMPLETE_DATES, step: 'extras' as const };
    expect(canAdvance(onExtras, 'extras', NO_BOOKINGS)).toBe(true);
  });

  it('cannot reach a step over an incomplete prior step', () => {
    expect(canReachStep(draft(), 'extras', NO_BOOKINGS)).toBe(false);
    expect(canReachStep(COMPLETE_DATES, 'extras', NO_BOOKINGS)).toBe(true);
    expect(canReachStep(COMPLETE_DATES, 'confirmation', NO_BOOKINGS)).toBe(false);
  });
});

describe('clamp + earliest-incomplete', () => {
  it('earliest incomplete walks the chain', () => {
    expect(earliestIncompleteStep(draft(), NO_BOOKINGS)).toBe('vehicle');
    expect(
      earliestIncompleteStep(draft({ vehicleId: 'veh-1' }), NO_BOOKINGS),
    ).toBe('dates-locations');
    expect(earliestIncompleteStep(COMPLETE_DATES, NO_BOOKINGS)).toBe('extras');
  });

  it('clamps a too-far candidate back to the earliest incomplete', () => {
    expect(clampStep('driver', draft({ vehicleId: 'veh-1' }), NO_BOOKINGS)).toBe(
      'dates-locations',
    );
    expect(clampStep('confirmation', COMPLETE_DATES, NO_BOOKINGS)).toBe('extras');
  });
});

describe('derived helpers', () => {
  it('computes rental days from the range', () => {
    expect(draftRentalDays(COMPLETE_DATES)).toBe(3);
    expect(draftRentalDays(draft())).toBe(0);
  });

  it('detects a one-way (different pickup/return)', () => {
    expect(draftIsOneWay(COMPLETE_DATES)).toBe(true);
    expect(
      draftIsOneWay({ ...COMPLETE_DATES, returnLocationId: 'loc-a' }),
    ).toBe(false);
  });
});

describe('submit projection', () => {
  it('returns null for an incomplete draft', () => {
    expect(draftToSubmit(COMPLETE_DATES)).toBeNull();
  });

  it('projects a complete draft to the strict submit shape', () => {
    const complete = { ...COMPLETE_DATES, driver: VALID_DRIVER };
    const submit = draftToSubmit(complete);
    expect(submit).not.toBeNull();
    expect(submit?.vehicleId).toBe('veh-1');
    expect(submit?.driver.email).toBe('ada@example.com');
  });
});
