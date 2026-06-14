import { describe, expect, it } from 'vitest';

import { presetSchema } from '@/lib/schemas';

import {
  DEFAULT_PRESET_ID,
  getPreset,
  getPresetOrDefault,
  PRESET_DIRECTORY,
  PRESETS,
} from './presets';

describe('curated presets', () => {
  it('ships a coherent, distinct set (6 presets)', () => {
    expect(PRESETS.length).toBe(6);
  });

  it('every curated preset validates against the schema', () => {
    for (const preset of PRESETS) {
      expect(() => presetSchema.parse(preset)).not.toThrow();
    }
  });

  it('has unique ids', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it('palettes are valid #rrggbb ramps of 3..6 stops', () => {
    for (const preset of PRESETS) {
      expect(preset.palette.length).toBeGreaterThanOrEqual(3);
      expect(preset.palette.length).toBeLessThanOrEqual(6);
      for (const stop of preset.palette) {
        expect(stop).toMatch(/^#[0-9a-fA-F]{6}$/u);
      }
    }
  });

  it('the directory projection mirrors the presets (id/name/vibe)', () => {
    expect(PRESET_DIRECTORY).toHaveLength(PRESETS.length);
    for (const entry of PRESET_DIRECTORY) {
      const source = getPreset(entry.id);
      expect(source).toBeDefined();
      expect(entry.name).toBe(source?.name);
      expect(entry.vibe).toBe(source?.vibe);
    }
  });
});

describe('getPresetOrDefault', () => {
  it('returns the requested preset when known', () => {
    expect(getPresetOrDefault('molten-swirl').id).toBe('molten-swirl');
  });

  it('falls back to the default for an unknown id (never throws)', () => {
    expect(getPresetOrDefault('does-not-exist').id).toBe(DEFAULT_PRESET_ID);
  });
});

describe('presetSchema — the guard', () => {
  const valid = PRESETS[0]!;

  it('rejects a negative lifetime', () => {
    const bad = { ...valid, flow: { ...valid.flow, lifetime: -1 } };
    expect(() => presetSchema.parse(bad)).toThrow();
  });

  it('rejects a palette with too few stops', () => {
    const bad = { ...valid, palette: ['#000000', '#ffffff'] };
    expect(() => presetSchema.parse(bad)).toThrow();
  });

  it('rejects a malformed hex stop', () => {
    const bad = { ...valid, palette: ['#000000', '#fff', '#ffffff'] };
    expect(() => presetSchema.parse(bad)).toThrow();
  });

  it('rejects an out-of-range bloom strength', () => {
    const bad = { ...valid, post: { ...valid.post, bloomStrength: 99 } };
    expect(() => presetSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown blend mode', () => {
    const bad = {
      ...valid,
      particle: { ...valid.particle, blend: 'screen' },
    };
    expect(() => presetSchema.parse(bad)).toThrow();
  });

  it('rejects a non-kebab-case id', () => {
    const bad = { ...valid, id: 'Not Kebab' };
    expect(() => presetSchema.parse(bad)).toThrow();
  });
});
