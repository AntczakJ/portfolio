/**
 * Crosshair + hovered-cell highlight painter (Phase 3.2).
 *
 * Renders three things, in this order, on top of cells + tape strip and
 * BELOW the axes (so axis labels stay legible over the crosshair):
 *
 *   1. A soft rounded-square halo at the cursor intersection — the
 *      "cursor weight" visual that anchors the eye.
 *   2. Full-width / full-height crosshair lines anchored at the cursor
 *      pixel. Vertical spans the bar region top-to-bottom; horizontal
 *      spans the bar region left-to-right (NOT the entire viewport — we
 *      do not draw across the axis bands).
 *   3. A 1-px stroke around the hovered cell's pixel rectangle — pops
 *      the focused cell without a full re-fill, so the cell palette
 *      from `paintCells` stays untouched.
 *
 * Skipped entirely when `cursorPx === null` (mouse left the chart). The
 * engine's dirty-flag gate keeps this from running on idle frames.
 *
 * Frame budget: 4 line draws + 1 rounded-rect fill + 1 stroke. Inside
 * the ~3-4 ms / frame headroom called out in AGENT_NOTES Phase 3.1.
 *
 * All coordinates are CSS pixels — the engine has already applied
 * `ctx.scale(dpr, dpr)` in `handleResize`, painters never re-multiply.
 * The 1-device-pixel hairline trick (`1 / dpr` line width + 0.5/dpr
 * pixel-grid snap) matches the existing `paintCells` / `paintAxes`
 * convention.
 */
import {
  bucketTsToX,
  chartConfig,
  priceToY,
  type BarRegion,
  type ChartScale,
} from '../scale';

export interface CursorPalette {
  /** Crosshair line + focused-cell stroke. */
  line: string;
  /** Halo composited around the intersection. Carries its own alpha. */
  glow: string;
}

/** Pixel coords (CSS pixels) relative to the canvas top-left. */
export interface CursorPx {
  x: number;
  y: number;
}

/** Cell coords derived from `CursorPx` via the scale inverses. */
export interface CursorCell {
  bucketTs: number;
  priceBucket: number;
}

/** Halo box size in CSS pixels. ~24 wide × 16 tall = one cell footprint. */
const HALO_WIDTH = chartConfig.cellWidth;
const HALO_HEIGHT = chartConfig.cellHeight;
const HALO_PAD = 4;

/** Crosshair line alpha — strong enough to read, soft enough to not
 * fight the cell palette. */
const CROSSHAIR_ALPHA = 0.85;

/** Focused-cell stroke alpha. Higher than crosshair so the cell pops. */
const FOCUS_STROKE_ALPHA = 0.95;

export function paintCursor(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  scale: ChartScale,
  cursorPx: CursorPx | null,
  cursorCell: CursorCell | null,
  palette: CursorPalette,
  dpr: number,
): void {
  if (cursorPx === null) return;
  if (region.h <= 0 || region.w <= 0) return;

  // Clamp crosshair to the bar region so it does not bleed over the
  // axes (which paint after this pass anyway, but explicit is better
  // than relying on overdraw).
  const x = clamp(cursorPx.x, region.x, region.x + region.w);
  const y = clamp(cursorPx.y, region.y, region.y + region.h);

  const prevAlpha = ctx.globalAlpha;
  const prevLineWidth = ctx.lineWidth;
  const prevStroke = ctx.strokeStyle;
  const prevFill = ctx.fillStyle;

  // ---- 1. Halo at the intersection. Drawn first so the crosshair
  // lines sit on top of it.
  ctx.fillStyle = palette.glow;
  ctx.globalAlpha = 1; // halo color carries its own alpha
  ctx.fillRect(
    Math.round(x - HALO_WIDTH / 2 - HALO_PAD),
    Math.round(y - HALO_HEIGHT / 2 - HALO_PAD),
    HALO_WIDTH + HALO_PAD * 2,
    HALO_HEIGHT + HALO_PAD * 2,
  );

  // ---- 2. Crosshair lines. 1 device pixel wide, snapped to the
  // pixel grid via the +0.5/dpr trick the other painters use.
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1 / dpr;
  ctx.globalAlpha = CROSSHAIR_ALPHA;
  const snap = 0.5 / dpr;

  // Vertical.
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + snap, region.y);
  ctx.lineTo(Math.round(x) + snap, region.y + region.h);
  ctx.stroke();

  // Horizontal.
  ctx.beginPath();
  ctx.moveTo(region.x, Math.round(y) + snap);
  ctx.lineTo(region.x + region.w, Math.round(y) + snap);
  ctx.stroke();

  // ---- 3. Focused-cell stroke. Outlines the cell that contains the
  // cursor — we compute its pixel rectangle via the scale forwards
  // rather than reusing the cell painter's geometry, because the
  // cursor may sit on a cell that has no recorded volume (and thus
  // is not in the rendered cells array).
  if (cursorCell !== null) {
    const cellX = bucketTsToX(scale, cursorCell.bucketTs);
    if (Number.isFinite(cellX)) {
      const cellYCentre = priceToY(scale, cursorCell.priceBucket);
      const cellY = cellYCentre - chartConfig.cellHeight / 2;

      // Only stroke when the cell is at least partially inside the bar
      // region. Outside-region cursor positions still get the crosshair
      // but not the focus ring.
      const inside =
        cellX + chartConfig.cellWidth >= region.x &&
        cellX <= region.x + region.w &&
        cellY + chartConfig.cellHeight >= region.y &&
        cellY <= region.y + region.h;
      if (inside) {
        ctx.globalAlpha = FOCUS_STROKE_ALPHA;
        ctx.strokeRect(
          Math.round(cellX) + snap,
          Math.round(cellY) + snap,
          chartConfig.cellWidth,
          chartConfig.cellHeight,
        );
      }
    }
  }

  ctx.globalAlpha = prevAlpha;
  ctx.lineWidth = prevLineWidth;
  ctx.strokeStyle = prevStroke;
  ctx.fillStyle = prevFill;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
