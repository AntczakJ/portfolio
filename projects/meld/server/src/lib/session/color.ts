/**
 * Per-board OKLCH color derivation (ADR-005).
 *
 * `colorSlotFor(sessionId, boardId)` returns the 8-slot awareness wheel
 * index for a session on a specific board:
 *
 *     fnv1a32(sessionId + ':' + boardId) % 8
 *
 * Per-BOARD scoping (vs per-SESSION) is deliberate per ADR-005: if two
 * concurrent users on board A collide on a color slot, joining board B
 * shuffles them into different slots, so the long-tail collision
 * probability on the whole demo is bounded by per-board birthday
 * paradox (~5 concurrent users for a ~50% collision chance on 8 slots)
 * rather than session-lifetime persistence. The emoji-name stays
 * stable across boards (`emojiFor(sessionId)` doesn't mix in boardId) —
 * the identity thread is "your emoji-name is yours; your color rotates
 * to ease per-room collisions".
 *
 * The 8 OKLCH triples below MIRROR the CSS custom properties
 * `--color-awareness-0` ... `--color-awareness-7` in
 * `meld-web/src/app/globals.css` (Task 2.1's awareness palette). The
 * duplication is documented per AGENT_NOTES.md "OKLCH palette
 * duplicated server-side AND client-side" — `docs/conventions.md` § 14
 * forbids cross-package design-token sharing in v1, and the welcome
 * frame must be able to ship a resolved color triple to the client
 * without forcing the client to look up the slot index against a CSS
 * variable it might not have parsed yet.
 *
 * IF the awareness palette in `globals.css` is ever edited, this file
 * MUST be edited in the same commit. The single source of truth is the
 * AGENT_NOTES.md Task 2.1 pin; this file is the canonical TypeScript
 * mirror.
 *
 * Wheel order:
 *
 *   - Slot 0 is the brand-anchor hue (285° violet) — the first-assigned
 *     cursor matches the brand. The position is load-bearing; do NOT
 *     reorder the array even if a future palette tweak adjusts
 *     individual L/C values.
 *   - Light + dark variants live as a paired struct so a welcome-frame
 *     builder can resolve both in one shot. The client picks the
 *     active variant from `useTheme().resolvedTheme` (per AGENT_NOTES
 *     Task 2.3 pin) — server doesn't know which theme the visitor is
 *     in at welcome time.
 */

import { fnv1a32 } from './fnv1a';

/**
 * One OKLCH triple — `L` lightness (0..1), `C` chroma, `H` hue (0..360).
 * Mirrors the `oklch(L C H)` CSS function-call argument order.
 */
export interface OklchTriple {
  L: number;
  C: number;
  H: number;
}

/**
 * One slot in the awareness palette — the same hue resolved for both
 * the light canvas and the dark canvas. Welcome-frame builders ship
 * both; the client renders whichever matches the active theme.
 */
export interface AwarenessWheelSlot {
  light: OklchTriple;
  dark: OklchTriple;
}

/**
 * 8-slot OKLCH wheel mirroring `meld-web/src/app/globals.css`:
 *
 *   - All light slots: L=0.6, C=0.17, H rotates 45° from 285° (brand).
 *   - All dark slots:  L=0.72, C=0.17, H rotates 45° from 285° (brand).
 *
 * Order:
 *
 *   0 — 285° violet (brand anchor)
 *   1 — 330° magenta
 *   2 —  15° warm red
 *   3 —  60° amber
 *   4 — 105° olive-green
 *   5 — 150° emerald
 *   6 — 195° teal-cyan
 *   7 — 240° indigo
 */
// NB: no explicit `: readonly AwarenessWheelSlot[]` annotation here.
// Adding one would widen the literal-tuple `as const` type to a
// regular readonly array, after which `noUncheckedIndexedAccess`
// returns `T | undefined` for every indexed access — including
// `AWARENESS_WHEEL[0]` which we use as a safe-fallback. The literal
// tuple inference keeps the literal-index access narrow while still
// satisfying `colorFor`'s return contract.
export const AWARENESS_WHEEL = [
  { light: { L: 0.6, C: 0.17, H: 285 }, dark: { L: 0.72, C: 0.17, H: 285 } },
  { light: { L: 0.6, C: 0.17, H: 330 }, dark: { L: 0.72, C: 0.17, H: 330 } },
  { light: { L: 0.6, C: 0.17, H: 15 }, dark: { L: 0.72, C: 0.17, H: 15 } },
  { light: { L: 0.6, C: 0.17, H: 60 }, dark: { L: 0.72, C: 0.17, H: 60 } },
  { light: { L: 0.6, C: 0.17, H: 105 }, dark: { L: 0.72, C: 0.17, H: 105 } },
  { light: { L: 0.6, C: 0.17, H: 150 }, dark: { L: 0.72, C: 0.17, H: 150 } },
  { light: { L: 0.6, C: 0.17, H: 195 }, dark: { L: 0.72, C: 0.17, H: 195 } },
  { light: { L: 0.6, C: 0.17, H: 240 }, dark: { L: 0.72, C: 0.17, H: 240 } },
] as const satisfies readonly AwarenessWheelSlot[];

/**
 * Number of slots in the awareness wheel. Literal-typed `8` so the
 * modulo operation below stays narrow.
 */
export const AWARENESS_WHEEL_SIZE = 8 as const;

/** Valid wheel slot indices — the return type of `colorSlotFor`. */
export type AwarenessSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Resolve the 8-slot awareness wheel index for `(sessionId, boardId)`.
 *
 * Same `(sessionId, boardId)` pair always returns the same slot.
 * Different boards give different rotations even for the same session,
 * which is the per-board collision-avoidance property ADR-005 pins.
 *
 * The `:` separator is part of the hash input by ADR-005 contract; it
 * is NOT a generic concatenation. If a future widening of the input
 * vocabulary needs a different separator, that becomes a new helper
 * (e.g., `colorSlotForRoom(sessionId, boardId, roomId)`) — do NOT
 * silently re-encode this one, every visitor's per-board color
 * assignment would silently shift.
 */
export function colorSlotFor(
  sessionId: string,
  boardId: string,
): AwarenessSlot {
  const slot = fnv1a32(`${sessionId}:${boardId}`) % AWARENESS_WHEEL_SIZE;
  // `fnv1a32 % 8` is in `[0, 7]` so the cast is safe. Using a type
  // assertion rather than a runtime check keeps the hot path branch-free.
  return slot as AwarenessSlot;
}

/**
 * Resolve the full OKLCH triple pair (light + dark) for
 * `(sessionId, boardId)`. Welcome-frame builders use this to ship a
 * pre-resolved color to the client.
 */
export function colorFor(
  sessionId: string,
  boardId: string,
): AwarenessWheelSlot {
  // `AWARENESS_WHEEL` is a literal tuple via `as const satisfies ...`,
  // so an indexed access with the `AwarenessSlot` literal-union type
  // narrows to the concrete element type without
  // `noUncheckedIndexedAccess` widening to `T | undefined`.
  return AWARENESS_WHEEL[colorSlotFor(sessionId, boardId)];
}
