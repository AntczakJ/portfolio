/**
 * Pure formatting helpers (Phase 5).
 *
 * Deterministic: a FIXED locale (`en-GB`) is used so currency strings are
 * byte-stable across machines, locales, tests, and screenshots (no reliance on
 * the host's default locale). No `Date.now()` / `Math.random()`. Amounts are
 * the schema's integer MINOR units (e.g. cents) — divided by 100 for display.
 */

/** The canonical display locale (determinism — never the host default). */
const DISPLAY_LOCALE = 'en-GB';

/**
 * Format an integer minor-unit amount (e.g. 29900) as a currency string
 * (e.g. "€299") for the given ISO 4217 currency. Whole-unit prices drop the
 * fraction; non-whole amounts keep two decimals. Used by the fleet cards, the
 * price summary, and the wizard.
 */
export function formatCurrency(minor: number, currency: string): string {
  const major = minor / 100;
  const hasFraction = minor % 100 !== 0;
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(major);
}

/**
 * The daily-price label for a vehicle card — e.g. "€299 / day". The "/ day"
 * suffix is appended in copy (not via `Intl`) so it reads naturally.
 */
export function formatDailyPrice(minor: number, currency: string): string {
  return `${formatCurrency(minor, currency)} / day`;
}
