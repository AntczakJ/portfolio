/**
 * WebGL availability detection (Task 6.1 — the no-WebGL degradation arm).
 *
 * MapLibre GL JS renders on a WebGL canvas, so when the browser reports no
 * WebGL support the map surface degrades to the first-class fleet table view
 * (the same live data, the same socket — only the spatial canvas is gone). This
 * module is the single source for that probe.
 *
 * The probe is cheap and side-effect-light: it creates a throwaway `<canvas>`,
 * asks for a WebGL context, and immediately loses it. It is browser-only (guards
 * `typeof window`), and it caches the result so repeated calls do not allocate
 * contexts (a tab has a small WebGL-context budget).
 */

let cached: boolean | null = null;

/**
 * Returns true when the browser can create a WebGL (or experimental-webgl)
 * rendering context — i.e. when the live map can render. Returns false on the
 * server (no `window`) and when no context is available (blocked, unsupported,
 * or out of context budget). Cached after the first call.
 */
export function isWebglAvailable(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');

    if (!gl) {
      cached = false;
      return cached;
    }

    // Release the probe context immediately so we do not hold one of the tab's
    // scarce WebGL contexts open for the lifetime of the page.
    const loseContext =
      'getExtension' in gl
        ? (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)
        : null;
    loseContext?.loseContext?.();

    cached = true;
    return cached;
  } catch {
    cached = false;
    return cached;
  }
}

/**
 * Force the cached result (test seam — lets a test simulate a no-WebGL browser
 * without a real canvas). Pass `null` to clear the cache and re-probe.
 */
export function setWebglAvailableForTest(value: boolean | null): void {
  cached = value;
}
