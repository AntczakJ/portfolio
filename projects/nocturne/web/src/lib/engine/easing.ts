/**
 * Pure easing functions (Phase 7 Vitest spine).
 *
 * The preset cross-fade is the SIGNATURE transition (a viewer watches the field
 * morph for ~1s), so its progress must run through a designed curve, not a linear
 * ramp (D-03). `easeOutExpo` is the JS twin of the project's CSS
 * `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`) — a fast departure that
 * decelerates hard into the target, so the morph arrives decisively and settles
 * gently. Same curve the intro reveal uses, applied consistently to the field.
 *
 * No three.js, no React — testable without a GPU.
 */

/**
 * easeOutExpo: a strong exponential ease-out. `t` is clamped to [0, 1]; the
 * endpoints land EXACTLY on 0 and 1 (so a settled cross-fade reaches the target
 * preset bit-exactly, matching `lerp`'s endpoint guarantee).
 */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/**
 * easeOutQuart: a gentler polynomial ease-out, retained as an alternative curve.
 * Same clamp + exact-endpoint contract as `easeOutExpo`.
 */
export function easeOutQuart(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 4);
}
