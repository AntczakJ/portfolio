import {
  tierConfigSchema,
  type PostQuality,
  type PosterReason,
  type RenderRoute,
  type TierConfig,
  type TierName,
} from '@/lib/schemas';

/**
 * The capability probe + tier router (Task 1.3 / Task 3.4, ADR-002 §4 /
 * ADR-004 §1).
 *
 * `detectGpuTier()` is a synchronous, PURE-ISH client probe that decides what
 * the `/` stage renders BEFORE the Canvas mounts:
 *   - the live GPGPU field (Tier 1/2) at a particle count + DPR clamp + post
 *     quality, OR
 *   - the reduced-motion calm autonomous drift (Tier 3-RM), OR
 *   - the static AVIF poster + preset directory DOM (Tier 4).
 *
 * It does NOT touch the real GPU at IMPORT time — the WebGL probe runs only when
 * the function is CALLED, and all environment access (the WebGL2 context, the
 * float-render-target extension, `matchMedia`, `navigator`) is injectable via
 * `DetectGpuTierDeps` so the whole decision tree is unit-testable without a GPU
 * or a browser (Phase 7). Called with no deps in the browser, it uses the real
 * environment; on the server (no `window`) it returns the poster route so the
 * SSR/no-JS floor renders.
 *
 * The decision tree (ADR-004 §1), in order:
 *   1. no `window` / SSR ─────────────────────────────▶ poster
 *   2. getContext('webgl2') === null ─────────────────▶ poster
 *   3. EXT_color_buffer_float === null ───────────────▶ poster   ← the float gate
 *   3b. SOFTWARE renderer (SwiftShader/llvmpipe/…) ────▶ poster   ← the software gate
 *   4. prefers-reduced-motion: reduce ────────────────▶ calm (drift, audio muted)
 *   5. prefers-reduced-data: reduce ──────────────────▶ live @ low
 *   6. coarse-pointer AND viewport < 768px ───────────▶ live @ low (mobile floor)
 *   7. cores/deviceMemory heuristic ──────────────────▶ live @ high|mid|low
 *
 * The SOFTWARE gate (3b, the fix for the reported 0% GPU / 100% CPU bug): a
 * software WebGL backend (SwiftShader, llvmpipe, Mesa softpipe, Microsoft Basic
 * Render, ANGLE-over-SwiftShader, …) PASSES the WebGL2 + float gates, so without
 * this check the full 262k-particle GPGPU + bloom would run on the CPU. We read
 * the unmasked renderer string (`WEBGL_debug_renderer_info` →
 * `UNMASKED_RENDERER_WEBGL`) and ALSO probe a `failIfMajorPerformanceCaveat`
 * context: if the renderer string is a known software backend, OR a normal
 * context succeeds while the no-caveat context is null (the only context is a
 * major-perf-caveat / software one), we route to the poster with
 * `posterReason: 'software-webgl'` — the SAME outcome as the float gate (the
 * heavy field NEVER runs on the CPU), but the UI shows a fixable "enable
 * hardware acceleration" hint (the floors `no-webgl2` / `no-float` do not).
 *
 * Reduced-motion (step 4) governs MOTION/AUDIO; the capability heuristic
 * (steps 5–7) governs COUNT/DPR/POST — they compose: a reduced-motion client
 * that is also low-capability gets the calm route AT a lower count. A
 * reduced-motion client that fails the float gate still routes to the poster
 * (the poster is a valid reduced-motion surface). This composition is applied
 * after the route is chosen.
 */

/** Injectable environment probes (all default to the real browser env). */
export interface DetectGpuTierDeps {
  /** Whether a WebGL2 context is obtainable. Default: a throwaway-canvas probe. */
  hasWebgl2?: () => boolean;
  /** Whether `EXT_color_buffer_float` is present. Default: probe the context. */
  hasColorBufferFloat?: () => boolean;
  /**
   * Whether the WebGL2 renderer is a SOFTWARE backend (SwiftShader / llvmpipe /
   * Mesa softpipe / Microsoft Basic Render / ANGLE-over-SwiftShader …). Default:
   * read the unmasked renderer string AND probe a `failIfMajorPerformanceCaveat`
   * context (caveat-only ⇒ software). Reading the renderer is the software gate.
   */
  isSoftwareRenderer?: () => boolean;
  /** `matchMedia(query).matches`. Default: `window.matchMedia`. */
  matchMedia?: (query: string) => boolean;
  /** Logical CPU cores. Default: `navigator.hardwareConcurrency`. */
  hardwareConcurrency?: number;
  /** Device memory (GB), where the signal exists. Default: `navigator.deviceMemory`. */
  deviceMemory?: number | undefined;
  /** Viewport width in px. Default: `window.innerWidth`. */
  viewportWidth?: number;
  /** Force the SSR/no-window branch (for tests). Default: `typeof window`. */
  hasWindow?: boolean;
}

export interface DetectGpuTierOptions {
  /** The viewport-width threshold (px) below which a coarse-pointer device is mobile. */
  mobileWidthThreshold?: number;
}

const DEFAULT_MOBILE_WIDTH_THRESHOLD = 768;
const MIN_CORES_MID = 4;
const MIN_CORES_HIGH = 8;
const MIN_DEVICE_MEMORY_MID_GB = 4;

/** The per-tier sim parameters (ADR-002 §4 tier table). */
interface TierSpec {
  simResolution: number;
  dprClamp: [number, number];
  postQuality: PostQuality;
}

const TIER_SPECS: Record<TierName, TierSpec> = {
  low: { simResolution: 256, dprClamp: [1, 1.25], postQuality: 'bloom-only' },
  mid: { simResolution: 384, dprClamp: [1, 1.5], postQuality: 'bloom-vignette' },
  high: { simResolution: 512, dprClamp: [1, 2], postQuality: 'full' },
  ultra: { simResolution: 1024, dprClamp: [1, 2], postQuality: 'full' },
};

/** Build a validated `TierConfig` for a chosen tier + route + behaviour. */
function buildConfig(
  tier: TierName,
  route: RenderRoute,
  reason: string,
  behaviour: {
    audioReactive: boolean;
    pointerWake: boolean;
    posterReason?: PosterReason | null;
  },
): TierConfig {
  const spec = TIER_SPECS[tier];
  const particleCount = route === 'poster' ? 0 : spec.simResolution * spec.simResolution;
  return tierConfigSchema.parse({
    tier,
    route,
    simResolution: spec.simResolution,
    particleCount,
    dprClamp: spec.dprClamp,
    postQuality: spec.postQuality,
    audioReactive: behaviour.audioReactive,
    pointerWake: behaviour.pointerWake,
    reason,
    posterReason: behaviour.posterReason ?? null,
  });
}

/** The poster config (Tier 4) — no live render. `posterReason` is the cause. */
function posterConfig(reason: string, posterReason: PosterReason): TierConfig {
  return buildConfig('low', 'poster', reason, {
    audioReactive: false,
    pointerWake: false,
    posterReason,
  });
}

/**
 * Build a config at an explicit tier — used only by the headless verifier
 * (`?tier=low`) so software-GL can complete frames + screenshots; never reached
 * in normal operation (the real path goes through `detectGpuTier`). When
 * `reducedMotion` is true it still composes the calm route (audio muted, no
 * wake) so the reduced-motion path can be exercised at a fast low tier.
 *
 * NOTE: `?tier=` BYPASSES the whole capability probe — including the software
 * gate (Step 3b). This is deliberate: it lets a verifier force the LIVE field on
 * headless software-GL (which the software gate would otherwise route to the
 * poster) so non-poster surfaces can be checked. It is never used on the real
 * client path; a genuine software-GL visitor goes through `detectGpuTier` and
 * gets the poster + the hint.
 */
export function forceTierConfig(
  tier: TierName,
  reducedMotion = false,
): TierConfig {
  if (reducedMotion) {
    return buildConfig(tier, 'calm', `forced ${tier} tier, reduced-motion (dev/verify)`, {
      audioReactive: false,
      pointerWake: false,
    });
  }
  return buildConfig(tier, 'live', `forced ${tier} tier (dev/verify)`, {
    audioReactive: true,
    pointerWake: true,
  });
}

/** A real-browser WebGL2 probe, disposing the throwaway context immediately. */
function realHasWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * A real-browser `EXT_color_buffer_float` probe — the HARD GPGPU gate (ADR-002
 * §1/§4). Rendering TO a half/full-float texture is NOT core WebGL2; without
 * this extension no float ping-pong is possible and the client routes to the
 * poster.
 */
function realHasColorBufferFloat(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ext !== null;
  } catch {
    return false;
  }
}

/**
 * Known SOFTWARE-WebGL renderer substrings (matched case-insensitively against
 * the unmasked `UNMASKED_RENDERER_WEBGL` string). A software backend renders on
 * the CPU — running the 262k-particle GPGPU + bloom on it pins the CPU (the
 * reported bug). `'swiftshader'` also catches the ANGLE form
 * ("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), …)").
 */
const SOFTWARE_RENDERER_SUBSTRINGS = [
  'swiftshader',
  'llvmpipe',
  'software',
  'microsoft basic render',
  'mesa offscreen',
  'softpipe',
] as const;

/** True if the unmasked renderer string names a known software backend. */
export function isSoftwareRendererString(renderer: string): boolean {
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERER_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * The PURE software-decision combinator (unit-testable without a GPU).
 *
 * The unmasked renderer string is AUTHORITATIVE when present: a known hardware
 * GPU (NVIDIA / AMD / Intel / Apple / Adreno / Mali / an ANGLE-over-D3D11 string
 * …) is NEVER treated as software, even if the `failIfMajorPerformanceCaveat`
 * probe came back null. That probe is unreliable on real hardware — several
 * legitimate drivers (notably some Intel / laptop ANGLE configs) return null for
 * a no-caveat context despite being fully hardware-accelerated, so trusting it
 * over a real renderer string would wrongly strand a GPU user on the poster
 * (the reported regression). The caveat signal ONLY decides when the renderer
 * string is hidden (`''`, locked-down browsers) — the last-resort fallback.
 */
export function decideSoftwareRenderer(
  renderer: string,
  caveatOnly: boolean,
): boolean {
  if (renderer !== '') return isSoftwareRendererString(renderer);
  return caveatOnly;
}

/**
 * Read the unmasked renderer string from a WebGL2 context via the
 * `WEBGL_debug_renderer_info` extension. Returns `''` when the extension or the
 * context is unavailable (some locked-down browsers hide it — then we fall back
 * to the caveat-context probe only).
 */
function readUnmaskedRenderer(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return '';
  const value: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  return typeof value === 'string' ? value : '';
}

/**
 * The real-browser SOFTWARE-renderer probe (the software gate, fix for the 0%
 * GPU / 100% CPU bug). Two signals, EITHER of which means software:
 *   (a) the unmasked renderer string is a known software backend; OR
 *   (b) a `{ failIfMajorPerformanceCaveat: true }` context is null while a normal
 *       WebGL2 context succeeds — i.e. the only available context carries a major
 *       performance caveat (the browser's own "this is software/slow" signal).
 */
function realIsSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false; // no normal context — the no-webgl2 gate owns this.

    const renderer = readUnmaskedRenderer(gl);

    // (b) the no-caveat probe: if a normal context exists but a no-major-caveat
    // context does not, the only context is a major-perf-caveat (software) one.
    const noCaveatCanvas = document.createElement('canvas');
    const noCaveat = noCaveatCanvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: true,
    });
    const caveatOnly = noCaveat === null;

    gl.getExtension('WEBGL_lose_context')?.loseContext();
    noCaveat?.getExtension('WEBGL_lose_context')?.loseContext();

    return decideSoftwareRenderer(renderer, caveatOnly);
  } catch {
    return false;
  }
}

/** Choose the capability tier (low|mid|high) from cores + memory. */
function chooseCapabilityTier(
  cores: number,
  deviceMemory: number | undefined,
): TierName {
  // Penalise only when the memory signal EXISTS and is below the mid floor.
  if (typeof deviceMemory === 'number' && deviceMemory < MIN_DEVICE_MEMORY_MID_GB) {
    return 'low';
  }
  if (cores >= MIN_CORES_HIGH) return 'high';
  if (cores >= MIN_CORES_MID) return 'mid';
  return 'low';
}

/**
 * Detect the GPU tier + render route for the current client. NOTE: never
 * promotes to `ultra` at boot — `ultra` (1M) is adapt-UP-only on proven runtime
 * headroom (ADR-002 §4); the conservative boot default is `high` (262k).
 */
export function detectGpuTier(
  deps: DetectGpuTierDeps = {},
  options: DetectGpuTierOptions = {},
): TierConfig {
  const hasWindow = deps.hasWindow ?? typeof window !== 'undefined';
  if (!hasWindow) {
    return posterConfig(
      'server / no window — static poster + directory DOM',
      'no-window',
    );
  }

  const mobileWidthThreshold =
    options.mobileWidthThreshold ?? DEFAULT_MOBILE_WIDTH_THRESHOLD;
  const matchMedia =
    deps.matchMedia ?? ((q: string) => window.matchMedia(q).matches);
  const webgl2 = deps.hasWebgl2 ?? realHasWebgl2;
  const colorBufferFloat = deps.hasColorBufferFloat ?? realHasColorBufferFloat;
  const softwareRenderer = deps.isSoftwareRenderer ?? realIsSoftwareRenderer;
  // `navigator.hardwareConcurrency` is typed as a required `number` by lib.dom,
  // but it is genuinely absent on some embedded/older browsers; model it as
  // optional so the `?? 0` floor is a real runtime guard, not dead code.
  const cores =
    deps.hardwareConcurrency ??
    (navigator as Omit<Navigator, 'hardwareConcurrency'> & {
      hardwareConcurrency?: number;
    }).hardwareConcurrency ??
    0;
  const deviceMemory =
    deps.deviceMemory ??
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const viewportWidth = deps.viewportWidth ?? window.innerWidth;

  // Step 2: WebGL2 must be available.
  if (!webgl2()) {
    return posterConfig(
      'no WebGL2 context — static poster + directory DOM',
      'no-webgl2',
    );
  }

  // Step 3: the float-render-target hard gate.
  if (!colorBufferFloat()) {
    return posterConfig(
      'EXT_color_buffer_float unavailable — no GPGPU float ping-pong; poster',
      'no-float',
    );
  }

  // Step 3b: the SOFTWARE-renderer gate (the 0% GPU / 100% CPU fix). A software
  // backend passes the WebGL2 + float gates, so without this the heavy GPGPU
  // field would run on the CPU. Route to the poster — the SAME outcome as the
  // float gate — but with `posterReason: 'software-webgl'` so the UI can show
  // the fixable "enable hardware acceleration" hint (the floors cannot be fixed
  // by the user; this can).
  if (softwareRenderer()) {
    return posterConfig(
      'software WebGL renderer (no hardware acceleration) — poster + hint',
      'software-webgl',
    );
  }

  // Steps 5–7: the capability tier (count/DPR/post).
  const reducedData = matchMedia('(prefers-reduced-data: reduce)');
  const coarsePointer = matchMedia('(pointer: coarse)');
  const narrowViewport = viewportWidth < mobileWidthThreshold;

  let tier: TierName;
  let capabilityReason: string;
  if (reducedData) {
    tier = 'low';
    capabilityReason = 'prefers-reduced-data — low tier';
  } else if (coarsePointer && narrowViewport) {
    tier = 'low';
    capabilityReason = 'coarse pointer + small viewport — mobile floor (low)';
  } else {
    tier = chooseCapabilityTier(cores, deviceMemory);
    capabilityReason = `cores=${String(cores)}${
      typeof deviceMemory === 'number' ? ` mem=${String(deviceMemory)}GB` : ''
    } — ${tier} tier`;
  }

  // Step 4: reduced-motion governs MOTION/AUDIO; compose it over the tier.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion) {
    return buildConfig(
      tier,
      'calm',
      `prefers-reduced-motion — calm drift, audio muted (${capabilityReason})`,
      { audioReactive: false, pointerWake: false },
    );
  }

  return buildConfig(tier, 'live', capabilityReason, {
    audioReactive: true,
    pointerWake: true,
  });
}
