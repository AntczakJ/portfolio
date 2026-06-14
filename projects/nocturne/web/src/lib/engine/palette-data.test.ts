import { describe, expect, it } from 'vitest';

import type { Rgb } from './preset-uniforms';
import { buildPaletteData, PALETTE_TEXTURE_WIDTH } from './palette-data';

describe('palette-data (pure ramp → 1D gradient texture)', () => {
  it('produces width*4 RGBA8 bytes, fully opaque', () => {
    const ramp: Rgb[] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    const data = buildPaletteData(ramp);
    expect(data.length).toBe(PALETTE_TEXTURE_WIDTH * 4);
    for (let x = 0; x < PALETTE_TEXTURE_WIDTH; x += 1) {
      expect(data[x * 4 + 3]).toBe(255);
    }
  });

  it('lands the endpoints exactly on the first/last stop', () => {
    const ramp: Rgb[] = [
      [0, 0, 0],
      [0.5, 0.25, 0.75],
      [1, 1, 1],
    ];
    const data = buildPaletteData(ramp, 9);
    // first pixel = first stop (black)
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    // last pixel = last stop (white)
    const last = (9 - 1) * 4;
    expect(data[last]).toBe(255);
    expect(data[last + 1]).toBe(255);
    expect(data[last + 2]).toBe(255);
  });

  it('interpolates the midpoint between two stops', () => {
    const ramp: Rgb[] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    const data = buildPaletteData(ramp, 3); // pixels at t = 0, 0.5, 1
    const mid = 1 * 4;
    expect(data[mid]).toBeCloseTo(128, -1); // ~0.5 * 255
  });

  it('handles a single-stop ramp as a flat colour', () => {
    const data = buildPaletteData([[0.2, 0.4, 0.6]], 4);
    for (let x = 0; x < 4; x += 1) {
      expect(data[x * 4]).toBe(51); // 0.2*255
      expect(data[x * 4 + 1]).toBe(102); // 0.4*255
      expect(data[x * 4 + 2]).toBe(153); // 0.6*255
    }
  });

  it('handles an empty ramp without throwing (opaque black)', () => {
    const data = buildPaletteData([], 4);
    expect(data.length).toBe(16);
    for (let x = 0; x < 4; x += 1) {
      expect(data[x * 4]).toBe(0);
      expect(data[x * 4 + 3]).toBe(255);
    }
  });

  it('clamps out-of-range channel values into [0,255]', () => {
    const data = buildPaletteData([[-1, 2, 0.5]], 2);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(128);
  });
});
