import { describe, expect, it } from 'vitest';

import { PRESETS } from '@/data/presets';

import { posterBackground, posterGradient } from './poster-gradient';

describe('posterGradient', () => {
  it('derives glow stops from the preset palette (faithful colours)', () => {
    const aurora = PRESETS.find((p) => p.id === 'aurora');
    if (!aurora) throw new Error('aurora preset missing');
    const g = posterGradient('aurora');
    // every glow stop is one of the preset's authored palette stops
    for (const stop of [g.glowLow, g.glowMid, g.glowHigh, g.spark]) {
      expect(aurora.palette).toContain(stop);
    }
    // the spark is the brightest (last) stop
    expect(g.spark).toBe(aurora.palette[aurora.palette.length - 1]);
  });

  it('uses the near-black stage floor as the base for every preset', () => {
    for (const preset of PRESETS) {
      expect(posterGradient(preset.id).base).toBe('#06070f');
    }
  });

  it('falls back to the default preset for an unknown id', () => {
    expect(() => posterGradient('does-not-exist')).not.toThrow();
    const g = posterGradient('does-not-exist');
    expect(g.base).toBe('#06070f');
  });
});

describe('posterBackground', () => {
  it('returns a layered radial-gradient stack referencing the palette', () => {
    const css = posterBackground('molten-swirl');
    expect(css).toMatch(/radial-gradient/);
    // multiple layers, comma-joined
    expect(css.split('radial-gradient').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic for a given preset', () => {
    expect(posterBackground('aurora')).toBe(posterBackground('aurora'));
  });
});
