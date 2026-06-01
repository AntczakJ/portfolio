/**
 * FNV-1a 32-bit hash — canonical reference implementation.
 *
 * Per ADR-005 the meld session-identity derivations
 *   - `emojiFor(sessionId)`        — `fnv1a32(sessionId) % 128`
 *   - `colorSlotFor(sessionId, boardId)` — `fnv1a32(sessionId + ':' + boardId) % 8`
 * are both built on this hash. The frontend mirrors the same algorithm
 * verbatim once Task 2.5b lands (`meld-web/src/lib/identity/`); this file
 * is the single canonical reference until then.
 *
 * Constants are the classic Numerical Recipes FNV-1a 32-bit values:
 *   - offset basis: `0x811c9dc5`
 *   - prime:        `0x01000193`
 *
 * Known vector (empty string) — `fnv1a32('') === 2166136261` — which is the
 * offset basis itself (no bytes consumed, no rounds run). Used as the
 * first sanity test in `__tests__/fnv1a.test.ts`.
 *
 * Encoding: we iterate UTF-16 code UNITS (`charCodeAt`) rather than
 * UTF-8 bytes. The downstream session ids are server-minted UUID v4
 * strings (ASCII hex + hyphens) and board ids are URL-safe slugs, so
 * every code unit is in the 0x00-0x7F range and the UTF-16 byte path
 * collapses to the canonical FNV-1a byte stream. If a future caller
 * passes non-ASCII (e.g. an emoji codepoint), the hash is still
 * deterministic — it just diverges from a UTF-8-byte FNV-1a impl on
 * the same input. The frontend mirror MUST use the same iteration
 * (UTF-16 code units) so the cross-package derivation matches.
 *
 * Returns a non-negative 32-bit integer via `>>> 0` to coerce the
 * signed-int bit pattern JavaScript bitwise ops leave behind into the
 * positive uint32 range. Without the unsigned shift the modulo on the
 * call sites would occasionally wrap negative.
 */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * Compute the FNV-1a 32-bit hash of `input` as a non-negative integer.
 *
 *   fnv1a32('')        -> 2166136261     (offset basis, no rounds)
 *   fnv1a32('a')       -> 3826002220
 *   fnv1a32('meld')    -> 1006249494
 *
 * `Math.imul` is used for the prime multiply because the FNV prime
 * exceeds the safe-integer range when multiplied by a 32-bit hash value;
 * `Math.imul` performs C-style 32-bit signed integer multiplication
 * truncated to the low 32 bits, which is exactly the wraparound FNV-1a
 * requires.
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}
