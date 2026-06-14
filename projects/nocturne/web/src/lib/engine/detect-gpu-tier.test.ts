import { describe, expect, it } from 'vitest';

import { detectGpuTier, type DetectGpuTierDeps } from './detect-gpu-tier';

/** A capable-desktop baseline: WebGL2 + float, fine pointer, 8 cores, motion OK. */
function capableDesktop(over: Partial<DetectGpuTierDeps> = {}): DetectGpuTierDeps {
  return {
    hasWindow: true,
    hasWebgl2: () => true,
    hasColorBufferFloat: () => true,
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
  });

  it('routes to poster when WebGL2 is unavailable', () => {
    const config = detectGpuTier(capableDesktop({ hasWebgl2: () => false }));
    expect(config.route).toBe('poster');
  });

  it('routes to poster when EXT_color_buffer_float is unavailable (the float gate)', () => {
    const config = detectGpuTier(
      capableDesktop({ hasColorBufferFloat: () => false }),
    );
    expect(config.route).toBe('poster');
    expect(config.reason).toMatch(/float/i);
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

describe('detectGpuTier — tier heuristic', () => {
  it('defaults a capable desktop to high (262k), never ultra at boot', () => {
    const config = detectGpuTier(capableDesktop());
    expect(config.tier).toBe('high');
    expect(config.route).toBe('live');
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
