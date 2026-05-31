import type { Viewport } from '../scale';

/**
 * Fills the entire viewport with the canvas background color. Wipes
 * any pixels left from the previous frame. The painter does NOT call
 * `ctx.save` / `ctx.restore` — the engine wraps the whole frame in
 * a single save/restore pair, so per-painter pairs would be redundant
 * allocation noise on the hot path.
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  bgColor: string,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
}
