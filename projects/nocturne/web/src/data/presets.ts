import {
  presetSchema,
  type Preset,
  type PresetDirectoryEntry,
} from '@/lib/schemas';

/**
 * The curated preset definitions (Task 3.2, ADR-002 §3).
 *
 * Six complete, coherent, DRAMATICALLY DISTINCT looks — "many looks from one
 * engine". Each is a full `Preset`: a palette ramp (low→high energy colour
 * stops), the flow field (scale/speed/turbulence/damping/lifetime/domain), the
 * particle treatment (size/opacity/blend/spawn/trail), the post mix
 * (bloom/vignette/aberration), and the per-preset audio gains (how hard each
 * band drives the field). Hand-curated, deterministic.
 *
 * Every preset is VALIDATED by `presetSchema` at module load (`buildPreset`
 * below), so a malformed look fails fast at build/test time, never at GPU time.
 * The cross-fade interpolator (Task 3.4) lerps the whole uniform set between any
 * two of these over a duration; the audio modulates around the cross-faded base.
 *
 * Distinctness is intentional and spans the full axis:
 *   glacial-drift — cold, sparse, slow, crystalline, barely reactive
 *   molten-swirl  — hot, dense, fast, violent, hard-reacting
 *   aurora        — wide cool ribbons, gentle, shimmering highs
 *   nocturne-noir — near-monochrome ink, restrained, cinematic, low bloom
 *   solar-wind    — incandescent streaks, long trails, energetic
 *   ink-bloom     — soft alpha-blended diffusion, slow blossoming, mid-driven
 */

/** Validate-on-build so a malformed curated look throws at module load. */
function buildPreset(input: Preset): Preset {
  return presetSchema.parse(input);
}

/**
 * The first catalogue preset, hoisted to a named, statically-typed `Preset` so
 * `getPresetOrDefault` has a provably-present last-resort fallback (the `??`
 * chain ends on a real `Preset`, not an `Array[0]` the type system widens to
 * `Preset | undefined` under `noUncheckedIndexedAccess`).
 */
const FIRST_PRESET: Preset = buildPreset({
  id: 'glacial-drift',
  name: 'Glacial Drift',
  vibe: 'Cold, sparse crystals drifting through a slow, near-still field.',
  palette: ['#0b1a2e', '#1f4e6b', '#3f8fb0', '#9fd6e6', '#eaf7fb'],
  flow: {
    scale: 0.9,
    speed: 0.45,
    turbulence: 0.35,
    damping: 0.86,
    lifetime: 34,
    domainScale: 3.2,
  },
  particle: {
    size: 2.2,
    opacity: 0.62,
    blend: 'additive',
    spawn: 'shell',
    trail: 0.12,
  },
  post: {
    bloomStrength: 0.85,
    bloomThreshold: 0.62,
    vignette: 0.42,
    aberration: 0.0015,
  },
  audio: {
    bassToTurbulence: 0.6,
    midToSpread: 0.4,
    highToColor: 0.9,
    rmsToBloom: 0.7,
  },
});

export const PRESETS: readonly Preset[] = [
  FIRST_PRESET,
  buildPreset({
    id: 'molten-swirl',
    name: 'Molten Swirl',
    vibe: 'Dense incandescent matter churning hard on every kick.',
    palette: ['#1a0402', '#5c1402', '#b83a09', '#f07f1a', '#ffd66b'],
    flow: {
      scale: 2.6,
      speed: 1.85,
      turbulence: 1.7,
      damping: 0.7,
      lifetime: 12,
      domainScale: 2.4,
    },
    particle: {
      size: 3.4,
      opacity: 0.82,
      blend: 'additive',
      spawn: 'sphere',
      trail: 0.34,
    },
    post: {
      bloomStrength: 2.1,
      bloomThreshold: 0.36,
      vignette: 0.58,
      aberration: 0.006,
    },
    audio: {
      bassToTurbulence: 2.8,
      midToSpread: 1.6,
      highToColor: 1.8,
      rmsToBloom: 2.4,
    },
  }),
  buildPreset({
    id: 'aurora',
    name: 'Aurora',
    vibe: 'Wide cool ribbons of light shimmering gently across the dark.',
    palette: ['#04140f', '#0b6b4f', '#27c98a', '#7af0c4', '#c9b8ff'],
    flow: {
      scale: 1.3,
      speed: 0.85,
      turbulence: 0.7,
      damping: 0.82,
      lifetime: 26,
      domainScale: 4.4,
    },
    particle: {
      size: 2.8,
      opacity: 0.7,
      blend: 'additive',
      spawn: 'disc',
      trail: 0.46,
    },
    post: {
      bloomStrength: 1.35,
      bloomThreshold: 0.48,
      vignette: 0.4,
      aberration: 0.0025,
    },
    audio: {
      bassToTurbulence: 1.1,
      midToSpread: 1.2,
      highToColor: 2.2,
      rmsToBloom: 1.3,
    },
  }),
  buildPreset({
    id: 'nocturne-noir',
    name: 'Nocturne Noir',
    vibe: 'Near-monochrome ink in restrained, cinematic low light.',
    palette: ['#050507', '#1b1d27', '#3a3d52', '#7e8398', '#d6d8e6'],
    flow: {
      scale: 1.1,
      speed: 0.6,
      turbulence: 0.5,
      damping: 0.88,
      lifetime: 30,
      domainScale: 3,
    },
    particle: {
      size: 1.8,
      opacity: 0.55,
      blend: 'additive',
      spawn: 'box',
      trail: 0.2,
    },
    post: {
      bloomStrength: 0.55,
      bloomThreshold: 0.7,
      vignette: 0.66,
      aberration: 0.001,
    },
    audio: {
      bassToTurbulence: 0.9,
      midToSpread: 0.7,
      highToColor: 0.6,
      rmsToBloom: 0.5,
    },
  }),
  buildPreset({
    id: 'solar-wind',
    name: 'Solar Wind',
    vibe: 'Incandescent streaks racing on long trails, charged and fast.',
    palette: ['#170a01', '#7a2a05', '#d6740d', '#ffc24d', '#fff4cf'],
    flow: {
      scale: 1.8,
      speed: 2.4,
      turbulence: 1.2,
      damping: 0.74,
      lifetime: 16,
      domainScale: 5,
    },
    particle: {
      size: 2.4,
      opacity: 0.78,
      blend: 'additive',
      spawn: 'disc',
      trail: 0.72,
    },
    post: {
      bloomStrength: 1.7,
      bloomThreshold: 0.42,
      vignette: 0.46,
      aberration: 0.0045,
    },
    audio: {
      bassToTurbulence: 2,
      midToSpread: 1.8,
      highToColor: 1.6,
      rmsToBloom: 1.9,
    },
  }),
  buildPreset({
    id: 'ink-bloom',
    name: 'Ink Bloom',
    vibe: 'Soft pigment blossoming slowly through still water.',
    palette: ['#0a0716', '#2a1158', '#6a31b8', '#b56ae0', '#f0d0ff'],
    flow: {
      scale: 0.7,
      speed: 0.5,
      turbulence: 0.45,
      damping: 0.9,
      lifetime: 40,
      domainScale: 2.8,
    },
    particle: {
      size: 4.2,
      opacity: 0.4,
      blend: 'alpha',
      spawn: 'sphere',
      trail: 0.5,
    },
    post: {
      bloomStrength: 1,
      bloomThreshold: 0.55,
      vignette: 0.5,
      aberration: 0.002,
    },
    audio: {
      bassToTurbulence: 1.3,
      midToSpread: 2.4,
      highToColor: 1,
      rmsToBloom: 1.1,
    },
  }),
];

/**
 * The default preset — the look the field arms into (D-09).
 *
 * Deliberately NOT `aurora` (cool-green ribbons are the single most-seen audio-
 * reactive demo on Codrops/Awwwards; the most generic of the six). The arm-in
 * default is `ink-bloom`: the only ALPHA-blend look in the set — soft indigo/
 * violet pigment blossoming slowly through still water. It is the least-seen of
 * the six, ties tightly to nocturne's sovereign indigo-violet identity (the
 * --stage-* / --color-accent register), and holds the five-second first
 * impression longer than the green nebula. All six presets remain in the set.
 */
export const DEFAULT_PRESET_ID = 'ink-bloom';

/** O(1) lookup by id. */
const PRESET_BY_ID: ReadonlyMap<string, Preset> = new Map(
  PRESETS.map((p) => [p.id, p]),
);

/** Resolve a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Preset | undefined {
  return PRESET_BY_ID.get(id);
}

/** Resolve a preset by id, falling back to the default (never throws). */
export function getPresetOrDefault(id: string): Preset {
  const found = PRESET_BY_ID.get(id);
  if (found) return found;
  const fallback = PRESET_BY_ID.get(DEFAULT_PRESET_ID);
  // The default is a curated, validated preset and is always present; the
  // statically-typed FIRST_PRESET is the last-resort, type-provable fallback.
  return fallback ?? FIRST_PRESET;
}

/** The directory copy projection (name + vibe) for `/about` + the Tier-4 DOM. */
export const PRESET_DIRECTORY: readonly PresetDirectoryEntry[] = PRESETS.map(
  ({ id, name, vibe }) => ({ id, name, vibe }),
);
