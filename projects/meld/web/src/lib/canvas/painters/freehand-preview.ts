/**
 * Freehand preview painter — ADR-010 option F2.
 *
 * Renders the in-progress pen stroke onto the overlay's dedicated
 * preview canvas while the user drags, BEFORE the single Yjs commit on
 * pointerup. This mirrors how `paintPreviewRect` (inline in the pointer
 * overlay) paints the rectangle/ellipse draft: a synchronous local
 * Canvas2D draw at pointer cadence, no Yjs round-trip.
 *
 * The polyline geometry intentionally matches `paintFreehand` in
 * `painters/shapes.ts` (quadratic-Bezier-through-midpoints smoothing,
 * 2 px round-capped stroke) so the live preview is visually identical
 * to the committed shape — the stroke does not "jump" on release.
 *
 * Coordinate convention matches the draft + the committed shape:
 * `baseX`/`baseY` is the stroke origin (canvas/board space) and each
 * point is an OFFSET from that base.
 */

import type { FreehandPoint } from '@/lib/shapes/types';

export interface FreehandPreviewDraft {
  readonly baseX: number;
  readonly baseY: number;
  points(): readonly FreehandPoint[];
}

/**
 * Paint the stroke-so-far. `color` is the resolved awareness-slot
 * color string (the overlay reads it via `getComputedStyle` once per
 * preview frame, same as the rect preview). The caller is responsible
 * for clearing the preview canvas before calling — but for symmetry
 * with `paintPreviewRect` (which clears itself) this painter also
 * clears the supplied rect first.
 */
export function paintPreviewFreehand(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  draft: FreehandPreviewDraft,
  color: string,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const points = draft.points();
  if (points.length === 0) return;

  const { baseX, baseY } = draft;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const first = points[0];
  if (first === undefined) return;
  let prevX = baseX + first.x;
  let prevY = baseY + first.y;
  ctx.moveTo(prevX, prevY);

  if (points.length === 1) {
    // Single dot — a tiny line to itself so the round cap renders a
    // visible point (matches the committed-shape painter).
    ctx.lineTo(prevX + 0.01, prevY + 0.01);
    ctx.stroke();
    return;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const next = points[i + 1];
    if (p === undefined || next === undefined) continue;
    const px = baseX + p.x;
    const py = baseY + p.y;
    const midX = (px + baseX + next.x) / 2;
    const midY = (py + baseY + next.y) / 2;
    ctx.quadraticCurveTo(px, py, midX, midY);
    prevX = midX;
    prevY = midY;
  }

  const last = points[points.length - 1];
  if (last !== undefined) {
    ctx.lineTo(baseX + last.x, baseY + last.y);
  }
  ctx.stroke();
}
