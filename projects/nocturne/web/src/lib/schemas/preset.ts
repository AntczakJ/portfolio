import { z } from 'zod';

/**
 * The Preset shape (Task 3.1, ADR-002 §3 / ADR-003 §4 / ADR-004).
 *
 * A preset is a complete, coherent LOOK: the palette ramp the particle energy
 * maps through, the flow field parameters, the particle treatment, the
 * cinematic post mix, and the per-preset audio-reactivity gains (a "molten"
 * preset reacts harder than a "glacial" one). Every numeric uniform field here
 * is a CROSS-FADE BASE — the engine lerps the whole set between two presets
 * over a duration (Task 3.4), and the audio modulates AROUND the cross-faded
 * base (`uniform = base + gain * smoothed-band`, ADR-003 §4).
 *
 * Ranges are deliberately bounded so the pure interpolator + the engine never
 * receive a value that blows up the sim (e.g. a negative lifetime). The Zod
 * schema validates every curated preset at module load (Task 3.2), so a
 * malformed look fails fast at build/test time, not at GPU time.
 */

/** A 6-character `#rrggbb` hex colour (the palette-ramp stop encoding). */
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, 'expected a #rrggbb hex colour');

/** The particle render blend mode. */
export const blendModeSchema = z.enum(['additive', 'alpha']);
export type BlendMode = z.infer<typeof blendModeSchema>;

/** The spawn-shape the field seeds + respawns into (ADR-002 §1). */
export const spawnShapeSchema = z.enum(['sphere', 'box', 'shell', 'disc']);
export type SpawnShape = z.infer<typeof spawnShapeSchema>;

/**
 * The palette ramp — 3..6 ordered colour stops the particle energy is sampled
 * through (low energy → first stop, high energy → last). Baked into a 1D
 * gradient texture by the render shader (Pass 2).
 */
export const paletteRampSchema = z
  .array(hexColor)
  .min(3, 'a palette ramp needs at least 3 stops')
  .max(6, 'a palette ramp is capped at 6 stops');
export type PaletteRamp = z.infer<typeof paletteRampSchema>;

/** Flow-field (curl-noise advection) base parameters. */
export const flowParamsSchema = z.object({
  /** Noise frequency — larger = tighter, more detailed swirls (`uFlowScale`). */
  scale: z.number().min(0.05).max(8),
  /** Advection speed (`uFlowSpeed`). */
  speed: z.number().min(0).max(4),
  /** Curl turbulence base, before the bass surge (`uTurbulence`). */
  turbulence: z.number().min(0).max(3),
  /** Velocity damping per step — higher = snappier settling (`uDamping`). */
  damping: z.number().min(0).max(1),
  /** Particle lifetime in seconds before respawn (`uLifetime`). */
  lifetime: z.number().min(1).max(60),
  /** The half-extent of the field domain (the bounded box positions live in). */
  domainScale: z.number().min(0.25).max(8),
});
export type FlowParams = z.infer<typeof flowParamsSchema>;

/** Render-particle treatment base parameters. */
export const particleParamsSchema = z.object({
  /** Base point size in px before attenuation/sparkle (`uParticleSize`). */
  size: z.number().min(0.5).max(12),
  /** Base opacity (`uParticleOpacity`). */
  opacity: z.number().min(0).max(1),
  blend: blendModeSchema,
  spawn: spawnShapeSchema,
  /** Trail feedback amount [0,1] — 0 = crisp points, →1 = longer velocity smear. */
  trail: z.number().min(0).max(1),
});
export type ParticleParams = z.infer<typeof particleParamsSchema>;

/** Cinematic post-processing base mix (ADR-002 §3). */
export const postParamsSchema = z.object({
  /** Bloom intensity base, before the rms breathing (`uBloomStrength`). */
  bloomStrength: z.number().min(0).max(4),
  /** Bloom luminance threshold (`uBloomThreshold`). */
  bloomThreshold: z.number().min(0).max(1),
  /** Vignette darkness base (`uVignette`). */
  vignette: z.number().min(0).max(1),
  /** Chromatic-aberration amount base (`uAberration`). */
  aberration: z.number().min(0).max(0.02),
});
export type PostParams = z.infer<typeof postParamsSchema>;

/**
 * Per-preset audio-reactivity gains (ADR-003 §4). Each is the `gain` in
 * `uniform = base + gain * smoothed-band`; 0 = inert to that band. A "molten"
 * preset uses large gains (reacts hard); a "glacial" preset uses small ones.
 */
export const audioGainsSchema = z.object({
  /** bass → uTurbulence + uFlowEnergy. */
  bassToTurbulence: z.number().min(0).max(4),
  /** mid → uSpread. */
  midToSpread: z.number().min(0).max(4),
  /** high → uColorShift + uSparkle. */
  highToColor: z.number().min(0).max(4),
  /** rms → uBloomStrength + uVignette. */
  rmsToBloom: z.number().min(0).max(4),
});
export type AudioGains = z.infer<typeof audioGainsSchema>;

/** A kebab-case preset id (also the directory anchor). */
const presetId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/u, 'expected a kebab-case id');

/** The complete, validated preset. */
export const presetSchema = z.object({
  id: presetId,
  /** Display name (the preset-picker label + directory heading). */
  name: z.string().min(1).max(40),
  /** One-line vibe for the directory + the `aria-live` text alternative. */
  vibe: z.string().min(1).max(140),
  palette: paletteRampSchema,
  flow: flowParamsSchema,
  particle: particleParamsSchema,
  post: postParamsSchema,
  audio: audioGainsSchema,
});
export type Preset = z.infer<typeof presetSchema>;

/** The directory copy projection (name + vibe) for `/about` + the Tier-4 DOM. */
export const presetDirectoryEntrySchema = presetSchema.pick({
  id: true,
  name: true,
  vibe: true,
});
export type PresetDirectoryEntry = z.infer<typeof presetDirectoryEntrySchema>;
