import { z } from 'zod';

/**
 * The capability/tier config (ADR-002 §4 / ADR-004 §1). The output of
 * `detectGpuTier()` — the particle count (the sim FBO dimension N → N²
 * particles), the DPR clamp, the post quality, and the routing decision the
 * `/` stage uses to mount the live field, the calm-drift field, or the Tier-4
 * poster.
 */

/** The performance tier name (ADR-002 §4 tier table). */
export const tierNameSchema = z.enum(['low', 'mid', 'high', 'ultra']);
export type TierName = z.infer<typeof tierNameSchema>;

/** What the `/` stage actually renders (ADR-004 §1 decision tree). */
export const renderRouteSchema = z.enum([
  /** The full live GPGPU field (Tier 1/2 — capable, motion OK). */
  'live',
  /** The reduced-motion calm autonomous drift (Tier 3-RM). */
  'calm',
  /** The static AVIF poster + preset directory DOM (Tier 4 — no WebGL/no float). */
  'poster',
]);
export type RenderRoute = z.infer<typeof renderRouteSchema>;

/** The post-processing quality rung the tier permits (ADR-002 §4). */
export const postQualitySchema = z.enum([
  'bloom-only', // low: bloom, no aberration/vignette
  'bloom-vignette', // mid: bloom + vignette
  'full', // high/ultra: bloom + vignette + aberration
]);
export type PostQuality = z.infer<typeof postQualitySchema>;

export const tierConfigSchema = z.object({
  tier: tierNameSchema,
  route: renderRouteSchema,
  /** The sim FBO dimension N (N×N texture → N² particles). */
  simResolution: z.number().int().min(64).max(2048),
  /** The particle count (N², for the README tier table + the a11y text). */
  particleCount: z.number().int().min(0),
  /** The render DPR clamp `[min, max]`. */
  dprClamp: z.tuple([z.number().min(0.5).max(3), z.number().min(0.5).max(3)]),
  postQuality: postQualitySchema,
  /** Whether the field reacts to audio (false under reduced-motion calm drift). */
  audioReactive: z.boolean(),
  /** Whether the pointer/touch wake is active (gentle/off under reduced-motion). */
  pointerWake: z.boolean(),
  /** Why this route was chosen (diagnostics + the a11y/About copy). */
  reason: z.string().min(1),
});
export type TierConfig = z.infer<typeof tierConfigSchema>;
