/**
 * Shape kind discriminator + tool kind.
 *
 * Phase 3.2 ships four shape primitives. `'arrow'` is deliberately NOT
 * in the union — Task 3.2b adds it alongside the selection chrome.
 * Adding it earlier would push the toolbar visual layout to six slots
 * (ergonomic edge) without delivering a usable shape today.
 *
 * `ToolKind` is the toolbar's currently-active mode. `'select'` is a
 * no-op state in Phase 3.2 (Phase 3.2b's selection chrome plugs into
 * it); the other four mirror the four shape kinds 1:1.
 *
 * Why a literal-tuple-derived union (vs a hand-written `'rectangle' |
 * 'ellipse' | ...`)? Adding a kind in one place — the `SHAPE_KINDS`
 * tuple — extends every consumer that imports `ShapeKind` (the
 * factory's switch is exhaustive over the union; the painter's
 * dispatch is exhaustive over the union; the tests cover the union).
 * A hand-written union splits the source of truth between the type
 * and the runtime list of kinds, which is the same drift problem
 * `THEME_TOKENS` solves for token names in `theme-tokens.ts`.
 */

/**
 * The four shape primitives Phase 3.2 ships. Order is the toolbar
 * display order (left-to-right after the Select slot).
 */
export const SHAPE_KINDS = ['rectangle', 'ellipse', 'freehand', 'text'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * Tool kinds — the four shape kinds plus the no-op `'select'` state.
 */
export const TOOL_KINDS = ['select', ...SHAPE_KINDS] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];

/**
 * Runtime narrow for `string -> ShapeKind`. Used by the shape Y.Map
 * reader to validate the persisted `kind` field before dispatching to
 * a painter. A shape with a malformed `kind` is dropped (logged in
 * dev, silently skipped in prod) — defence against a future v2 server
 * sending a shape kind v1 does not know about.
 */
export function isShapeKind(v: string): v is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(v);
}

export function isToolKind(v: string): v is ToolKind {
  return (TOOL_KINDS as readonly string[]).includes(v);
}
