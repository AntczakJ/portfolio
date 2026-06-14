import { describe, expect, it } from 'vitest';

import { getPresetOrDefault, PRESETS } from '@/data/presets';

import {
  crossfadePresets,
  hexToRgb,
  lerp,
  lerpPresetUniforms,
  lerpRamp,
  presetToUniforms,
  RAMP_STOPS,
  resampleRamp,
} from './preset-uniforms';

describe('hexToRgb', () => {
  it('parses a #rrggbb hex to [0,1] channels', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    const [r, g, b] = hexToRgb('#9d8cff');
    expect(r).toBeCloseTo(0x9d / 255, 5);
    expect(g).toBeCloseTo(0x8c / 255, 5);
    expect(b).toBeCloseTo(0xff / 255, 5);
  });

  it('returns black for a malformed hex', () => {
    expect(hexToRgb('not-a-hex')).toEqual([0, 0, 0]);
  });
});

describe('lerp', () => {
  it('interpolates and clamps t to [0,1]', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, -1)).toBe(0); // clamped
    expect(lerp(0, 10, 2)).toBe(10); // clamped
  });
});

describe('resampleRamp', () => {
  it('produces a fixed-length ramp regardless of input stop count', () => {
    expect(resampleRamp(['#000000', '#ffffff', '#ff0000'])).toHaveLength(RAMP_STOPS);
    expect(
      resampleRamp(['#000000', '#111111', '#222222', '#333333', '#444444', '#555555']),
    ).toHaveLength(RAMP_STOPS);
  });

  it('keeps the endpoints exact', () => {
    const ramp = resampleRamp(['#000000', '#ffffff']);
    expect(ramp[0]).toEqual([0, 0, 0]);
    expect(ramp[RAMP_STOPS - 1]).toEqual([1, 1, 1]);
  });
});

describe('lerpPresetUniforms', () => {
  const a = presetToUniforms(PRESETS[0]!);
  const b = presetToUniforms(PRESETS[1]!);

  it('returns `from` exactly at t=0', () => {
    expect(lerpPresetUniforms(a, b, 0)).toEqual(a);
  });

  it('returns `to` exactly at t=1', () => {
    expect(lerpPresetUniforms(a, b, 1)).toEqual(b);
  });

  it('returns the midpoint at t=0.5', () => {
    const mid = lerpPresetUniforms(a, b, 0.5);
    expect(mid.flowSpeed).toBeCloseTo((a.flowSpeed + b.flowSpeed) / 2, 6);
    expect(mid.bloomStrength).toBeCloseTo((a.bloomStrength + b.bloomStrength) / 2, 6);
  });

  it('covers every uniform key (no field left un-interpolated)', () => {
    const mid = lerpPresetUniforms(a, b, 0.5);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      expect(mid[key]).toBeCloseTo((a[key] + b[key]) / 2, 6);
    }
  });
});

describe('lerpRamp', () => {
  it('interpolates ramps channel-wise', () => {
    const from = resampleRamp(['#000000', '#000000']);
    const to = resampleRamp(['#ffffff', '#ffffff']);
    const mid = lerpRamp(from, to, 0.5);
    for (const stop of mid) {
      expect(stop[0]).toBeCloseTo(0.5, 5);
      expect(stop[1]).toBeCloseTo(0.5, 5);
      expect(stop[2]).toBeCloseTo(0.5, 5);
    }
  });
});

describe('crossfadePresets', () => {
  it('produces a complete interpolated look (uniforms + ramp) at the midpoint', () => {
    const from = getPresetOrDefault('glacial-drift');
    const to = getPresetOrDefault('molten-swirl');
    const look = crossfadePresets(from, to, 0.5);
    expect(look.ramp).toHaveLength(RAMP_STOPS);
    expect(look.uniforms.turbulence).toBeCloseTo(
      (from.flow.turbulence + to.flow.turbulence) / 2,
      6,
    );
  });

  it('returns the from-look at t=0 and the to-look at t=1', () => {
    const from = getPresetOrDefault('aurora');
    const to = getPresetOrDefault('solar-wind');
    expect(crossfadePresets(from, to, 0).uniforms).toEqual(presetToUniforms(from));
    expect(crossfadePresets(from, to, 1).uniforms).toEqual(presetToUniforms(to));
  });
});
