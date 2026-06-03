import type { BookingSubmission } from './schemas/booking';

/**
 * Deterministic booking reference (ADR-003).
 *
 * The mocked submit must return a STABLE `reference` so screenshots and
 * tests reproduce exactly — there is no server-side id generation, no
 * randomness. The reference is a short, uppercase, base-32-ish hash of the
 * submission's identifying fields (service + barber + date + start), in the
 * `RE-XXXXXX` shape `confirmedBookingSchema` validates.
 *
 * The same submission always yields the same reference; two different
 * appointments practically never collide for a demo's purposes (a 6-char
 * Crockford-style alphabet over a 32-bit FNV hash).
 */

// Crockford base-32 alphabet (no I, L, O, U → unambiguous when read aloud).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32-bit FNV-1a hash of a string (deterministic, no crypto needed). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in int range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit.
  return hash >>> 0;
}

/** Encode an unsigned integer as `length` Crockford-base32 chars. */
function encodeBase32(value: number, length: number): string {
  let n = value;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // `n % 32` is always 0-31, a valid index into the 32-char alphabet; the
    // `?? ''` is an unreachable fallback for noUncheckedIndexedAccess.
    out = (ALPHABET[n % 32] ?? '') + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * Build the deterministic `RE-XXXXXX` reference for a submission. Pure —
 * the same submission fields always produce the same code.
 */
export function bookingReference(submission: BookingSubmission): string {
  const seed = [
    submission.serviceId,
    submission.barberId,
    submission.date,
    String(submission.startMin),
  ].join('|');
  // Mix two FNV passes (forward + reversed) to spread the 6 chars across
  // the full hash space rather than just the low bits of one 32-bit value.
  const a = fnv1a(seed);
  const b = fnv1a(seed.split('').reverse().join(''));
  const high = encodeBase32(a, 3);
  const low = encodeBase32(b, 3);
  return `RE-${high}${low}`;
}
