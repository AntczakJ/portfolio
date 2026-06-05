import { describe, expect, it } from 'vitest';

import type { ReservationDraft } from '@/lib/schemas/reservation-draft';
import type { VehicleBooking } from '@/lib/schemas/vehicle-booking';

import {
  canReachStep,
  clampStep,
  draftIsOneWay,
  draftToSubmit,
  earliestIncompleteStep,
  isExtrasComplete,
  WIZARD_INDICATOR_STEPS,
  WIZARD_STEPS,
} from './wizard-machine';

/**
 * Phase 7 (Task 7.1) — exhaustive wizard-machine edge coverage, filling the
 * gaps the Phase-5 sanity suite left:
 *   - the full step sequence + the indicator subset;
 *   - reachability at EVERY target (vehicle always reachable, confirmation never
 *     by click, each middle step gated on its priors);
 *   - clampStep across the matrix (reachable kept, too-far → earliest incomplete,
 *     confirmation → earliest incomplete);
 *   - earliestIncompleteStep with a fully-complete driver (lands on driver);
 *   - extras as a pass-through over a complete dates step;
 *   - the submit projection: optional config OMITTED cleanly, optional insurance
 *     omitted, a complete-but-conflicting range projecting (the machine projects
 *     shape; the server action re-checks availability), and the one-way flag.
 *
 * Not duplicating the Phase-5 `wizard-machine.test.ts` sanity cases.
 */

const NO_BOOKINGS: VehicleBooking[] = [];

const VALID_DRIVER = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+44 20 7946 0000',
  licenceNo: 'LOVEL12345',
};

function draft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return { step: 'vehicle', extras: [], savedAt: 0, ...overrides };
}

const DATES = draft({
  step: 'dates-locations',
  vehicleId: 'veh-1',
  range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
  pickupLocationId: 'loc-a',
  returnLocationId: 'loc-b',
});

const COMPLETE = draft({ ...DATES, step: 'driver', driver: VALID_DRIVER });

describe('step sequence constants', () => {
  it('orders the five canonical steps', () => {
    expect(WIZARD_STEPS).toEqual([
      'vehicle',
      'dates-locations',
      'extras',
      'driver',
      'confirmation',
    ]);
  });

  it('the indicator shows the four interactive steps (not confirmation)', () => {
    expect(WIZARD_INDICATOR_STEPS).toEqual([
      'vehicle',
      'dates-locations',
      'extras',
      'driver',
    ]);
  });
});

describe('canReachStep — full matrix', () => {
  it('vehicle is always reachable, even on an empty draft', () => {
    expect(canReachStep(draft(), 'vehicle', NO_BOOKINGS)).toBe(true);
  });

  it('dates-locations is reachable once a vehicle is chosen', () => {
    expect(canReachStep(draft(), 'dates-locations', NO_BOOKINGS)).toBe(false);
    expect(
      canReachStep(draft({ vehicleId: 'veh-1' }), 'dates-locations', NO_BOOKINGS),
    ).toBe(true);
  });

  it('extras + driver are reachable once dates are complete', () => {
    expect(canReachStep(DATES, 'extras', NO_BOOKINGS)).toBe(true);
    expect(canReachStep(DATES, 'driver', NO_BOOKINGS)).toBe(true);
  });

  it('driver is NOT reachable while dates are incomplete', () => {
    const noLocs = draft({ vehicleId: 'veh-1', range: DATES.range });
    expect(canReachStep(noLocs, 'driver', NO_BOOKINGS)).toBe(false);
  });

  it('confirmation is never reachable by clicking the indicator', () => {
    expect(canReachStep(COMPLETE, 'confirmation', NO_BOOKINGS)).toBe(false);
  });
});

describe('clampStep — matrix', () => {
  it('keeps a reachable candidate', () => {
    expect(clampStep('dates-locations', draft({ vehicleId: 'veh-1' }), NO_BOOKINGS)).toBe(
      'dates-locations',
    );
    expect(clampStep('extras', DATES, NO_BOOKINGS)).toBe('extras');
  });

  it('clamps a too-far candidate to the earliest incomplete step', () => {
    expect(clampStep('driver', draft({ vehicleId: 'veh-1' }), NO_BOOKINGS)).toBe(
      'dates-locations',
    );
    expect(clampStep('extras', draft(), NO_BOOKINGS)).toBe('vehicle');
  });

  it('never opens directly on confirmation — maps to earliest incomplete', () => {
    expect(clampStep('confirmation', draft(), NO_BOOKINGS)).toBe('vehicle');
    expect(clampStep('confirmation', DATES, NO_BOOKINGS)).toBe('extras');
    // even a fully complete draft does not OPEN on confirmation
    expect(clampStep('confirmation', COMPLETE, NO_BOOKINGS)).toBe('driver');
  });
});

describe('earliestIncompleteStep — walks the chain to driver', () => {
  it('lands on driver when everything up to (and including) dates is complete', () => {
    expect(earliestIncompleteStep(DATES, NO_BOOKINGS)).toBe('extras');
  });

  it('lands on driver when the driver is also valid (the furthest stage)', () => {
    expect(earliestIncompleteStep(COMPLETE, NO_BOOKINGS)).toBe('driver');
  });
});

describe('isExtrasComplete — pass-through over a complete dates step', () => {
  it('is true with no extras chosen (extras are optional)', () => {
    expect(isExtrasComplete(DATES, NO_BOOKINGS)).toBe(true);
  });

  it('is false when the underlying dates step is incomplete', () => {
    expect(isExtrasComplete(draft({ vehicleId: 'veh-1' }), NO_BOOKINGS)).toBe(false);
  });
});

describe('draftToSubmit — projection edge cases', () => {
  it('omits config cleanly when the draft has none', () => {
    const noConfig = { ...COMPLETE };
    delete noConfig.config;
    const submit = draftToSubmit(noConfig);
    expect(submit).not.toBeNull();
    expect(submit && 'config' in submit ? submit.config : undefined).toBeUndefined();
  });

  it('carries config through when present', () => {
    const withConfig = { ...COMPLETE, config: { colorId: 'col-voltaic', wheelId: 'whl-forged' } };
    expect(draftToSubmit(withConfig)?.config).toEqual({
      colorId: 'col-voltaic',
      wheelId: 'whl-forged',
    });
  });

  it('omits insurance tier cleanly when none is chosen', () => {
    const submit = draftToSubmit(COMPLETE);
    expect(submit?.insuranceTier).toBeUndefined();
  });

  it('returns null if the driver is missing or invalid', () => {
    const noDriver = { ...DATES, step: 'driver' as const };
    expect(draftToSubmit(noDriver)).toBeNull();
    expect(
      draftToSubmit({ ...COMPLETE, driver: { ...VALID_DRIVER, email: 'bad' } }),
    ).toBeNull();
  });

  it('projects the strict submit shape with all required fields populated', () => {
    const submit = draftToSubmit(COMPLETE);
    expect(submit).toMatchObject({
      vehicleId: 'veh-1',
      range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
      pickupLocationId: 'loc-a',
      returnLocationId: 'loc-b',
      extras: [],
      driver: { email: 'ada@example.com' },
    });
  });
});

describe('draftIsOneWay', () => {
  it('false when pickup === return', () => {
    expect(draftIsOneWay({ pickupLocationId: 'loc-a', returnLocationId: 'loc-a' })).toBe(false);
  });
  it('false when either is missing', () => {
    expect(draftIsOneWay({ pickupLocationId: 'loc-a' })).toBe(false);
    expect(draftIsOneWay({ returnLocationId: 'loc-b' })).toBe(false);
  });
  it('true when pickup !== return', () => {
    expect(draftIsOneWay({ pickupLocationId: 'loc-a', returnLocationId: 'loc-b' })).toBe(true);
  });
});
