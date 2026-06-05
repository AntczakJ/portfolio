import type { ReservationSubmit } from '@/lib/schemas/reservation-draft';

/**
 * Deterministic reservation reference (Task 5.6 / ADR-003).
 *
 * The confirmation `reference` is a stable, short, human-friendly code derived
 * PURELY from the submit payload — so the same reservation always confirms with
 * the same code (reproducible for screenshots + Playwright; ADR-003 "reference
 * derived from the draft so screenshots are stable"). No `Date.now()` /
 * `Math.random()`.
 *
 * Format: `APX-XXXX-XXXX` over an unambiguous alphabet (no 0/O/1/I) so a code
 * reads cleanly on a confirmation card. A small FNV-1a hash over the canonical
 * payload fields seeds the digits — collision-resistant enough for a demo.
 */

/** Crockford-ish alphabet, ambiguous glyphs (0 O 1 I) removed. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** FNV-1a 32-bit hash of a string (deterministic, no crypto needed). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in int range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit.
  return hash >>> 0;
}

/**
 * The canonical string the reference hashes over. Order-stable and includes
 * every field that distinguishes one reservation from another — so two
 * different reservations are vanishingly unlikely to share a code, while the
 * same reservation is byte-stable.
 */
function canonicalPayload(submit: ReservationSubmit): string {
  return [
    submit.vehicleId,
    submit.config?.colorId ?? '',
    submit.config?.wheelId ?? '',
    submit.range.fromISODate,
    submit.range.toISODate,
    submit.pickupLocationId,
    submit.returnLocationId,
    [...submit.extras].sort().join(','),
    submit.insuranceTier ?? '',
    submit.driver.email.toLowerCase(),
    submit.driver.licenceNo.toUpperCase(),
  ].join('|');
}

/** Map a 32-bit number to N alphabet characters. */
function encode(value: number, length: number): string {
  let n = value;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // `n % ALPHABET.length` is always in range, so the index never misses; the
    // `?? ''` only satisfies `noUncheckedIndexedAccess` and cannot fire here, so
    // the encoded output stays byte-identical.
    out += ALPHABET[n % ALPHABET.length] ?? '';
    n = Math.floor(n / ALPHABET.length);
  }
  return out;
}

/** Build the deterministic `APX-XXXX-XXXX` reference for a submit payload. */
export function reservationReference(submit: ReservationSubmit): string {
  const canonical = canonicalPayload(submit);
  const a = fnv1a(canonical);
  // A second, salted hash for the back half so both groups vary independently.
  const b = fnv1a(`${canonical}#tail`);
  return `APX-${encode(a, 4)}-${encode(b, 4)}`;
}
