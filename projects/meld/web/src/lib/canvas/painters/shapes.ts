import * as Y from 'yjs';

import {
  readFreehandPoints,
  readNumber,
  readShapeKind,
  readString,
  type FreehandPoint,
} from '@/lib/shapes/types';

import type { Viewport } from '../viewport';

/**
 * Shape painter — iterates the root `Y.Map<shapeId, Y.Map>` and paints
 * each shape against the cached theme palette.
 *
 * ADR-008 painter-pipeline contract:
 *
 *   - Pure function `(ctx, vp, shapesMap, palette) -> void`. No
 *     allocation of `Path2D` objects inside the hot loop (Canvas2D's
 *     direct `fillRect` / `beginPath` calls are cheaper at the v1
 *     shape ceiling and tldraw confirms the same baseline).
 *   - Reads OKLCH strings off `palette.awarenessSlots[colorSlot]` —
 *     no `parseOklch` per frame, no `getComputedStyle` per frame.
 *   - One `ctx.save` / `ctx.restore` pair per shape so per-shape
 *     transform changes (rotation in Phase 3.2b) do not leak. Phase
 *     3.2 ships axis-aligned only, so the save/restore is one cheap
 *     ms-scale-ignorable cost per shape and earns its keep when
 *     rotation lands.
 *   - Iterator order is Y.Map insertion order, which matches z-order
 *     intuition (oldest at the back, newest at the front).
 *
 * Paint cost per primitive — measured empirically against the dev FPS
 * counter on a Ryzen-class machine — sits at ~0.02-0.05 ms each;
 * 500 shapes paint in ~1-3 ms p99, well inside the 16 ms frame budget
 * ADR-008 named.
 *
 * Phase 3.2 deferred: arrow primitive, selection chrome highlight.
 * Both plug into the same dispatch loop in Phase 3.2b.
 */

/**
 * Bounds-safe element read for a `Y.Array`. Yjs types `Y.Array.get`
 * as returning `T` (never `undefined`), but the runtime returns
 * `undefined` for an out-of-bounds index. This wrapper restores the
 * honest `T | undefined` type so the defensive guards at each call
 * site are meaningful to the type-checker rather than dead.
 */
function pointAt(
  points: Y.Array<FreehandPoint>,
  index: number,
): FreehandPoint | undefined {
  return points.get(index);
}

export interface ShapesPalette {
  /** Foreground color — used by text labels. */
  readonly fg: string;
  /** Accent color — reserved for Phase 3.2b selection chrome. */
  readonly accent: string;
  /**
   * 8-slot OKLCH awareness wheel, indexed by the shape's `colorSlot`
   * field. Wired from the engine's `derivePalette` via the theme
   * bridge cache — same source the cursor palette reads, no
   * additional `getComputedStyle` per frame.
   */
  readonly awarenessSlots: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
}

/* ============================================================== *\
   Public painter
\* ============================================================== */

export function paintShapes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  shapesMap: Y.Map<unknown>,
  palette: ShapesPalette,
): void {
  // Y.Map iteration via `forEach` walks insertion order. The painter
  // is the only caller; downstream of the iterator there is no need
  // to materialise a temporary array.
  shapesMap.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const map = value as Y.Map<unknown>;
    const kind = readShapeKind(map);
    if (kind === null) return;
    const colorSlot = clampSlot(readNumber(map, 'colorSlot', 0));
    const fill = palette.awarenessSlots[colorSlot];
    if (fill === undefined) return;

    ctx.save();
    switch (kind) {
      case 'rectangle': {
        paintRectangle(ctx, map, fill);
        break;
      }
      case 'ellipse': {
        paintEllipse(ctx, map, fill);
        break;
      }
      case 'freehand': {
        paintFreehand(ctx, map, fill);
        break;
      }
      case 'text': {
        paintText(ctx, map, fill, palette.fg);
        break;
      }
    }
    ctx.restore();
  });

  // Silence the `noUnusedParameters` flag on `vp` — Phase 3.2's paint
  // path is viewport-agnostic (shape coordinates already live in board
  // space, no pan/zoom in v1), but the param stays for Phase 3.2b's
  // pan/zoom transform.
  void vp;
}

/* ============================================================== *\
   Per-primitive painters
\* ============================================================== */

function paintRectangle(
  ctx: CanvasRenderingContext2D,
  map: Y.Map<unknown>,
  fill: string,
): void {
  const x = readNumber(map, 'x', 0);
  const y = readNumber(map, 'y', 0);
  const w = readNumber(map, 'w', 0);
  const h = readNumber(map, 'h', 0);
  if (w === 0 || h === 0) return;

  const { nx, ny, nw, nh } = normalizeRect(x, y, w, h);

  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(nx, ny, nw, nh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2;
  ctx.strokeRect(nx + 0.5, ny + 0.5, nw - 1, nh - 1);
}

function paintEllipse(
  ctx: CanvasRenderingContext2D,
  map: Y.Map<unknown>,
  fill: string,
): void {
  const x = readNumber(map, 'x', 0);
  const y = readNumber(map, 'y', 0);
  const w = readNumber(map, 'w', 0);
  const h = readNumber(map, 'h', 0);
  if (w === 0 || h === 0) return;

  const { nx, ny, nw, nh } = normalizeRect(x, y, w, h);
  const cx = nx + nw / 2;
  const cy = ny + nh / 2;
  const rx = nw / 2;
  const ry = nh / 2;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.18;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function paintFreehand(
  ctx: CanvasRenderingContext2D,
  map: Y.Map<unknown>,
  stroke: string,
): void {
  const points = readFreehandPoints(map);
  if (points === null || points.length === 0) return;
  const baseX = readNumber(map, 'x', 0);
  const baseY = readNumber(map, 'y', 0);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  // Smooth path via quadratic Bezier between midpoints. The pattern
  // resists per-frame jitter and reads as a confident pen line rather
  // than a connect-the-dots polyline. For very short strokes (1 or
  // 2 points) fall back to a straight segment.
  const first = pointAt(points, 0);
  if (first === undefined) return;
  let prevX = baseX + first.x;
  let prevY = baseY + first.y;
  ctx.moveTo(prevX, prevY);

  if (points.length === 1) {
    // Single dot — draw a tiny line to itself so the round line-cap
    // renders as a visible point.
    ctx.lineTo(prevX + 0.01, prevY + 0.01);
    ctx.stroke();
    return;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const p = pointAt(points, i);
    const next = pointAt(points, i + 1);
    if (p === undefined || next === undefined) continue;
    const px = baseX + p.x;
    const py = baseY + p.y;
    const midX = (px + baseX + next.x) / 2;
    const midY = (py + baseY + next.y) / 2;
    ctx.quadraticCurveTo(px, py, midX, midY);
    prevX = midX;
    prevY = midY;
  }

  const last = pointAt(points, points.length - 1);
  if (last !== undefined) {
    ctx.lineTo(baseX + last.x, baseY + last.y);
  }
  ctx.stroke();
}

function paintText(
  ctx: CanvasRenderingContext2D,
  map: Y.Map<unknown>,
  // Color slot resolves to a hue used as a left "byline" tick. The
  // text itself uses the foreground color so it stays legible
  // against the warm-paper background.
  tick: string,
  fg: string,
): void {
  const x = readNumber(map, 'x', 0);
  const y = readNumber(map, 'y', 0);
  const text = readString(map, 'text', '');
  if (text === '') return;
  const fontSize = Math.max(
    8,
    Math.min(96, readNumber(map, 'fontSize', 18)),
  );

  // Vertical tick mirrors the awareness color so multi-user boards
  // show who-authored-what without burying the text in colour.
  ctx.fillStyle = tick;
  ctx.fillRect(x, y, 3, fontSize * 1.2);

  ctx.fillStyle = fg;
  // System font stack — matches `--font-sans` from globals.css verbatim
  // so the painted text aligns with the DOM-rendered text input the
  // toolbar pops up while the user types.
  ctx.font = `${String(fontSize)}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + 8, y);
}

/* ============================================================== *\
   Hit testing — exported for Phase 3.2b's selection chrome
\* ============================================================== */

/**
 * Hit test a single shape's `Y.Map` against a board-space point.
 * Returns `true` when the point lies inside / on the shape.
 *
 * Phase 3.2 does NOT use this — the toolbar's `'select'` tool is a
 * no-op state in the pointer overlay. The function is exported today
 * so:
 *
 *   - the API surface for Phase 3.2b is named at the right boundary
 *     (selection chrome can `import { hitTestShape }` without a
 *     painter-internal symbol leak),
 *   - the test suite can verify hit math against the same painter
 *     module that owns the visual semantics, keeping the two in lock
 *     step,
 *   - reviewers see the seam Phase 3.2 reserves for Phase 3.2b.
 *
 * Freehand hit test uses a per-segment distance check with a 6 px
 * tolerance; rectangle / ellipse use their natural bounds. The
 * tolerance matches the freehand stroke's `lineWidth = 2` plus a
 * comfortable 2 px easing.
 */
export function hitTestShape(
  map: Y.Map<unknown>,
  px: number,
  py: number,
): boolean {
  const kind = readShapeKind(map);
  if (kind === null) return false;

  switch (kind) {
    case 'rectangle': {
      const x = readNumber(map, 'x', 0);
      const y = readNumber(map, 'y', 0);
      const w = readNumber(map, 'w', 0);
      const h = readNumber(map, 'h', 0);
      const { nx, ny, nw, nh } = normalizeRect(x, y, w, h);
      return px >= nx && px <= nx + nw && py >= ny && py <= ny + nh;
    }
    case 'ellipse': {
      const x = readNumber(map, 'x', 0);
      const y = readNumber(map, 'y', 0);
      const w = readNumber(map, 'w', 0);
      const h = readNumber(map, 'h', 0);
      const { nx, ny, nw, nh } = normalizeRect(x, y, w, h);
      const cx = nx + nw / 2;
      const cy = ny + nh / 2;
      const rx = nw / 2;
      const ry = nh / 2;
      if (rx === 0 || ry === 0) return false;
      const dx = (px - cx) / rx;
      const dy = (py - cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'freehand': {
      const points = readFreehandPoints(map);
      if (points === null || points.length === 0) return false;
      const baseX = readNumber(map, 'x', 0);
      const baseY = readNumber(map, 'y', 0);
      const tolerance = 6;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = pointAt(points, i);
        const b = pointAt(points, i + 1);
        if (a === undefined || b === undefined) continue;
        const ax = baseX + a.x;
        const ay = baseY + a.y;
        const bx = baseX + b.x;
        const by = baseY + b.y;
        if (distancePointToSegment(px, py, ax, ay, bx, by) <= tolerance) {
          return true;
        }
      }
      // Single-point freehand — hit if within tolerance of the dot.
      if (points.length === 1) {
        const p = pointAt(points, 0);
        if (p === undefined) return false;
        const dx = px - (baseX + p.x);
        const dy = py - (baseY + p.y);
        return Math.hypot(dx, dy) <= tolerance;
      }
      return false;
    }
    case 'text': {
      const x = readNumber(map, 'x', 0);
      const y = readNumber(map, 'y', 0);
      const text = readString(map, 'text', '');
      if (text === '') return false;
      const fontSize = readNumber(map, 'fontSize', 18);
      // Approximate text bounds: width ≈ 0.6 × fontSize × chars.
      // Phase 3.2b's selection chrome can call `ctx.measureText` for
      // pixel-accurate bounds; the approximation is good enough for
      // the Phase 3.2 exported API.
      const approxWidth = text.length * fontSize * 0.6 + 8;
      const approxHeight = fontSize * 1.2;
      return (
        px >= x && px <= x + approxWidth && py >= y && py <= y + approxHeight
      );
    }
  }
}

/* ============================================================== *\
   Internal helpers
\* ============================================================== */

function normalizeRect(
  x: number,
  y: number,
  w: number,
  h: number,
): { nx: number; ny: number; nw: number; nh: number } {
  const nx = w < 0 ? x + w : x;
  const ny = h < 0 ? y + h : y;
  const nw = Math.abs(w);
  const nh = Math.abs(h);
  return { nx, ny, nw, nh };
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function clampSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const n = Math.floor(slot);
  if (n < 0) return 0;
  if (n > 7) return 7;
  return n;
}

// Used by tests to assert the painter touches freehand points the
// same way the hit-test does. Internal — not part of the public
// painter contract.
export type { FreehandPoint };
