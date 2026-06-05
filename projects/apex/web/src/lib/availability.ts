import {
  BOOKABLE_WINDOW_DAYS,
  MAX_RENTAL_DAYS,
  MIN_RENTAL_DAYS,
  addDays,
  diffDays,
  getNowDateIso,
} from './clock';
import type {
  AvailabilityQuery,
  AvailabilityResult,
  DisabledRange,
} from './schemas/availability';
import type { VehicleBooking } from './schemas/vehicle-booking';

/**
 * Pure deterministic availability (Task 3.3 / ADR-003).
 *
 * No React, no `Date.now()` / `Math.random()` — everything reads the frozen
 * clock (`src/lib/clock.ts`). Unit-tested in isolation (Phase 7).
 *
 * Ranges are HALF-OPEN calendar ranges `[fromISODate, toISODate)`: the rental
 * spans every day from `from` (inclusive) to `to` (exclusive), so `to - from`
 * whole days is the rental-day count. Two half-open ranges overlap iff
 * `aFrom < bTo && bFrom < aTo` — touching endpoints do NOT overlap (a car
 * returned on day X can be picked up again on day X).
 */

/** Do two half-open `[from, to)` calendar ranges overlap? */
function rangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * `getRangeAvailability` — is the requested half-open range bookable for the
 * vehicle? Pure over the seeded bookings + the frozen clock.
 *
 * A range is available iff ALL hold:
 *   - `from < to` (a valid, non-empty range);
 *   - the rental length is within `[MIN_RENTAL_DAYS, MAX_RENTAL_DAYS]`;
 *   - `from >= now` (no past pickups);
 *   - `to <= now + BOOKABLE_WINDOW_DAYS` (inside the bookable window);
 *   - the range overlaps NONE of the vehicle's seeded bookings.
 *
 * `conflicts` is always returned (the overlapping bookings, possibly empty) so
 * the UI can explain WHY a range is unavailable (accessible, not silent).
 * Checks run in a fixed precedence and the FIRST failing check sets `reason`.
 */
export function getRangeAvailability(
  query: AvailabilityQuery,
  bookings: readonly VehicleBooking[],
): AvailabilityResult {
  const { vehicleId, fromISODate, toISODate } = query;

  const nowDate = getNowDateIso();
  const windowEnd = addDays(nowDate, BOOKABLE_WINDOW_DAYS);

  // Invalid / empty range.
  if (fromISODate >= toISODate) {
    return {
      available: false,
      reason: 'invalid-range',
      conflicts: [],
      rentalDays: 0,
    };
  }

  const rentalDays = diffDays(fromISODate, toISODate);

  // Past pickup.
  if (fromISODate < nowDate) {
    return {
      available: false,
      reason: 'before-window',
      conflicts: [],
      rentalDays,
    };
  }

  // Beyond the bookable window.
  if (toISODate > windowEnd) {
    return {
      available: false,
      reason: 'after-window',
      conflicts: [],
      rentalDays,
    };
  }

  // Rental-length bounds.
  if (rentalDays < MIN_RENTAL_DAYS) {
    return { available: false, reason: 'too-short', conflicts: [], rentalDays };
  }
  if (rentalDays > MAX_RENTAL_DAYS) {
    return { available: false, reason: 'too-long', conflicts: [], rentalDays };
  }

  // Booking conflicts (only this vehicle's bookings).
  const conflicts = bookings.filter(
    (b) =>
      b.vehicleId === vehicleId &&
      rangesOverlap(fromISODate, toISODate, b.fromISODate, b.toISODate),
  );

  if (conflicts.length > 0) {
    return { available: false, reason: 'conflict', conflicts, rentalDays };
  }

  return { available: true, reason: 'available', conflicts: [], rentalDays };
}

/**
 * `getDisabledRanges` — the vehicle's blackout/booked ranges clipped to the
 * bookable window, so the date-range picker can disable/grey them. Pure,
 * derived from the same seeded bookings. Sorted by `fromISODate`.
 *
 * Ranges fully outside the window are dropped; ranges straddling a window edge
 * are clipped to the window so the picker never disables dates it cannot offer.
 */
export function getDisabledRanges(
  vehicleId: string,
  bookings: readonly VehicleBooking[],
): DisabledRange[] {
  const windowStart = getNowDateIso();
  const windowEnd = addDays(windowStart, BOOKABLE_WINDOW_DAYS);

  const clipped: DisabledRange[] = [];

  for (const b of bookings) {
    if (b.vehicleId !== vehicleId) continue;

    // Skip bookings entirely outside the window.
    if (b.toISODate <= windowStart || b.fromISODate >= windowEnd) continue;

    const fromISODate = b.fromISODate < windowStart ? windowStart : b.fromISODate;
    const toISODate = b.toISODate > windowEnd ? windowEnd : b.toISODate;

    if (fromISODate < toISODate) {
      clipped.push({ fromISODate, toISODate });
    }
  }

  clipped.sort((a, b) => a.fromISODate.localeCompare(b.fromISODate));
  return clipped;
}
