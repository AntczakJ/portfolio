import { afterEach, describe, expect, it } from 'vitest';

import { getDisabledRanges, getRangeAvailability } from './availability';
import {
  BOOKABLE_WINDOW_DAYS,
  MAX_RENTAL_DAYS,
  MIN_RENTAL_DAYS,
  __setNowForTests,
  addDays,
  getNowDateIso,
} from './clock';
import type { VehicleBooking } from './schemas/vehicle-booking';

/**
 * Phase 7 (Task 7.1) — exhaustive edge coverage for the pure availability
 * domain, filling the gaps the Phase-3 sanity suite left:
 *   - half-open `[from, to)` overlap at every boundary (touching, containing,
 *     contained, partial-front, partial-back);
 *   - the min / max rental-length boundaries (exact-min, exact-max, off-by-one);
 *   - the window edges (last bookable `to`, first bookable `from`);
 *   - the fixed reason-enum PRECEDENCE (invalid-range > before-window >
 *     after-window > too-short > too-long > conflict);
 *   - frozen-clock determinism (an advanced clock changes the verdict);
 *   - `getDisabledRanges` window-clipping, cross-vehicle filtering, and sort.
 *
 * Deliberately NOT duplicating the Phase-3 `availability.test.ts` sanity cases.
 */

const VEH = 'veh-test';

function booking(
  fromDays: number,
  toDays: number,
  vehicleId = VEH,
): VehicleBooking {
  const base = getNowDateIso();
  return {
    id: `bk-${vehicleId}-${String(fromDays)}-${String(toDays)}`,
    vehicleId,
    fromISODate: addDays(base, fromDays),
    toISODate: addDays(base, toDays),
    reason: 'booked',
  };
}

function query(fromDays: number, toDays: number) {
  const base = getNowDateIso();
  return {
    vehicleId: VEH,
    fromISODate: addDays(base, fromDays),
    toISODate: addDays(base, toDays),
  };
}

afterEach(() => { __setNowForTests(null); });

describe('getRangeAvailability — half-open overlap geometry', () => {
  // Booking occupies [10, 15). The request is varied around it.
  const bk = [booking(10, 15)];

  it('request fully BEFORE the booking, touching its start, is available', () => {
    // [5,10) touches [10,15) at day 10 — half-open, no overlap.
    expect(getRangeAvailability(query(5, 10), bk).available).toBe(true);
  });

  it('request fully AFTER the booking, touching its end, is available', () => {
    // [15,18) touches [10,15) at day 15 — no overlap.
    expect(getRangeAvailability(query(15, 18), bk).available).toBe(true);
  });

  it('request overlapping the booking front is a conflict', () => {
    // [8,12) overlaps [10,15) on days 10,11.
    const r = getRangeAvailability(query(8, 12), bk);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('conflict');
  });

  it('request overlapping the booking back is a conflict', () => {
    // [13,18) overlaps [10,15) on days 13,14.
    expect(getRangeAvailability(query(13, 18), bk).reason).toBe('conflict');
  });

  it('request CONTAINING the booking is a conflict', () => {
    expect(getRangeAvailability(query(8, 18), bk).reason).toBe('conflict');
  });

  it('request CONTAINED by the booking is a conflict', () => {
    expect(getRangeAvailability(query(11, 13), bk).reason).toBe('conflict');
  });

  it('request crossing a single booked day (one-day booking) conflicts', () => {
    const oneDay = [booking(12, 13)]; // a single booked day, day 12
    expect(getRangeAvailability(query(11, 14), oneDay).reason).toBe('conflict');
    // but a range that ends exactly at the booked day is fine
    expect(getRangeAvailability(query(10, 12), oneDay).available).toBe(true);
    // and one that starts exactly when it frees up is fine
    expect(getRangeAvailability(query(13, 15), oneDay).available).toBe(true);
  });

  it('returns every overlapping booking in conflicts', () => {
    const many = [booking(10, 12), booking(13, 16), booking(40, 45)];
    const r = getRangeAvailability(query(9, 20), many);
    expect(r.reason).toBe('conflict');
    expect(r.conflicts).toHaveLength(2); // not the far-away [40,45)
  });
});

describe('getRangeAvailability — rental-length boundaries', () => {
  it('accepts exactly the minimum rental length', () => {
    const r = getRangeAvailability(query(1, 1 + MIN_RENTAL_DAYS), []);
    expect(r.available).toBe(true);
    expect(r.rentalDays).toBe(MIN_RENTAL_DAYS);
  });

  it('accepts exactly the maximum rental length', () => {
    // from day 1, a MAX-day rental ends well inside the 60-day window.
    const r = getRangeAvailability(query(1, 1 + MAX_RENTAL_DAYS), []);
    expect(r.available).toBe(true);
    expect(r.rentalDays).toBe(MAX_RENTAL_DAYS);
  });

  it('rejects one day OVER the maximum as too-long', () => {
    const r = getRangeAvailability(query(1, 1 + MAX_RENTAL_DAYS + 1), []);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('too-long');
  });

  it('rejects an empty range (from === to) as invalid-range', () => {
    const r = getRangeAvailability(query(3, 3), []);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('invalid-range');
    expect(r.rentalDays).toBe(0);
  });

  it('rejects an inverted range (from > to) as invalid-range', () => {
    const r = getRangeAvailability(query(6, 3), []);
    expect(r.reason).toBe('invalid-range');
  });
});

describe('getRangeAvailability — window edges', () => {
  it('accepts a pickup on the frozen "now" (first bookable day)', () => {
    expect(getRangeAvailability(query(0, 2), []).available).toBe(true);
  });

  it('accepts a return on the exact window end (exclusive bound)', () => {
    // to === now + BOOKABLE_WINDOW_DAYS is the last allowed `to`.
    const r = getRangeAvailability(
      query(BOOKABLE_WINDOW_DAYS - 1, BOOKABLE_WINDOW_DAYS),
      [],
    );
    expect(r.available).toBe(true);
  });

  it('rejects a return one day past the window as after-window', () => {
    const r = getRangeAvailability(
      query(BOOKABLE_WINDOW_DAYS - 1, BOOKABLE_WINDOW_DAYS + 1),
      [],
    );
    expect(r.reason).toBe('after-window');
  });
});

describe('getRangeAvailability — reason precedence (first failing check wins)', () => {
  it('invalid-range beats every other failure', () => {
    // from > to AND in the past AND would conflict — invalid-range reported.
    const r = getRangeAvailability(query(-1, -5), [booking(-4, -2)]);
    expect(r.reason).toBe('invalid-range');
  });

  it('before-window beats after-window / length / conflict', () => {
    // past pickup, long range, crossing a booking — before-window wins.
    const r = getRangeAvailability(query(-2, 40), [booking(5, 9)]);
    expect(r.reason).toBe('before-window');
  });

  it('after-window beats length and conflict', () => {
    // ends past the window AND is too long AND crosses a booking.
    const r = getRangeAvailability(
      query(1, BOOKABLE_WINDOW_DAYS + 5),
      [booking(3, 6)],
    );
    expect(r.reason).toBe('after-window');
  });

  it('too-short beats conflict', () => {
    // zero-length is caught earlier as invalid-range; use a sub-min that is
    // still positive only if MIN > 1. With MIN === 1 there is no sub-min
    // positive range, so a too-short range is necessarily empty → invalid.
    // Assert the documented precedence holds for the achievable case.
    // `minRentalDays` is read as a plain number so the precedence branch is a
    // genuine runtime check rather than a constant the type-checker can fold.
    const minRentalDays: number = MIN_RENTAL_DAYS;
    if (minRentalDays > 1) {
      const r = getRangeAvailability(query(3, 3 + minRentalDays - 1), [
        booking(3, 4),
      ]);
      expect(r.reason).toBe('too-short');
    } else {
      expect(minRentalDays).toBe(1);
    }
  });

  it('too-long beats conflict', () => {
    // a range longer than MAX that also crosses a booking → too-long first.
    const r = getRangeAvailability(query(1, 1 + MAX_RENTAL_DAYS + 1), [
      booking(2, 4),
    ]);
    expect(r.reason).toBe('too-long');
  });
});

describe('getRangeAvailability — frozen-clock determinism', () => {
  it('a range valid under the default clock becomes a past range when the clock advances', () => {
    const base = getNowDateIso();
    const from = addDays(base, 1);
    const to = addDays(base, 4);
    expect(
      getRangeAvailability({ vehicleId: VEH, fromISODate: from, toISODate: to }, [])
        .available,
    ).toBe(true);

    // Advance "now" past the requested pickup → it becomes a past range.
    __setNowForTests(addDays(base, 10) + 'T00:00:00.000Z');
    const after = getRangeAvailability(
      { vehicleId: VEH, fromISODate: from, toISODate: to },
      [],
    );
    expect(after.available).toBe(false);
    expect(after.reason).toBe('before-window');
  });
});

describe('getDisabledRanges', () => {
  it('drops bookings entirely outside the window', () => {
    const ranges = getDisabledRanges(VEH, [
      booking(-10, -3), // entirely in the past
      booking(BOOKABLE_WINDOW_DAYS + 1, BOOKABLE_WINDOW_DAYS + 5), // past the window
      booking(5, 8), // inside
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.fromISODate).toBe(addDays(getNowDateIso(), 5));
  });

  it('clips a booking straddling the window start to the window', () => {
    const ranges = getDisabledRanges(VEH, [booking(-3, 4)]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.fromISODate).toBe(getNowDateIso()); // clipped to "now"
    expect(ranges[0]?.toISODate).toBe(addDays(getNowDateIso(), 4));
  });

  it('clips a booking straddling the window end to the window', () => {
    const ranges = getDisabledRanges(VEH, [
      booking(BOOKABLE_WINDOW_DAYS - 2, BOOKABLE_WINDOW_DAYS + 6),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toISODate).toBe(addDays(getNowDateIso(), BOOKABLE_WINDOW_DAYS));
  });

  it('excludes other vehicles bookings', () => {
    const ranges = getDisabledRanges(VEH, [
      booking(5, 8, 'veh-other'),
      booking(10, 12, VEH),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.fromISODate).toBe(addDays(getNowDateIso(), 10));
  });

  it('sorts the disabled ranges ascending by fromISODate', () => {
    const ranges = getDisabledRanges(VEH, [
      booking(40, 44),
      booking(5, 8),
      booking(20, 23),
    ]);
    const froms = ranges.map((r) => r.fromISODate);
    expect(froms).toEqual([...froms].sort());
  });
});
