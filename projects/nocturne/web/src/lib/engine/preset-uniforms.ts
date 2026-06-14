import type { Preset } from '@/lib/schemas';

/**
 * The flat, numeric uniform set the engine consumes (Task 3.4, ADR-002 §3).
 *
 * A `Preset` is the authored, structured look; `PresetUniforms` is its flattened
 * numeric projection — the cross-fade BASE the engine lerps between two presets,
 * around which the audio modulates each frame (`uniform = base + gain * band`).
 * Colours are carried separately as the per-stop RGB ramp (lerped channel-wise);
 * the discrete fields (blend, spawn) are NOT interpolated — they switch at the
 * cross-fade midpoint (the engine, Pass 2), so they are not part of this numeric
 * set.
 *
 * This module is PURE — no three.js, no React. It is the testable heart of the
 * preset cross-fade (Phase 7).
 */

/** An RGB triple in [0, 1] per channel. */
export type Rgb = readonly [r: number, g: number, b: number];

/**
 * Black fallback for the `Rgb | undefined` index reads in the resample / lerp
 * loops below. Under `noUncheckedIndexedAccess` a tuple index types as
 * possibly-undefined even when the index is provably in range; this hoisted
 * constant lets those reads use `?? RGB_FALLBACK` (a single, branch-predicted,
 * allocation-free guard) instead of a type assertion. It is never actually
 * reached at runtime because every index is clamped into a valid range.
 */
const RGB_FALLBACK: Rgb = [0, 0, 0];

export interface PresetUniforms {
  // flow
  flowScale: number;
  flowSpeed: number;
  turbulence: number;
  damping: number;
  lifetime: number;
  domainScale: number;
  // particle
  particleSize: number;
  particleOpacity: number;
  trail: number;
  // post
  bloomStrength: number;
  bloomThreshold: number;
  vignette: number;
  aberration: number;
  // audio gains
  bassToTurbulence: number;
  midToSpread: number;
  highToColor: number;
  rmsToBloom: number;
}

/** Parse a `#rrggbb` hex string to an RGB triple in [0, 1]. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/u.exec(hex);
  if (!m) return [0, 0, 0];
  // The regex matched, so all three capture groups are present; the `?? '00'`
  // fallback is unreachable but lets the parse stay assertion-free under
  // `noUncheckedIndexedAccess` (groups type as `string | undefined`).
  const r = Number.parseInt(m[1] ?? '00', 16) / 255;
  const g = Number.parseInt(m[2] ?? '00', 16) / 255;
  const b = Number.parseInt(m[3] ?? '00', 16) / 255;
  return [r, g, b];
}

/** The number of stops a palette ramp is resampled to for interpolation. */
export const RAMP_STOPS = 6;

/**
 * Resample an arbitrary-length palette (3..6 stops) to a fixed `RAMP_STOPS`-long
 * RGB ramp by linear interpolation along the [0,1] parameter, so two presets
 * with different stop counts can be cross-faded stop-for-stop.
 */
export function resampleRamp(palette: readonly string[]): Rgb[] {
  const stops = palette.map(hexToRgb);
  if (stops.length === 0) return Array.from({ length: RAMP_STOPS }, () => [0, 0, 0]);
  if (stops.length === 1) {
    const only = stops[0] ?? RGB_FALLBACK;
    return Array.from({ length: RAMP_STOPS }, () => only);
  }
  const out: Rgb[] = [];
  const lastIndex = stops.length - 1;
  for (let i = 0; i < RAMP_STOPS; i += 1) {
    const t = i / (RAMP_STOPS - 1); // 0..1
    const pos = t * lastIndex;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, lastIndex);
    const f = pos - lo;
    const a = stops[lo] ?? RGB_FALLBACK;
    const b = stops[hi] ?? RGB_FALLBACK;
    out.push([
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ]);
  }
  return out;
}

/** Flatten a `Preset` to its numeric uniform base. */
export function presetToUniforms(preset: Preset): PresetUniforms {
  return {
    flowScale: preset.flow.scale,
    flowSpeed: preset.flow.speed,
    turbulence: preset.flow.turbulence,
    damping: preset.flow.damping,
    lifetime: preset.flow.lifetime,
    domainScale: preset.flow.domainScale,
    particleSize: preset.particle.size,
    particleOpacity: preset.particle.opacity,
    trail: preset.particle.trail,
    bloomStrength: preset.post.bloomStrength,
    bloomThreshold: preset.post.bloomThreshold,
    vignette: preset.post.vignette,
    aberration: preset.post.aberration,
    bassToTurbulence: preset.audio.bassToTurbulence,
    midToSpread: preset.audio.midToSpread,
    highToColor: preset.audio.highToColor,
    rmsToBloom: preset.audio.rmsToBloom,
  };
}

/**
 * Scalar lerp. `t` is clamped to [0, 1] so callers cannot over/undershoot. The
 * endpoints are returned EXACTLY (not `a + (b-a)*0/1`, which floating-point can
 * perturb) so a settled cross-fade lands bit-exactly on the target preset.
 */
export function lerp(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

const UNIFORM_KEYS: readonly (keyof PresetUniforms)[] = [
  'flowScale',
  'flowSpeed',
  'turbulence',
  'damping',
  'lifetime',
  'domainScale',
  'particleSize',
  'particleOpacity',
  'trail',
  'bloomStrength',
  'bloomThreshold',
  'vignette',
  'aberration',
  'bassToTurbulence',
  'midToSpread',
  'highToColor',
  'rmsToBloom',
];

/**
 * Lerp the FULL numeric uniform set between two presets at progress `t` ∈ [0,1].
 * `t = 0` returns `from` exactly; `t = 1` returns `to` exactly.
 */
export function lerpPresetUniforms(
  from: PresetUniforms,
  to: PresetUniforms,
  t: number,
): PresetUniforms {
  const out = {} as Record<keyof PresetUniforms, number>;
  for (const key of UNIFORM_KEYS) {
    out[key] = lerp(from[key], to[key], t);
  }
  return out;
}

/** Lerp two equal-length RGB ramps channel-wise at progress `t`. */
export function lerpRamp(from: readonly Rgb[], to: readonly Rgb[], t: number): Rgb[] {
  const len = Math.min(from.length, to.length);
  const out: Rgb[] = [];
  for (let i = 0; i < len; i += 1) {
    const a = from[i] ?? RGB_FALLBACK;
    const b = to[i] ?? RGB_FALLBACK;
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  return out;
}

/**
 * Cross-fade two presets into a single interpolated uniform set + ramp at
 * progress `t`. The convenience the engine calls each frame during a preset
 * transition (the discrete blend/spawn fields it switches at `t >= 0.5`).
 */
export interface InterpolatedLook {
  uniforms: PresetUniforms;
  ramp: Rgb[];
}

export function crossfadePresets(
  from: Preset,
  to: Preset,
  t: number,
): InterpolatedLook {
  return {
    uniforms: lerpPresetUniforms(
      presetToUniforms(from),
      presetToUniforms(to),
      t,
    ),
    ramp: lerpRamp(resampleRamp(from.palette), resampleRamp(to.palette), t),
  };
}
