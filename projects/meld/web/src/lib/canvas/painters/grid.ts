import type { Viewport } from '../viewport';

/**
 * Subtle 50 px grid hairlines. Phase 2.6 ships this as a calm
 * orientation aid on the otherwise empty board — it gives the viewer
 * a sense of "this is a canvas you can draw on" before Phase 3.2 lands
 * the toolbar. Tldraw + Figma both ship a similar grid; meld's spacing
 * (50 px) sits between Figma's 8 px micro-grid and tldraw's 32 px
 * coarse grid, picked so the grid reads as "paper texture" rather than
 * "drafting table".
 *
 * Stroke width is 1 CSS pixel; on a HiDPI canvas the engine's
 * `ctx.scale(dpr, dpr)` keeps that visually consistent.
 *
 * Color is the `--color-border` token (low-contrast warm grey in light,
 * subtle violet-grey in dark) so the grid never competes with shapes
 * for attention.
 *
 * Future toggle: a Phase 3.x viewer preference may hide the grid.
 * Reserved at the engine API level — pass an undefined `gridColor`
 * (or wrap the call site behind a boolean) to no-op.
 */
const GRID_SPACING = 50;

export function paintGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  gridColor: string,
): void {
  if (vp.w <= 0 || vp.h <= 0) return;

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Verticals. Start at `GRID_SPACING` so we do not paint a line
  // exactly on the left edge (a flush-left hairline reads as a
  // chrome divider, not a grid line — counter-productive). Same for
  // the top edge below.
  for (let x = GRID_SPACING; x < vp.w; x += GRID_SPACING) {
    // 0.5 px offset = crisp 1-px stroke on integer-pixel canvases.
    // The DPR scale the engine applies preserves the offset under
    // HiDPI.
    const xAligned = Math.floor(x) + 0.5;
    ctx.moveTo(xAligned, 0);
    ctx.lineTo(xAligned, vp.h);
  }

  // Horizontals.
  for (let y = GRID_SPACING; y < vp.h; y += GRID_SPACING) {
    const yAligned = Math.floor(y) + 0.5;
    ctx.moveTo(0, yAligned);
    ctx.lineTo(vp.w, yAligned);
  }

  ctx.stroke();
}
