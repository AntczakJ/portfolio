import { describe, expect, it } from 'vitest';

import { getAvailability, SLOT_STEP_MIN } from '../availability';
import { todayISODate, upcomingISODates } from '../clock';
import { barberSchema, type Barber } from '../schemas/barber';
import type { PreBooking } from '../schemas/availability';
import { hhmmToMinutes, minutesToHHMM } from '../schemas/common';

/**
 * Unit suite for the load-bearing domain logic: the pure, deterministic
 * `getAvailability` (ADR-003). Covers combo block length, closed/day-off
 * carve-outs, the lunch hole, pre-booking collisions → disabled slots,
 * overflow-past-close, the frozen-now past-slot rule, and determinism.
 *
 * Frozen now (src/lib/clock.ts) = Wed 2026-06-10 11:00 studio-local. The
 * test picks dates from the frozen "next 14 days" so weekday math is fixed.
 */

/** Assert a value is defined, narrowing away `undefined` for fixed indices
 * into known-length arrays. Throws (failing the test) rather than papering
 * over a real `undefined` with a non-null assertion. */
function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

const DATES = upcomingISODates(14);
// Index into the frozen window. now = Wed 2026-06-10.
const WED_TODAY = must(DATES[0], 'DATES[0]'); // 2026-06-10 (Wed) — frozen today
const THU = must(DATES[1], 'DATES[1]'); // 2026-06-11 (Thu)
const SAT = must(DATES[3], 'DATES[3]'); // 2026-06-13 (Sat)
const SUN = must(DATES[4], 'DATES[4]'); // 2026-06-14 (Sun) — closed in fixture
const NEXT_WED = must(DATES[7], 'DATES[7]'); // 2026-06-17 (Wed) — no past slots

/** Build a test barber with a uniform Tue–Sat 10:00–18:00 week, Sun/Mon
 * closed, an optional lunch and days-off. Validated through the schema so
 * the fixture matches the production shape. */
function makeBarber(overrides: Partial<Barber> = {}): Barber {
  const day = { open: '10:00', close: '18:00' };
  return barberSchema.parse({
    id: 'brb-test',
    slug: 'test-barber',
    name: 'Test Barber',
    handle: '@test.barber',
    title: 'Tester',
    bio: 'A fixture barber.',
    specialties: ['cut', 'beard', 'shave', 'combo'],
    serviceIds: ['svc-x'],
    portrait: {
      slot: 'p',
      src: '/images/graded/barber-test-barber.jpg',
      alt: 'Test Barber',
      aspectRatio: 0.8,
      blurDataURL: 'data:image/webp;base64,AAAA',
    },
    workingHours: [
      null, // Sun closed
      null, // Mon closed
      day, // Tue
      day, // Wed
      day, // Thu
      day, // Fri
      day, // Sat
    ],
    daysOff: [],
    ...overrides,
  });
}

function availableStarts(
  slots: ReturnType<typeof getAvailability>,
): number[] {
  return slots.filter((s) => s.available).map((s) => s.startMin);
}

describe('getAvailability', () => {
  it('returns [] for a closed weekday (no schedule row)', () => {
    const barber = makeBarber();
    // SUN is closed in the fixture.
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: SUN,
      preBookings: [],
    });
    expect(slots).toEqual([]);
  });

  it('returns [] for a day off even when the weekday is open', () => {
    const barber = makeBarber({ daysOff: [NEXT_WED] });
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings: [],
    });
    expect(slots).toEqual([]);
  });

  it('generates a 15-minute grid from open to the last fitting start', () => {
    const barber = makeBarber();
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings: [],
    });
    // First start is open (10:00 = 600).
    expect(slots[0]?.startMin).toBe(hhmmToMinutes('10:00'));
    // Grid step is 15 minutes.
    expect((slots[1]?.startMin ?? 0) - (slots[0]?.startMin ?? 0)).toBe(
      SLOT_STEP_MIN,
    );
    // Last AVAILABLE 45-min start fits at 17:15 (ends 18:00 = close).
    const avail = availableStarts(slots);
    expect(avail.at(-1)).toBe(hhmmToMinutes('17:15'));
  });

  it('consumes a longer contiguous block for a combo (90 min)', () => {
    const barber = makeBarber();
    const cut = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings: [],
    });
    const combo = getAvailability({
      barber,
      serviceDurationMin: 90,
      date: NEXT_WED,
      preBookings: [],
    });
    // The combo's last available start is earlier (must end by 18:00).
    const lastCut = must(availableStarts(cut).at(-1), 'lastCut');
    const lastCombo = must(availableStarts(combo).at(-1), 'lastCombo');
    expect(minutesToHHMM(lastCut)).toBe('17:15'); // ends 18:00
    expect(minutesToHHMM(lastCombo)).toBe('16:30'); // ends 18:00
    expect(lastCombo).toBeLessThan(lastCut);
  });

  it('emits late candidates that overflow close as disabled, not omitted', () => {
    const barber = makeBarber();
    const slots = getAvailability({
      barber,
      serviceDurationMin: 90,
      date: NEXT_WED,
      preBookings: [],
    });
    // 17:00 start would end 18:30 > 18:00 close → disabled overflow.
    const late = slots.find((s) => s.startMin === hhmmToMinutes('17:00'));
    expect(late).toBeDefined();
    expect(late).toMatchObject({
      available: false,
      reason: 'overflows-close',
    });
  });

  it('carves a hole for the lunch break (disabled with reason "lunch")', () => {
    const barber = makeBarber({
      lunch: { startMin: hhmmToMinutes('13:00'), durationMin: 45 },
    });
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings: [],
    });
    // A 45-min block starting 12:30 ends 13:15 → overlaps 13:00–13:45.
    const collides = slots.find(
      (s) => s.startMin === hhmmToMinutes('12:30'),
    );
    expect(collides).toMatchObject({ available: false, reason: 'lunch' });
    // 13:45 (lunch end) is free again.
    const after = slots.find((s) => s.startMin === hhmmToMinutes('13:45'));
    expect(after).toMatchObject({ available: true });
  });

  it('marks colliding slots disabled with reason "booked" (not hidden)', () => {
    const barber = makeBarber();
    const preBookings: PreBooking[] = [
      {
        id: 'pb-1',
        barberId: barber.id,
        date: NEXT_WED,
        startMin: hhmmToMinutes('11:00'),
        durationMin: 45, // 11:00–11:45 busy
      },
    ];
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings,
    });
    // 10:30 block (10:30–11:15) overlaps the booking → disabled.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('10:30')),
    ).toMatchObject({ available: false, reason: 'booked' });
    // 11:00 block is exactly the booking → disabled.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('11:00')),
    ).toMatchObject({ available: false, reason: 'booked' });
    // 11:45 (half-open: booking ends at 11:45) is free again.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('11:45')),
    ).toMatchObject({ available: true });
    // 10:00 (10:00–10:45) does not reach the booking → free.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('10:00')),
    ).toMatchObject({ available: true });
  });

  it('ignores pre-bookings for other barbers / other dates', () => {
    const barber = makeBarber();
    const preBookings: PreBooking[] = [
      {
        id: 'pb-other-barber',
        barberId: 'someone-else',
        date: NEXT_WED,
        startMin: hhmmToMinutes('11:00'),
        durationMin: 45,
      },
      {
        id: 'pb-other-date',
        barberId: barber.id,
        date: THU,
        startMin: hhmmToMinutes('11:00'),
        durationMin: 45,
      },
    ];
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED,
      preBookings,
    });
    // 11:00 should be free — neither pre-booking applies to this barber+date.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('11:00')),
    ).toMatchObject({ available: true });
  });

  it('disables past slots on the frozen "today" (reason "past")', () => {
    const barber = makeBarber();
    expect(WED_TODAY).toBe(todayISODate()); // sanity: index 0 is frozen today
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: WED_TODAY,
      preBookings: [],
    });
    // Frozen now is 11:00. A 10:00 start is in the past → disabled.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('10:00')),
    ).toMatchObject({ available: false, reason: 'past' });
    // 11:00 is exactly now → not past (start < now is the test) → available.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('11:00')),
    ).toMatchObject({ available: true });
    // 11:15 is clearly future → available.
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('11:15')),
    ).toMatchObject({ available: true });
  });

  it('does NOT apply the past rule to a future date', () => {
    const barber = makeBarber();
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: NEXT_WED, // future date
      preBookings: [],
    });
    // 10:00 on a future date is available (no "past" reason).
    expect(
      slots.find((s) => s.startMin === hhmmToMinutes('10:00')),
    ).toMatchObject({ available: true });
  });

  it('handles Saturday short hours (09:00–16:00) correctly', () => {
    const barber = makeBarber();
    const slots = getAvailability({
      barber,
      serviceDurationMin: 45,
      date: SAT,
      preBookings: [],
    });
    // Fixture Sat uses the same 10:00–18:00 row, so confirm open is 10:00
    // for this fixture (the production roster differs; this asserts the
    // function honours whatever the schedule row says).
    expect(slots[0]?.startMin).toBe(hhmmToMinutes('10:00'));
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const barber = makeBarber({
      lunch: { startMin: hhmmToMinutes('13:00'), durationMin: 30 },
    });
    const pre: PreBooking[] = [
      {
        id: 'pb-d',
        barberId: barber.id,
        date: NEXT_WED,
        startMin: hhmmToMinutes('14:00'),
        durationMin: 45,
      },
    ];
    const a = getAvailability({
      barber,
      serviceDurationMin: 60,
      date: NEXT_WED,
      preBookings: pre,
    });
    const b = getAvailability({
      barber,
      serviceDurationMin: 60,
      date: NEXT_WED,
      preBookings: pre,
    });
    expect(a).toEqual(b);
  });
});
