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

/**
 * WHY a `poster`-route config fell back, as a stable discriminator (so the UI
 * can show the right message — ADR-002/ADR-004 decision tree). Distinct from the
 * free-text `reason` (diagnostics copy): this is the machine-readable cause.
 *
 *   - `no-window`      — SSR / no `window` (the server floor).
 *   - `no-webgl2`      — no WebGL2 context at all (a capability FLOOR).
 *   - `no-float`       — WebGL2 present but `EXT_color_buffer_float` absent
 *                        (no GPGPU float ping-pong possible — a capability FLOOR).
 *   - `software-webgl` — WebGL2 + float present but the renderer is SOFTWARE
 *                        (SwiftShader / llvmpipe / a major-perf-caveat-only
 *                        context): the heavy GPGPU field would run on the CPU, so
 *                        we route to the poster. This is the ONE reason the UI
 *                        offers a fixable "enable hardware acceleration" hint —
 *                        the floors are not user-fixable.
 *   - `null`           — not a poster route (live / calm).
 */
export const posterReasonSchema = z.enum([
  'no-window',
  'no-webgl2',
  'no-float',
  'software-webgl',
]);
export type PosterReason = z.infer<typeof posterReasonSchema>;

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
  /**
   * The machine-readable cause of a `poster` fallback (`null` on live/calm). The
   * UI shows the hardware-acceleration hint ONLY when this is `software-webgl`.
   * Defaults to `null` so non-poster configs (and callers that omit it) parse.
   */
  posterReason: posterReasonSchema.nullable().default(null),
});
export type TierConfig = z.infer<typeof tierConfigSchema>;
