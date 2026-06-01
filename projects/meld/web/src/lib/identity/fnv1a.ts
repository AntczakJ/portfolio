/**
 * FNV-1a 32-bit hash — client mirror of the server's reference
 * implementation at `meld-server/src/lib/session/fnv1a.ts`.
 *
 * The constants, iteration mode (UTF-16 code units via `charCodeAt`), and
 * `Math.imul` prime multiply MUST match the server byte-for-byte — both
 * sides derive the per-board awareness `colorSlot` from
 * `fnv1a32(sessionId + ':' + boardId) % 8`, and a drift would assign a
 * different cursor color on each side of the wire.
 *
 * Per ADR-005 the OKLCH palette duplication (`globals.css` light + dark
 * variants AND `meld-server/src/lib/session/color.ts`) is documented as
 * a known cross-package convergence; this hash port is the third half of
 * that contract. Any change to the constants here MUST also land in
 * `meld-server/src/lib/session/fnv1a.ts` in the same commit.
 *
 * Known vector — `fnv1a32('') === 2166136261` (offset basis with no
 * rounds run). Verified by the tests at `__tests__/types.test.ts`
 * indirectly via the `colorSlotFor` derivation.
 */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * Compute the FNV-1a 32-bit hash of `input` as a non-negative integer.
 * Mirrors the server implementation verbatim.
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/**
 * Per-board OKLCH awareness slot for a `(sessionId, boardId)` pair.
 * Returns `0 | 1 | ... | 7` indexing into the 8-slot wheel declared in
 * `app/globals.css` (`--color-awareness-0` ... `--color-awareness-7`).
 *
 * Mirrors `meld-server/src/lib/session/color.ts:colorSlotFor` so the
 * shape's `colorSlot` field — written when the local user draws a shape
 * — resolves to the same hue the server reported in the welcome frame.
 * Without this mirror, shape colours would not match cursor colours for
 * the same user.
 */
export function colorSlotFor(sessionId: string, boardId: string): number {
  return fnv1a32(`${sessionId}:${boardId}`) % 8;
}
