/**
 * Frozen reference clock (ADR-003 — non-negotiable determinism).
 *
 * A SINGLE frozen "current time" shared by the availability generator, the
 * date-strip "next 14 days", the booking-reference hash, the UI, and all
 * tests. This is what keeps the date strip, the availability grid, and
 * Playwright / Lighthouse runs reproducible across reloads.
 *
 * RULE: never call `Date.now()` / `new Date()` (no-arg) / `Math.random()`
 * in render or in the availability generator. Read the clock here instead.
 * Same discipline tape and meld established.
 *
 * The frozen instant is Wednesday 2026-06-10, 11:00 local studio time —
 * chosen so the next-14-days window spans two weekends and lands on a
 * normal working weekday, and so seeded barber days-off / pre-bookings
 * produce believable gaps. The studio timezone is fixed (Europe/Warsaw,
 * UTC+02:00 in June) so `.ics` DTSTART/DTEND and the date math agree.
 */

/** IANA timezone of the studio. Fixed so all date math is deterministic. */
export const STUDIO_TIME_ZONE = 'Europe/Warsaw';

/**
 * UTC offset (minutes) of the studio zone at the frozen instant. June is
 * CEST (UTC+02:00) → +120. Hard-coded because the frozen `now` never moves
 * across a DST boundary; if the escape hatch ever advances the clock past
 * October, revisit this (carried in AGENT_NOTES.md).
 */
export const STUDIO_UTC_OFFSET_MIN = 120;

/**
 * The frozen reference instant, as a fixed ISO-8601 string WITH the studio
 * offset so it is an unambiguous instant regardless of the host timezone
 * (a test runner in UTC and a dev machine in another zone both resolve the
 * same wall-clock day/time). Wednesday 2026-06-10 11:00 +02:00.
 */
export const FROZEN_NOW_ISO = '2026-06-10T11:00:00+02:00';

/**
 * Escape hatch: `NEXT_PUBLIC_RAZORS_NOW` may override the frozen instant
 * for manual exploration (e.g. to advance the date strip). It is read once
 * here, never elsewhere. The default — and the value every test and the
 * deployed demo use — is the frozen instant above.
 *
 * NOTE: keep this purely a build-time/manual override. Production demo and
 * tests do NOT set it, so behaviour is the frozen instant.
 */
function resolveNowIso(): string {
  const override =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_RAZORS_NOW
      : undefined;
  return override && override.length > 0 ? override : FROZEN_NOW_ISO;
}

const NOW = new Date(resolveNowIso());

/** The frozen "current time" as a `Date`. Treat as immutable. */
export function now(): Date {
  return new Date(NOW.getTime());
}

/** The frozen "current time" as epoch milliseconds. */
export function nowMs(): number {
  return NOW.getTime();
}

/**
 * The studio-local calendar date (YYYY-MM-DD) of an instant, computed
 * against the fixed studio offset (not the host timezone). Used to derive
 * "today" and the date strip without `toLocaleDateString` locale drift.
 */
export function toStudioISODate(instant: Date): string {
  const shifted = new Date(
    instant.getTime() + STUDIO_UTC_OFFSET_MIN * 60_000,
  );
  // Use UTC getters on the shifted instant → studio-local wall-clock date.
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${String(y)}-${m}-${d}`;
}

/** The frozen "today" as a studio-local ISO date (YYYY-MM-DD). */
export function todayISODate(): string {
  return toStudioISODate(now());
}

/** Day of week for a YYYY-MM-DD studio date: 0 = Sunday … 6 = Saturday. */
export function weekdayOfISODate(isoDate: string): number {
  // Parse as a studio-local midnight (offset-anchored) so the weekday is
  // stable regardless of host timezone.
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
  return utcMidnight.getUTCDay();
}

/**
 * The next `count` studio-local dates starting from the frozen "today"
 * (inclusive). The date strip ("next 14 days") reads this — deterministic
 * because `now()` is frozen.
 */
export function upcomingISODates(count: number): string[] {
  const start = todayISODate();
  const startUtc = new Date(`${start}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(startUtc + i * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${String(y)}-${m}-${day}`);
  }
  return out;
}
