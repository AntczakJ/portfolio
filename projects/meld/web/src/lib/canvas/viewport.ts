/**
 * Viewport — CSS-pixel rectangle the canvas paint pipeline operates on.
 *
 * Origin: top-left of the canvas element. Width / height: the canvas's
 * CSS dimensions (NOT its `.width` / `.height` backing-store dimensions —
 * those are CSS dims × DPR, written via `handleResize`). The engine
 * applies a `ctx.scale(dpr, dpr)` so the painter pipeline draws in CSS
 * pixels regardless of device pixel density.
 *
 * Phase 3.2 will extend this with pan / zoom math (`screenToBoard` +
 * `boardToScreen` inverses); Phase 2.6 just needs the bounds for the
 * background fill + the grid hairlines.
 */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}
