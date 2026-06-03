import {
  STUDIO_UTC_OFFSET_MIN,
  now,
  toStudioISODate,
  weekdayOfISODate,
} from './clock';
import { hhmmToMinutes } from './schemas/common';
import type {
  AvailabilitySlot,
  PreBooking,
  SlotUnavailableReason,
} from './schemas/availability';
import type { Barber } from './schemas/barber';

/**
 * Pure, deterministic availability generator (ADR-003).
 *
 * Composes the barber's working hours for the requested weekday MINUS
 * days-off MINUS the lunch break MINUS seeded pre-bookings into a slot
 * array. Combos need no special case: a combo is just a `Service` with a
 * larger `durationMin`, so a longer contiguous block is consumed purely by
 * passing the larger `serviceDurationMin`.
 *
 * Determinism: reads the frozen clock (src/lib/clock.ts) for "now" — never
 * `Date.now()` / `new Date()` directly — so the grid is stable across
 * reloads and reproducible in tests / Playwright / Lighthouse.
 *
 * Contract:
 *  - Candidate starts sit on a fixed 15-minute grid from `open` to
 *    `close − serviceDurationMin`.
 *  - A slot is `available: true` iff the half-open interval
 *    `[start, start + serviceDurationMin)` (a) ends at or before `close`,
 *    (b) overlaps NO pre-booking for that barber/date, (c) does not
 *    intersect the lunch break, and (d) does not start in the past
 *    relative to the frozen now.
 *  - Colliding / out-of-bounds candidates are EMITTED as
 *    `{ available: false, reason }` — never omitted — so the grid renders
 *    accessible disabled slots rather than silently hiding them.
 *  - A closed weekday or a day-off returns an empty array (nothing to
 *    render — the date itself is unselectable upstream).
 */

/** The fixed slot grid step, in minutes. */
export const SLOT_STEP_MIN = 15;

export interface GetAvailabilityArgs {
  barber: Barber;
  serviceDurationMin: number;
  /** Studio-local ISO date (YYYY-MM-DD). */
  date: string;
  /** Seeded pre-bookings for this barber (any date; filtered internally). */
  preBookings: readonly PreBooking[];
}

/** Half-open overlap test: do [aStart,aEnd) and [bStart,bEnd) intersect? */
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function getAvailability({
  barber,
  serviceDurationMin,
  date,
  preBookings,
}: GetAvailabilityArgs): AvailabilitySlot[] {
  // Closed weekday → empty (the date is unselectable upstream).
  const weekday = weekdayOfISODate(date);
  const daySchedule = barber.workingHours[weekday];
  if (!daySchedule) return [];

  // Day off → empty.
  if (barber.daysOff.includes(date)) return [];

  const openMin = hhmmToMinutes(daySchedule.open);
  const closeMin = hhmmToMinutes(daySchedule.close);
  if (closeMin <= openMin) return [];

  // Bookings that actually apply to this barber + date.
  const dayBookings = preBookings.filter(
    (b) => b.barberId === barber.id && b.date === date,
  );

  const lunch = barber.lunch;
  const lunchStart = lunch?.startMin;
  const lunchEnd =
    lunch && lunchStart !== undefined
      ? lunchStart + lunch.durationMin
      : undefined;

  // "Now" boundary: minutes-from-midnight of the frozen now, but only if
  // the requested date is the frozen "today" (past dates are unselectable
  // upstream; future dates never have past slots).
  const nowInstant = now();
  const todayISO = toStudioISODate(nowInstant);
  const nowMinutes =
    date === todayISO
      ? // Studio-local minutes since midnight of the frozen now.
        (() => {
          // Reconstruct studio-local wall-clock minutes from the same
          // offset logic the clock uses, without re-importing internals.
          const utc = nowInstant.getTime();
          const shifted = new Date(utc + STUDIO_UTC_OFFSET_MIN * 60_000);
          return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
        })()
      : -1;

  const slots: AvailabilitySlot[] = [];
  const lastStart = closeMin - serviceDurationMin;
  // Iterate candidate starts up to (but not including) close, so the grid
  // shows the last on-the-hour rows — including a few late overflow
  // candidates as disabled — without ever emitting a start AT closing time.
  const lastCandidate = closeMin - SLOT_STEP_MIN;

  for (let start = openMin; start <= lastCandidate; start += SLOT_STEP_MIN) {
    const end = start + serviceDurationMin;

    let reason: SlotUnavailableReason | null = null;

    if (start > lastStart || end > closeMin) {
      // Block would run past closing — still emit the start as disabled so
      // the grid shows the late slot greyed out, not missing.
      reason = 'overflows-close';
    } else if (
      lunchStart !== undefined &&
      lunchEnd !== undefined &&
      overlaps(start, end, lunchStart, lunchEnd)
    ) {
      reason = 'lunch';
    } else if (
      dayBookings.some((b) =>
        overlaps(start, end, b.startMin, b.startMin + b.durationMin),
      )
    ) {
      reason = 'booked';
    } else if (nowMinutes >= 0 && start < nowMinutes) {
      reason = 'past';
    }

    if (reason) {
      slots.push({ startMin: start, available: false, reason });
    } else {
      slots.push({ startMin: start, available: true });
    }
  }

  return slots;
}
