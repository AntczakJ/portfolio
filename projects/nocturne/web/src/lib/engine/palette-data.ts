import type { Rgb } from '@/lib/engine/preset-uniforms';

/**
 * Pure palette-ramp → 1D-gradient-texture data (ADR-002 §2).
 *
 * The render fragment shader samples a 1D RGB gradient by particle energy. This
 * builds the `width × 1` RGBA8 pixel data from an RGB ramp (the cross-fade output
 * `Rgb[]` from `crossfadePresets`), linearly interpolating between stops across
 * the texture width. Pure (ramp + width → Uint8Array), so it is Vitest-coverable
 * without a GPU: the endpoints land on the first/last stop and the midpoint is
 * the average of two adjacent stops.
 */

/** The 1D gradient texture width (smooth enough for an energy ramp). */
export const PALETTE_TEXTURE_WIDTH = 256;

/**
 * Black fallback for the `Rgb | undefined` index reads below. Under
 * `noUncheckedIndexedAccess` a tuple index is typed as possibly-undefined even
 * when the index is provably in range; this hoisted constant lets the reads use
 * `?? RGB_FALLBACK` (a single, branch-predicted, allocation-free guard) instead
 * of a type assertion — it is never actually reached at runtime because every
 * index is clamped into `[0, lastIndex]`.
 */
const RGB_FALLBACK: Rgb = [0, 0, 0];

function clampByte(v: number): number {
  const b = Math.round(v * 255);
  if (b < 0) return 0;
  if (b > 255) return 255;
  return b;
}

/**
 * Build `width × 1` RGBA8 data interpolating the ramp stops across the width.
 * Alpha is fully opaque (the particle shader owns opacity).
 */
export function buildPaletteData(
  ramp: readonly Rgb[],
  width: number = PALETTE_TEXTURE_WIDTH,
): Uint8Array {
  const data = new Uint8Array(width * 4);
  if (ramp.length === 0) {
    for (let x = 0; x < width; x += 1) data[x * 4 + 3] = 255;
    return data;
  }
  if (ramp.length === 1) {
    const only = ramp[0] ?? RGB_FALLBACK;
    for (let x = 0; x < width; x += 1) {
      data[x * 4] = clampByte(only[0]);
      data[x * 4 + 1] = clampByte(only[1]);
      data[x * 4 + 2] = clampByte(only[2]);
      data[x * 4 + 3] = 255;
    }
    return data;
  }

  const lastIndex = ramp.length - 1;
  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1); // 0..1
    const pos = t * lastIndex;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, lastIndex);
    const f = pos - lo;
    const a = ramp[lo] ?? RGB_FALLBACK;
    const b = ramp[hi] ?? RGB_FALLBACK;
    data[x * 4] = clampByte(a[0] + (b[0] - a[0]) * f);
    data[x * 4 + 1] = clampByte(a[1] + (b[1] - a[1]) * f);
    data[x * 4 + 2] = clampByte(a[2] + (b[2] - a[2]) * f);
    data[x * 4 + 3] = 255;
  }
  return data;
}
