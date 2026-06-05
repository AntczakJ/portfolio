/**
 * WebGL capability / tiering heuristic (ADR-002 §4).
 *
 * A small, synchronous, pure-ish client probe that decides Tier-1 eligibility
 * (the live R3F scene) BEFORE the Canvas is allowed to mount. Mid-tier mobile
 * and no-WebGL clients are routed to the Tier-3 pre-baked-render fallback
 * (Phase 4) so the heavy scene simply does not load there — this is how the
 * mobile Lighthouse run hits >= 95 honestly with a real 3D centrepiece.
 *
 * Tier-1 (the live scene) requires ALL of:
 *   - a successful WebGL2 context probe (the scene targets WebGL2; `webgl` is
 *     not sufficient). Null context (blocked/unavailable) -> Tier 3.
 *   - `navigator.hardwareConcurrency >= 4` (cores).
 *   - `navigator.deviceMemory >= 4` (GB) WHERE THE SIGNAL EXISTS. It is absent
 *     on some browsers (Safari/Firefox); absence is NOT a failure — the
 *     decision then leans on the WebGL2 probe + cores + the coarse-pointer
 *     /viewport check.
 *   - NOT a constrained mobile profile: a coarse-pointer device below the
 *     mobile width threshold defaults to Tier 3 even if the GPU probe passes
 *     ("a 3D scene that melts a mid-tier phone is a worse first impression
 *     than a crisp static render" — PLAN.md audience 2). Tablets (coarse
 *     pointer, large viewport) that pass the probe are Tier-1-eligible.
 *   - NOT `prefers-reduced-data: reduce` (do not pull a multi-MB GLB on a
 *     data-saver client).
 *
 * `prefers-reduced-motion` is ORTHOGONAL and does NOT force Tier 3 here:
 * ADR-004 keeps the configurator interactive on direct user input under
 * reduced motion (drag-to-orbit, tap-a-swatch are user-initiated, not
 * auto-motion) and only disables auto-orbit + converts the seam to a
 * crossfade.
 *
 * A runtime `PerformanceMonitor` (Phase 4) demotes Tier-1 -> Tier-3 at
 * runtime if a device that passed this static probe still chokes — so this
 * gate is the load-time floor, not the only line of defence.
 *
 * Pure-ish + unit-testable (Phase 7) by mocking `navigator` / `matchMedia` /
 * the WebGL2 context. SSR-safe: returns `'unknown'` when `window` is absent
 * so callers never assume a tier on the server.
 */

export type WebglTier = 'tier-1' | 'tier-3' | 'unknown';

export interface DetectWebglTierOptions {
  /**
   * The viewport-width threshold (px) below which a coarse-pointer device is
   * treated as a constrained mobile profile and routed to Tier 3. Matches the
   * GSAP `matchMedia` mobile branch (ADR-002 §4).
   */
  mobileWidthThreshold?: number;
}

const DEFAULT_MOBILE_WIDTH_THRESHOLD = 768;
const MIN_CORES = 4;
const MIN_DEVICE_MEMORY_GB = 4;

/** `navigator.deviceMemory` is non-standard / absent on some browsers. */
interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * Probe for a usable WebGL2 context, disposing the throwaway canvas + context
 * immediately. Returns `false` on any failure (null context, thrown error).
 */
function hasWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // Release the throwaway context proactively so the probe never holds a
    // WebGL context slot (browsers cap concurrent contexts).
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide the WebGL tier for the current client. Call only in the browser
 * (after mount); on the server it returns `'unknown'`.
 */
export function detectWebglTier(options?: DetectWebglTierOptions): WebglTier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'unknown';
  }

  const mobileWidthThreshold =
    options?.mobileWidthThreshold ?? DEFAULT_MOBILE_WIDTH_THRESHOLD;

  // Data-saver clients: never pull the multi-MB GLB.
  if (window.matchMedia('(prefers-reduced-data: reduce)').matches) {
    return 'tier-3';
  }

  // WebGL2 must be available, or there is no live scene to show.
  if (!hasWebgl2()) {
    return 'tier-3';
  }

  // Cores: a hard floor. (`hardwareConcurrency` is typed as a non-nullable
  // number in lib.dom, so no `?? 0` fallback is needed.)
  const cores = navigator.hardwareConcurrency;
  if (cores < MIN_CORES) {
    return 'tier-3';
  }

  // Device memory: penalise ONLY when the signal exists and is below the floor.
  const deviceMemory = (navigator as NavigatorWithDeviceMemory).deviceMemory;
  if (typeof deviceMemory === 'number' && deviceMemory < MIN_DEVICE_MEMORY_GB) {
    return 'tier-3';
  }

  // Constrained mobile profile: a coarse pointer below the width threshold is
  // routed to Tier 3 even if the GPU probe passed.
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const narrowViewport = window.innerWidth < mobileWidthThreshold;
  if (coarsePointer && narrowViewport) {
    return 'tier-3';
  }

  return 'tier-1';
}
