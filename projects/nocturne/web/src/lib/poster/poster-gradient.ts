import { getPresetOrDefault } from '@/data/presets';

/**
 * Pure poster-gradient derivation (ADR-004 §3 — the DESIGNED poster).
 *
 * A software-GL headless capture cannot produce a true-GPU frame, so the SSR /
 * no-JS still is an AUTHORED luminous-field gradient evoking each preset rather
 * than a captured pixel frame. This module turns a preset's palette into the
 * handful of layered radial-glow stops the poster + the per-preset directory
 * thumbnails render with — so the still reads as intentional and stays faithful
 * to the live field's colour energy (the same palette the GPU ramps through).
 *
 * Pure (preset id → colour strings), so it is shared by the server-rendered
 * poster (the LCP), the Tier-4 directory thumbnails, and the OG image, and is
 * Vitest-coverable without a GPU or the DOM.
 */

export interface PosterGradient {
  /** The deep stage floor (near-black) the field glows against. */
  base: string;
  /** Three luminous blooms (mid → high → bright accent) for layered glow. */
  glowLow: string;
  glowMid: string;
  glowHigh: string;
  /** The brightest core spark. */
  spark: string;
}

/** A near-black indigo stage floor shared by every poster (theme-invariant). */
const STAGE_FLOOR = '#06070f';

/**
 * Derive the layered glow stops from a preset's palette. The palette runs
 * low-energy → high-energy; the poster maps:
 *   base   → the stage floor (always near-black)
 *   glowLow→ a low-mid palette stop (the ambient wash)
 *   glowMid→ a mid palette stop (the body of the field)
 *   glowHigh→ a high palette stop (the bright bloom)
 *   spark  → the brightest stop (the additive core)
 */
export function posterGradient(presetId: string): PosterGradient {
  const preset = getPresetOrDefault(presetId);
  const p = preset.palette;
  const n = p.length;
  // Robust stop picks across 3..6-stop ramps.
  // The index is clamped into `[0, n - 1]`, so the read is always present; the
  // `?? STAGE_FLOOR` fallback is unreachable but keeps the lookup assertion-free
  // under `noUncheckedIndexedAccess` (array index types as `string | undefined`).
  const at = (frac: number): string =>
    p[Math.min(n - 1, Math.round(frac * (n - 1)))] ?? STAGE_FLOOR;
  return {
    base: STAGE_FLOOR,
    glowLow: at(0.3),
    glowMid: at(0.55),
    glowHigh: at(0.8),
    spark: at(1),
  };
}

/**
 * The full CSS `background` value for a poster surface (a stack of soft radial
 * glows over the deep floor). Deterministic, so the SSR poster and a thumbnail
 * differ only in scale. The blooms are offset so the field reads as a luminous
 * drift, not a single centred spotlight.
 */
export function posterBackground(presetId: string): string {
  const g = posterGradient(presetId);
  return [
    `radial-gradient(60% 50% at 30% 38%, ${g.glowMid} 0%, transparent 62%)`,
    `radial-gradient(46% 42% at 68% 60%, ${g.glowHigh} 0%, transparent 58%)`,
    `radial-gradient(28% 26% at 54% 46%, ${g.spark} 0%, transparent 60%)`,
    `radial-gradient(80% 80% at 50% 30%, ${g.glowLow} 0%, transparent 80%)`,
    `radial-gradient(120% 120% at 50% 50%, ${g.base} 38%, ${STAGE_FLOOR} 100%)`,
  ].join(', ');
}
