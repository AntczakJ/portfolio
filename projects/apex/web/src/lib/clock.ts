/**
 * Frozen clock (ADR-003 / AGENT_NOTES cross-cutting: determinism).
 *
 * A single frozen reference instant shared by `getRangeAvailability`,
 * `priceQuote` (indirectly, via rental-day computation), the date-range
 * window ("the next ~60 days"), the UI, and every test + screenshot run.
 *
 * NO `Date.now()` / `new Date()` (without an argument) / `Math.random()` in
 * render or in the pure domain functions — they must read `NOW_ISO` /
 * `getNow()` so the demo is reproducible across reloads (the tape / meld /
 * razors-edge discipline).
 *
 * The reference is a fixed weekday (Monday 2026-06-15, midnight UTC) chosen so
 * the bookable window lands on a stable, screenshot-friendly stretch of dates.
 * A documented test-only override (`__setNowForTests`) may advance the clock to
 * exercise time-relative paths (e.g. the forced-stale date-range reconciliation
 * fixture in Phase 7); the default is frozen.
 */

/** The canonical frozen "now" as a full ISO instant (UTC). */
export const NOW_ISO = '2026-06-15T00:00:00.000Z';

/** The canonical frozen "now" as a calendar date (UTC, no time component). */
export const NOW_DATE_ISO = '2026-06-15';

/**
 * The bookable window length, in days, from `now`. The date-range picker only
 * offers ranges whose `from`/`to` fall inside `[now, now + 60d)`.
 */
export const BOOKABLE_WINDOW_DAYS = 60;

/** Minimum / maximum rental length, in whole days. */
export const MIN_RENTAL_DAYS = 1;
export const MAX_RENTAL_DAYS = 30;

// Internal mutable holder for the test-only override. Default = frozen.
let nowOverrideIso: string | null = null;

/**
 * Returns the frozen "now" instant. Pure under default conditions: it returns
 * a fresh `Date` built from the same fixed ISO string every call, so callers
 * never observe wall-clock drift.
 */
export function getNow(): Date {
  return new Date(nowOverrideIso ?? NOW_ISO);
}

/** The frozen "now" as an ISO string (honours the test override). */
export function getNowIso(): string {
  return nowOverrideIso ?? NOW_ISO;
}

/** The frozen "now" as a calendar-date ISO string `YYYY-MM-DD`. */
export function getNowDateIso(): string {
  return toDateIso(getNow());
}

/**
 * Test-only override. Pass an ISO instant to advance the clock for a single
 * test, or `null` to restore the frozen default. NEVER call this from app
 * code — it exists so the Phase-7 forced-stale reconciliation fixture can move
 * time without touching the wall clock.
 */
export function __setNowForTests(iso: string | null): void {
  nowOverrideIso = iso;
}

// --- Pure date helpers (UTC, calendar-day granularity) --------------------

/** Format a `Date` as a UTC calendar-date ISO string `YYYY-MM-DD`. */
export function toDateIso(date: Date): string {
  const part = date.toISOString().slice(0, 10);
  return part;
}

/** Parse a `YYYY-MM-DD` calendar-date string to a UTC midnight `Date`. */
export function fromDateIso(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00.000Z`);
}

/** Add `days` whole days to a calendar-date ISO string (UTC). */
export function addDays(dateIso: string, days: number): string {
  const base = fromDateIso(dateIso);
  base.setUTCDate(base.getUTCDate() + days);
  return toDateIso(base);
}

/**
 * Whole-day difference `to - from` for two calendar-date ISO strings (UTC).
 * For a half-open rental range `[from, to)` this is the rental-day count.
 */
export function diffDays(fromIso: string, toIso: string): number {
  const from = fromDateIso(fromIso).getTime();
  const to = fromDateIso(toIso).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((to - from) / MS_PER_DAY);
}

/** The last selectable calendar date (exclusive end of the bookable window). */
export function getWindowEndIso(): string {
  return addDays(getNowDateIso(), BOOKABLE_WINDOW_DAYS);
}
