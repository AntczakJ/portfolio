// Side-effect FIRST: opt zod out of its `new Function` JIT probe before any
// schema in this module (or any module that imports it) is defined, so the
// strict CSP (no `unsafe-eval`) reports zero violations on EVERY route —
// including the lazy first-compile on `/` (D-CSP-1). This is the schema
// foundation every other schema builds on, so importing it here guarantees
// the config runs before the first validator can JIT-compile.
import '@/lib/zod-config';
import { z } from 'zod';

/**
 * Shared schema primitives for the booking domain (ADR-003).
 *
 * These are the contract pieces reused across `service`, `barber`,
 * `availability`, `booking-draft`, and the mocked submit. Per
 * docs/conventions.md § 5 the schemas in `src/lib/schemas/` are the single
 * source of truth shared by the wizard form steps and the submit handler —
 * even though there is no separate backend in v1.
 */

/** Service taxonomy (ADR-003). A combo is one row with `category: 'combo'`
 * and a longer `durationMin` — there is no separate composition model. */
export const serviceCategorySchema = z.enum([
  'cut',
  'beard',
  'shave',
  'combo',
]);
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

/** ISO calendar date, YYYY-MM-DD (studio-local; see src/lib/clock.ts). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export type ISODate = z.infer<typeof isoDateSchema>;

/** Wall-clock time as "HH:mm" (24h). */
export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export type HHMM = z.infer<typeof hhmmSchema>;

/** Minutes from studio-local midnight (0–1440). The availability grid and
 * pre-bookings speak in minutes-from-midnight, not wall-clock strings, so
 * the math is plain integer arithmetic. */
export const minuteOfDaySchema = z.number().int().min(0).max(24 * 60);

/** ISO 4217 currency code (the menu is single-currency in v1). */
export const currencySchema = z.enum(['PLN', 'EUR', 'USD', 'GBP']);
export type Currency = z.infer<typeof currencySchema>;

/** Price in minor units (grosze / cents) to avoid float money. */
export const priceMinorSchema = z.number().int().min(0);

/** Convert "HH:mm" to minutes-from-midnight. Pure helper for mocks/UI. */
export function hhmmToMinutes(value: HHMM): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Convert minutes-from-midnight to "HH:mm". Pure helper for mocks/UI. */
export function minutesToHHMM(value: number): HHMM {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
