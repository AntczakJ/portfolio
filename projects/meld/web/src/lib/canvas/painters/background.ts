import type { Viewport } from '../viewport';

/**
 * Fills the entire viewport with the canvas background color. Wipes
 * any pixels left from the previous frame. The painter does NOT call
 * `ctx.save` / `ctx.restore` — the engine wraps every paint pass in
 * a single transform reset (via `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`
 * inside `handleResize` and re-applied each tick if needed), so
 * per-painter pairs would be redundant allocation noise on the hot path.
 *
 * Pattern lifted from tape's `paintBackground` (allowed per § 14 —
 * patterns port, tokens do not). meld's background is `--color-bg`
 * (warm off-white in light, deep graphite in dark) read from the
 * theme bridge snapshot.
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  bgColor: string,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
}
