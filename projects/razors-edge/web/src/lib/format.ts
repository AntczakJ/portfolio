import { minutesToHHMM } from '@/lib/schemas/common';
import type { Currency } from '@/lib/schemas/common';

/**
 * Presentation formatters for the marketing sections + booking flow.
 *
 * Deterministic and locale-pinned (`en-GB`) so prices / durations render
 * identically across the demo, the screenshots, and the tests — the same
 * frozen-now discipline applied to formatting (ADR-003). No `Date.now()`,
 * no host-locale drift.
 */

/**
 * Format a price from minor units (grosze / cents) + ISO-4217 currency.
 * The menu is PLN in v1; the formatter handles any of the schema currencies.
 *
 *   formatPrice(16_000, 'PLN') -> '160 zł'
 *   formatPrice(23_000, 'PLN') -> '230 zł'
 *
 * Whole-currency amounts drop the minor part (a barber menu reads as round
 * numbers); fractional amounts keep two digits.
 */
export function formatPrice(priceMinor: number, currency: Currency): string {
  const major = priceMinor / 100;
  const hasFraction = priceMinor % 100 !== 0;
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
    currencyDisplay: 'narrowSymbol',
  });
  return formatter.format(major);
}

/**
 * Format a duration in minutes as an editorial label.
 *
 *   formatDuration(45)  -> '45 min'
 *   formatDuration(75)  -> '1 hr 15 min'
 *   formatDuration(120) -> '2 hr'
 */
export function formatDuration(durationMin: number): string {
  if (durationMin < 60) return `${String(durationMin)} min`;
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const hourLabel = `${String(hours)} hr`;
  return mins === 0 ? hourLabel : `${hourLabel} ${String(mins)} min`;
}

const WEEKDAY_SHORT = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Parse a studio-local YYYY-MM-DD into its weekday / day-of-month / month
 * parts WITHOUT host-timezone drift (anchored to UTC midnight, the same
 * way `weekdayOfISODate` does). Deterministic — no `toLocaleDateString`.
 */
function isoParts(isoDate: string): {
  weekday: number;
  day: number;
  month: number;
} {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return {
    weekday: d.getUTCDay(),
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
  };
}

/** Short date-strip label: "Wed 10". */
export function formatDateShort(isoDate: string): {
  weekday: string;
  day: number;
} {
  const { weekday, day } = isoParts(isoDate);
  // `weekday` is 0-6 from getUTCDay(), so the lookup is always defined; the
  // `?? ''` is an unreachable fallback that satisfies noUncheckedIndexedAccess.
  return { weekday: WEEKDAY_SHORT[weekday] ?? '', day };
}

/** Full editorial date label: "Wednesday 10 June". */
export function formatDateLong(isoDate: string): string {
  const { weekday, day, month } = isoParts(isoDate);
  // weekday (0-6) and month (0-11) come from UTC getters, so both lookups are
  // always defined; the `?? ''` fallbacks are unreachable but satisfy
  // noUncheckedIndexedAccess without a non-null assertion.
  return `${WEEKDAY_LONG[weekday] ?? ''} ${String(day)} ${MONTH_SHORT[month] ?? ''}`;
}

/** A time-of-day label from minutes-from-midnight: "10:30". */
export function formatTime(minuteOfDay: number): string {
  return minutesToHHMM(minuteOfDay);
}

/** A start–end time range label: "10:30 – 11:45". */
export function formatTimeRange(
  startMin: number,
  durationMin: number,
): string {
  return `${formatTime(startMin)} – ${formatTime(startMin + durationMin)}`;
}

/** Human label for a service category (the menu group headings). */
export function formatCategory(
  category: 'cut' | 'beard' | 'shave' | 'combo',
): string {
  switch (category) {
    case 'cut':
      return 'Cuts';
    case 'beard':
      return 'Beard';
    case 'shave':
      return 'Shave';
    case 'combo':
      return 'Combinations';
  }
}
