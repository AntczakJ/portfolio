/**
 * Shape data model — Phase 3.2 (ADR-008 directory shape pin
 * `web/src/lib/yjs/shapes-schema.ts` is reified here under
 * `web/src/lib/shapes/types.ts` for symmetry with the existing
 * `web/src/lib/shapes/__tests__/` layout that the test files will
 * sit beside).
 *
 * The board document's root is `doc.getMap('shapes')` — a Y.Map keyed
 * by shape id. Each value is ITSELF a Y.Map carrying the shape's
 * fields. ADR-008's observer model (O1) subscribes once to the root
 * map; the `shapeDirty` flag flips on any insert/delete/update at the
 * root level. Phase 3.2 sticks with O1: per-shape field updates also
 * flip `shapeDirty` because root-map deep observers fire on nested
 * mutations as well (Yjs `Y.Map.observeDeep` semantics).
 *
 * WHY Y.MAP PER SHAPE, NOT A PLAIN JSON VALUE
 *
 *   A plain JSON value (`map.set(id, {x, y, w, h, ...})`) would make
 *   `map.set(id, {...next})` the only mutation primitive — a single
 *   field change rewrites the entire object. Under concurrent edits
 *   (User A drags shape S left while User B fills shape S with red),
 *   the last full-object write wins and the loser's edit vanishes.
 *
 *   Y.Map per shape gives CRDT field-level merges: A's `x` write and
 *   B's `fill` write commute, both survive. The Yjs binary update
 *   carries per-field deltas, not whole-object replacements. This is
 *   the load-bearing CRDT property the PLAN.md wow moment depends on
 *   ("two users move/edit the same shape concurrently, both edits
 *   survive, deterministic merge").
 *
 *   The freehand `points` array is itself a `Y.Array` for the same
 *   reason: appending a point under concurrent edits must not race
 *   with the other user's appends.
 *
 * PER-SHAPE LIFECYCLE
 *
 *   Insert: `doc.transact(() => map.set(id, createShape({...})))`.
 *   Update: `doc.transact(() => { map.get(id).set('x', nextX); ... })`.
 *   Delete: `doc.transact(() => map.delete(id))`.
 *
 *   Every mutation is wrapped in `doc.transact(...)` so the awareness
 *   peers see ONE update message per logical edit, not one per field
 *   touched. This is the load-bearing wow-moment contract: a
 *   rectangle landing in tab B fires as one observer event, not four.
 *
 * COLOR SLOT
 *
 *   `colorSlot` is the 0..7 index into ADR-005's awareness wheel. It
 *   resolves to an OKLCH triple via the theme bridge cache
 *   (`palette.awarenessSlots[colorSlot]`). Storing the SLOT and not
 *   the OKLCH string means the shape's hue tracks the theme — light
 *   theme L=0.60 vs dark theme L=0.72 — without a per-flip rewrite of
 *   every shape's `fill` field.
 *
 * TIMESTAMPS + AUTHORSHIP
 *
 *   `createdBy` / `lastEditedBy` carry the session id (from the WS
 *   welcome frame). Phase 3.2b will surface "edited by Otter 2 min
 *   ago" in selection chrome; Phase 3.2 lays the field set.
 */

import * as Y from 'yjs';

import type { ShapeKind } from './kinds';
import { isShapeKind } from './kinds';

/* ============================================================== *\
   Shape map key
\* ============================================================== */

/**
 * The board document's root Y.Map key. Mirrors `SHAPES_MAP_KEY` in
 * `web/src/lib/canvas/engine.ts` — kept here too because the toolbar +
 * pointer overlay write to the document outside the engine, and the
 * import surface for "where the shapes live" should be one symbol per
 * concern.
 */
export const SHAPES_ROOT_KEY = 'shapes';

/* ============================================================== *\
   Field accessors
\* ============================================================== */

/**
 * Common fields shared by every shape kind. Each lives on the
 * per-shape `Y.Map<unknown>` keyed by the literal field name.
 *
 *   id            — UUID v4 also held as the parent map key
 *   kind          — discriminator, one of `ShapeKind`
 *   x, y          — top-left in board coordinates (CSS pixels)
 *   colorSlot     — 0..7 index into the awareness wheel
 *   createdBy     — session id of the author
 *   createdAtMs   — wall-clock ms epoch of the insert
 *   lastEditedBy  — session id of the most recent mutator
 *   lastEditedAtMs— wall-clock ms epoch of the most recent mutation
 */
export interface CommonShapeFields {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  colorSlot: number;
  createdBy: string;
  createdAtMs: number;
  lastEditedBy: string;
  lastEditedAtMs: number;
}

export interface RectangleFields extends CommonShapeFields {
  kind: 'rectangle';
  w: number;
  h: number;
}

export interface EllipseFields extends CommonShapeFields {
  kind: 'ellipse';
  w: number;
  h: number;
}

export interface FreehandPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface FreehandFields extends CommonShapeFields {
  kind: 'freehand';
  /**
   * Y.Array of `{ x, y, pressure? }` — collaborative append safety.
   * Two users drawing simultaneously on the same shape are not the
   * v1 wow-moment scenario (each user draws their own freehand
   * stroke), but using Y.Array keeps the door open and is no more
   * expensive than a plain array on insert.
   */
  points: Y.Array<FreehandPoint>;
}

export interface TextFields extends CommonShapeFields {
  kind: 'text';
  text: string;
  fontSize: number;
}

export type ShapeFields =
  | RectangleFields
  | EllipseFields
  | FreehandFields
  | TextFields;

/* ============================================================== *\
   Y.Map narrowing helpers
\* ============================================================== */

/**
 * Safely read a typed field from a shape's `Y.Map<unknown>`. The
 * `Y.Map` type only knows the value is `unknown`; the per-kind shape
 * definitions above are the source of truth for what each key holds.
 *
 * If a field is missing or the wrong runtime type, the helper returns
 * the supplied default. This keeps the painter resilient to partial
 * snapshots arriving mid-sync (Yjs guarantees eventual consistency,
 * not synchronous integrity of every observer fire).
 */
export function readNumber(map: Y.Map<unknown>, key: string, fallback: number): number {
  const v = map.get(key);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function readString(map: Y.Map<unknown>, key: string, fallback: string): string {
  const v = map.get(key);
  return typeof v === 'string' ? v : fallback;
}

export function readShapeKind(map: Y.Map<unknown>): ShapeKind | null {
  const v = map.get('kind');
  return typeof v === 'string' && isShapeKind(v) ? v : null;
}

export function readFreehandPoints(map: Y.Map<unknown>): Y.Array<FreehandPoint> | null {
  const v = map.get('points');
  return v instanceof Y.Array ? (v as Y.Array<FreehandPoint>) : null;
}

/* ============================================================== *\
   Factory + mutation helpers
\* ============================================================== */

/**
 * Input shape for `createShape({...})`. The factory fills `id` and
 * timestamps; the caller supplies geometry, kind, authorship.
 */
export type CreateShapeInput =
  | {
      kind: 'rectangle';
      x: number;
      y: number;
      w: number;
      h: number;
      colorSlot: number;
      sessionId: string;
    }
  | {
      kind: 'ellipse';
      x: number;
      y: number;
      w: number;
      h: number;
      colorSlot: number;
      sessionId: string;
    }
  | {
      kind: 'freehand';
      x: number;
      y: number;
      initialPoints: readonly FreehandPoint[];
      colorSlot: number;
      sessionId: string;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fontSize: number;
      colorSlot: number;
      sessionId: string;
    };

/**
 * Default text size for the v1 text label. Matches the toolbar's text
 * input rendering so committing the input does NOT cause a font-size
 * change on commit.
 */
export const DEFAULT_TEXT_FONT_SIZE = 18;

/**
 * Output of `createShape`. Both fields are needed at the call site:
 * `id` keys the root shapes map, `map` is the value.
 *
 * Why a tuple-shaped object vs returning just the Y.Map? Y.Map.get()
 * on a DETACHED Y.Map returns `undefined` and emits a Yjs warning —
 * the factory needs to surface the id BEFORE attachment so callers
 * can `rootMap.set(id, map)` without reaching into the detached
 * value. This was caught by the test suite — the previous "read
 * `map.get('id')` to extract the id" pattern works in production
 * (where the call site reads AFTER attaching) but throws stderr
 * noise + an undefined return on the detached read path.
 */
export interface CreatedShape {
  id: string;
  map: Y.Map<unknown>;
}

/**
 * Build a per-shape `Y.Map<unknown>` from `input` with the common
 * fields filled in. Returns `{ id, map }` ready for the canonical
 * insert pattern:
 *
 *   const { id, map } = createShape({ kind: 'rectangle', ... });
 *   doc.transact(() => rootShapesMap.set(id, map));
 *
 * The factory does NOT call `doc.transact` itself — the caller owns
 * the transaction boundary so multiple shapes can land in one tx if
 * needed (e.g., paste-multiple in a future task).
 *
 * Caller is also responsible for ensuring `colorSlot` is in [0..7];
 * the factory clamps defensively (an out-of-range slot would index
 * `undefined` from the awareness wheel under
 * `noUncheckedIndexedAccess`).
 */
export function createShape(input: CreateShapeInput): CreatedShape {
  const id = generateShapeId();
  const now = Date.now();
  const colorSlot = clampColorSlot(input.colorSlot);

  const map = new Y.Map<unknown>();
  // Common fields. Set inside a single fresh map — no observer fires
  // because the map is not yet attached to a document.
  map.set('id', id);
  map.set('kind', input.kind);
  map.set('x', input.x);
  map.set('y', input.y);
  map.set('colorSlot', colorSlot);
  map.set('createdBy', input.sessionId);
  map.set('createdAtMs', now);
  map.set('lastEditedBy', input.sessionId);
  map.set('lastEditedAtMs', now);

  // Per-kind fields.
  switch (input.kind) {
    case 'rectangle':
    case 'ellipse': {
      map.set('w', input.w);
      map.set('h', input.h);
      break;
    }
    case 'freehand': {
      const points = new Y.Array<FreehandPoint>();
      if (input.initialPoints.length > 0) {
        points.push([...input.initialPoints]);
      }
      map.set('points', points);
      break;
    }
    case 'text': {
      map.set('text', input.text);
      map.set('fontSize', input.fontSize);
      break;
    }
  }

  return { id, map };
}

/**
 * Patch fields on an existing shape. Writes touch the per-shape Y.Map
 * (which the deep observer in Phase 3.2b's selection chrome will
 * pick up) and bump `lastEditedBy` + `lastEditedAtMs`. Caller wraps
 * in `doc.transact(...)` so the awareness peers see one update.
 *
 * Phase 3.2 does not yet call `updateShape` from the UI — selection
 * + drag + resize land in Phase 3.2b. The API surface is exported
 * today so the call sites that DO exist (commit-text-on-Enter from
 * the pointer overlay) have one canonical helper to reach for.
 */
export interface UpdateShapePatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  fontSize?: number;
  colorSlot?: number;
}

export function updateShape(
  map: Y.Map<unknown>,
  patch: UpdateShapePatch,
  sessionId: string,
): void {
  if (patch.x !== undefined) map.set('x', patch.x);
  if (patch.y !== undefined) map.set('y', patch.y);
  if (patch.w !== undefined) map.set('w', patch.w);
  if (patch.h !== undefined) map.set('h', patch.h);
  if (patch.text !== undefined) map.set('text', patch.text);
  if (patch.fontSize !== undefined) map.set('fontSize', patch.fontSize);
  if (patch.colorSlot !== undefined) {
    map.set('colorSlot', clampColorSlot(patch.colorSlot));
  }
  map.set('lastEditedBy', sessionId);
  map.set('lastEditedAtMs', Date.now());
}

/**
 * Append a single point to a freehand shape's `points` Y.Array.
 * Bumps the shape's `lastEditedAtMs` so the per-shape "last touched"
 * field stays accurate for the freehand stroke's incremental build.
 * Caller wraps in `doc.transact(...)`.
 */
export function appendFreehandPoint(
  map: Y.Map<unknown>,
  point: FreehandPoint,
  sessionId: string,
): void {
  const points = readFreehandPoints(map);
  if (points === null) return;
  points.push([point]);
  map.set('lastEditedBy', sessionId);
  map.set('lastEditedAtMs', Date.now());
}

/* ============================================================== *\
   Id helpers
\* ============================================================== */

/**
 * UUID v4 for shape ids. Falls back to a Math.random-based id only on
 * environments lacking `crypto.randomUUID` (older test runners); the
 * fallback is NOT cryptographically secure and is documented inline
 * so a future reviewer does not conclude we deliberately weakened the
 * id derivation.
 */
function generateShapeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback only for ancient runtimes. jsdom + Node 22 + every modern
  // browser supports `crypto.randomUUID`; this path exists so the
  // factory does not throw on a hypothetical Node 18 test runner.
  const hex = (n: number): string => Math.floor(n).toString(16).padStart(2, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) bytes.push(Math.random() * 256);
  // Set version (4) and variant (10xx) per RFC 4122.
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hexBytes = bytes.map((b) => hex(b));
  return (
    `${hexBytes.slice(0, 4).join('')}-` +
    `${hexBytes.slice(4, 6).join('')}-` +
    `${hexBytes.slice(6, 8).join('')}-` +
    `${hexBytes.slice(8, 10).join('')}-` +
    `${hexBytes.slice(10, 16).join('')}`
  );
}

function clampColorSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const n = Math.floor(slot);
  if (n < 0) return 0;
  if (n > 7) return 7;
  return n;
}

export type { ShapeKind };
