import { describe, expect, it } from 'vitest';

import {
  decideSoftwareRenderer,
  detectGpuTier,
  isSoftwareRendererString,
  type DetectGpuTierDeps,
} from './detect-gpu-tier';

/** A capable-desktop baseline: WebGL2 + float, hardware GPU, 8 cores, motion OK. */
function capableDesktop(over: Partial<DetectGpuTierDeps> = {}): DetectGpuTierDeps {
  return {
    hasWindow: true,
    hasWebgl2: () => true,
    hasColorBufferFloat: () => true,
    isSoftwareRenderer: () => false, // a real hardware GPU by default
    matchMedia: () => false, // no reduced-motion, no reduced-data, fine pointer
    hardwareConcurrency: 8,
    deviceMemory: 8,
    viewportWidth: 1920,
    ...over,
  };
}

/** Build a matchMedia stub matching only the given queries. */
function mediaMatching(...queries: string[]): (q: string) => boolean {
  const set = new Set(queries);
  return (q) => set.has(q);
}

describe('detectGpuTier — capability gate', () => {
  it('routes to poster on the server (no window)', () => {
    const config = detectGpuTier({ hasWindow: false });
    expect(config.route).toBe('poster');
    expect(config.particleCount).toBe(0);
    expect(config.posterReason).toBe('no-window');
  });

  it('routes to poster when WebGL2 is unavailable', () => {
    const config = detectGpuTier(capableDesktop({ hasWebgl2: () => false }));
    expect(config.route).toBe('poster');
    expect(config.posterReason).toBe('no-webgl2');
  });

  it('routes to poster when EXT_color_buffer_float is unavailable (the float gate)', () => {
    const config = detectGpuTier(
      capableDesktop({ hasColorBufferFloat: () => false }),
    );
    expect(config.route).toBe('poster');
    expect(config.reason).toMatch(/float/i);
    expect(config.posterReason).toBe('no-float');
  });

  it('checks WebGL2 before the float extension (order)', () => {
    let floatProbed = false;
    const config = detectGpuTier(
      capableDesktop({
        hasWebgl2: () => false,
        hasColorBufferFloat: () => {
          floatProbed = true;
          return true;
        },
      }),
    );
    expect(config.route).toBe('poster');
    // Short-circuit: the float probe must not run once WebGL2 already failed.
    expect(floatProbed).toBe(false);
  });
});

describe('detectGpuTier — software-renderer gate (the 0% GPU / 100% CPU fix)', () => {
  it('routes a software renderer to the poster with reason software-webgl', () => {
    const config = detectGpuTier(
      capableDesktop({ isSoftwareRenderer: () => true }),
    );
    expect(config.route).toBe('poster');
    expect(config.posterReason).toBe('software-webgl');
    expect(config.particleCount).toBe(0);
    expect(config.reason).toMatch(/software/i);
  });

  it('keeps a real hardware GPU on the live route (not regressed)', () => {
    const config = detectGpuTier(
      capableDesktop({ isSoftwareRenderer: () => false }),
    );
    expect(config.route).toBe('live');
    expect(config.posterReason).toBeNull();
  });

  it('runs the software gate AFTER the float gate (a no-float client never reaches it)', () => {
    let softwareProbed = false;
    const config = detectGpuTier(
      capableDesktop({
        hasColorBufferFloat: () => false,
        isSoftwareRenderer: () => {
          softwareProbed = true;
          return true;
        },
      }),
    );
    // no-float wins (it is checked first); the software probe must not run.
    expect(config.posterReason).toBe('no-float');
    expect(softwareProbed).toBe(false);
  });

  it('detects each known software-renderer string (case-insensitive)', () => {
    for (const r of [
      'Google SwiftShader',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.0, 256 bits)',
      'Mesa OffScreen',
      'softpipe',
      'Microsoft Basic Render Driver',
      'Software Rasterizer',
    ]) {
      expect(isSoftwareRendererString(r)).toBe(true);
    }
  });

  it('does not flag a real hardware GPU string', () => {
    for (const r of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple M2 Pro',
      'AMD Radeon Pro 5500M OpenGL Engine',
      'Intel(R) Iris(R) Xe Graphics',
    ]) {
      expect(isSoftwareRendererString(r)).toBe(false);
    }
  });

  describe('decideSoftwareRenderer (the renderer-string + caveat-context combinator)', () => {
    it('is software when the renderer string is a software backend', () => {
      expect(decideSoftwareRenderer('Google SwiftShader', false)).toBe(true);
    });

    it('is software when the only context is a major-perf-caveat one (caveat-null path)', () => {
      // The unmasked string is hidden (''), but the no-caveat context was null —
      // the browser only offered a software/major-caveat context.
      expect(decideSoftwareRenderer('', true)).toBe(true);
    });

    it('is NOT software for a hardware string even when the caveat probe is null', () => {
      // The renderer string is AUTHORITATIVE: several legitimate hardware drivers
      // (some Intel / laptop ANGLE configs) return null for a no-caveat context
      // while being fully accelerated. Trusting the spurious caveat over a real
      // GPU string wrongly stranded a hardware user on the poster — the regression
      // this guards. A real renderer + caveat-null must stay LIVE.
      expect(decideSoftwareRenderer('Apple M2 Pro', true)).toBe(false);
      expect(
        decideSoftwareRenderer(
          'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
          true,
        ),
      ).toBe(false);
    });

    it('is NOT software for a hardware string with a clean no-caveat context', () => {
      expect(
        decideSoftwareRenderer(
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
          false,
        ),
      ).toBe(false);
    });

    it('is NOT software when both signals are clean (no string, no caveat)', () => {
      // WEBGL_debug_renderer_info hidden AND a clean no-caveat context → trust it.
      expect(decideSoftwareRenderer('', false)).toBe(false);
    });
  });
});

describe('detectGpuTier — tier heuristic', () => {
  it('defaults a capable desktop to high (262k), never ultra at boot', () => {
    const config = detectGpuTier(capableDesktop());
    expect(config.tier).toBe('high');
    expect(config.route).toBe('live');
    expect(config.posterReason).toBeNull();
    expect(config.simResolution).toBe(512);
    expect(config.particleCount).toBe(512 * 512);
    expect(config.dprClamp).toEqual([1, 2]);
    expect(config.postQuality).toBe('full');
  });

  it('drops to mid for a 4-core machine', () => {
    const config = detectGpuTier(capableDesktop({ hardwareConcurrency: 4 }));
    expect(config.tier).toBe('mid');
    expect(config.simResolution).toBe(384);
  });

  it('drops to low for a 2-core machine', () => {
    const config = detectGpuTier(capableDesktop({ hardwareConcurrency: 2 }));
    expect(config.tier).toBe('low');
    expect(config.simResolution).toBe(256);
  });

  it('drops to low when deviceMemory is present and below 4GB', () => {
    const config = detectGpuTier(
      capableDesktop({ hardwareConcurrency: 8, deviceMemory: 2 }),
    );
    expect(config.tier).toBe('low');
  });

  it('does not penalise absent deviceMemory (Safari/Firefox)', () => {
    const config = detectGpuTier(
      capableDesktop({ hardwareConcurrency: 8, deviceMemory: undefined }),
    );
    expect(config.tier).toBe('high');
  });
});

describe('detectGpuTier — composed preferences', () => {
  it('caps at low under prefers-reduced-data', () => {
    const config = detectGpuTier(
      capableDesktop({
        matchMedia: mediaMatching('(prefers-reduced-data: reduce)'),
      }),
    );
    expect(config.tier).toBe('low');
    expect(config.route).toBe('live');
  });

  it('drops to low for a coarse pointer on a small viewport (mobile floor)', () => {
    const config = detectGpuTier(
      capableDesktop({
        matchMedia: mediaMatching('(pointer: coarse)'),
        viewportWidth: 390,
      }),
    );
    expect(config.tier).toBe('low');
  });

  it('keeps a coarse-pointer LARGE viewport (tablet) at the cores tier', () => {
    const config = detectGpuTier(
      capableDesktop({
        matchMedia: mediaMatching('(pointer: coarse)'),
        viewportWidth: 1280,
        hardwareConcurrency: 8,
      }),
    );
    expect(config.tier).toBe('high');
  });

  it('routes to calm under prefers-reduced-motion, audio muted, but keeps the tier', () => {
    const config = detectGpuTier(
      capableDesktop({
        matchMedia: mediaMatching('(prefers-reduced-motion: reduce)'),
        hardwareConcurrency: 8,
      }),
    );
    expect(config.route).toBe('calm');
    expect(config.tier).toBe('high'); // motion governs route; cores govern count
    expect(config.audioReactive).toBe(false);
    expect(config.pointerWake).toBe(false);
  });

  it('still routes a reduced-motion + no-float client to poster', () => {
    const config = detectGpuTier(
      capableDesktop({
        hasColorBufferFloat: () => false,
        matchMedia: mediaMatching('(prefers-reduced-motion: reduce)'),
      }),
    );
    expect(config.route).toBe('poster');
  });

  it('composes reduced-motion (calm) with reduced-data (low count)', () => {
    const config = detectGpuTier(
      capableDesktop({
        matchMedia: mediaMatching(
          '(prefers-reduced-motion: reduce)',
          '(prefers-reduced-data: reduce)',
        ),
      }),
    );
    expect(config.route).toBe('calm');
    expect(config.tier).toBe('low');
  });
});
