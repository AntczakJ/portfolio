import { afterEach, describe, expect, it } from 'vitest';

import { getDisabledRanges, getRangeAvailability } from './availability';
import { __setNowForTests, addDays, getNowDateIso } from './clock';
import type { VehicleBooking } from './schemas/vehicle-booking';

/**
 * Sanity coverage for the pure availability logic (Task 3.3). The full suite
 * (overlap edge cases, frozen-`now` determinism, forced-stale reconciliation
 * fixture) is Phase 7; this is the authoring-time smoke.
 */

const VEH = 'veh-test';

function booking(fromDays: number, toDays: number): VehicleBooking {
  const base = getNowDateIso();
  return {
    id: `bk-${String(fromDays)}-${String(toDays)}`,
    vehicleId: VEH,
    fromISODate: addDays(base, fromDays),
    toISODate: addDays(base, toDays),
    reason: 'booked',
  };
}

afterEach(() => { __setNowForTests(null); });

describe('getRangeAvailability', () => {
  it('accepts a clean range inside the window', () => {
    const now = getNowDateIso();
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, 1), toISODate: addDays(now, 4) },
      [],
    );
    expect(res.available).toBe(true);
    expect(res.reason).toBe('available');
    expect(res.rentalDays).toBe(3);
  });

  it('rejects a past pickup', () => {
    const now = getNowDateIso();
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, -2), toISODate: addDays(now, 2) },
      [],
    );
    expect(res.available).toBe(false);
    expect(res.reason).toBe('before-window');
  });

  it('rejects a range beyond the 60-day window', () => {
    const now = getNowDateIso();
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, 58), toISODate: addDays(now, 65) },
      [],
    );
    expect(res.available).toBe(false);
    expect(res.reason).toBe('after-window');
  });

  it('detects a booking conflict and returns the conflict', () => {
    const now = getNowDateIso();
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, 3), toISODate: addDays(now, 6) },
      [booking(5, 9)],
    );
    expect(res.available).toBe(false);
    expect(res.reason).toBe('conflict');
    expect(res.conflicts).toHaveLength(1);
  });

  it('treats touching endpoints as non-overlapping', () => {
    const now = getNowDateIso();
    // Request [3,5), booking [5,8) — they touch at day 5, no overlap.
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, 3), toISODate: addDays(now, 5) },
      [booking(5, 8)],
    );
    expect(res.available).toBe(true);
  });

  it('ignores another vehicle bookings', () => {
    const now = getNowDateIso();
    const other: VehicleBooking = { ...booking(3, 6), vehicleId: 'veh-other' };
    const res = getRangeAvailability(
      { vehicleId: VEH, fromISODate: addDays(now, 3), toISODate: addDays(now, 6) },
      [other],
    );
    expect(res.available).toBe(true);
  });
});

describe('getDisabledRanges', () => {
  it('clips ranges to the bookable window and sorts them', () => {
    const ranges = getDisabledRanges(VEH, [booking(10, 14), booking(2, 5)]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]?.fromISODate.localeCompare(ranges[1]?.fromISODate ?? '')).toBeLessThan(0);
  });
});
