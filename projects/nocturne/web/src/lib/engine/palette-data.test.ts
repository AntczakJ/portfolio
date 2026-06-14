import { describe, expect, it } from 'vitest';

import type { Rgb } from './preset-uniforms';
import {
  buildPaletteData,
  PALETTE_TEXTURE_WIDTH,
  writePaletteData,
} from './palette-data';

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

describe('writePaletteData (allocation-free hot-path variant — FIX 3)', () => {
  const RAMPS: Rgb[][] = [
    [
      [0, 0, 0],
      [1, 1, 1],
    ],
    [
      [0.5, 0.25, 0.75],
      [0.1, 0.9, 0.3],
      [1, 0, 0.4],
    ],
    [[0.2, 0.4, 0.6]], // single stop
    [], // empty
    [[-1, 2, 0.5]], // out of range
  ];

  it('produces byte-identical output to buildPaletteData for every ramp', () => {
    for (const ramp of RAMPS) {
      const built = buildPaletteData(ramp);
      const out = new Uint8Array(PALETTE_TEXTURE_WIDTH * 4);
      const written = writePaletteData(ramp, out);
      expect(written).toBe(out); // returns the same buffer it was handed
      expect(Array.from(out)).toEqual(Array.from(built));
    }
  });

  it('respects an explicit width and stays byte-identical', () => {
    const ramp: Rgb[] = [
      [0, 0, 0],
      [0.5, 0.25, 0.75],
      [1, 1, 1],
    ];
    const out = new Uint8Array(9 * 4);
    writePaletteData(ramp, out, 9);
    expect(Array.from(out)).toEqual(Array.from(buildPaletteData(ramp, 9)));
  });

  it('does NOT allocate a new buffer — it reuses the one passed in (the hot-path invariant)', () => {
    const out = new Uint8Array(PALETTE_TEXTURE_WIDTH * 4);
    const first = writePaletteData(
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
      out,
    );
    const second = writePaletteData(
      [
        [1, 0, 0],
        [0, 0, 1],
      ],
      out,
    );
    // Both calls return the SAME instance (no per-call allocation), and the
    // second ramp overwrote the first in place.
    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(out[0]).toBe(255); // first channel of the second ramp's first stop
  });

  it('fully overwrites stale bytes when re-written with a shorter/empty ramp', () => {
    const out = new Uint8Array(4 * 4);
    writePaletteData(
      [
        [1, 1, 1],
        [1, 1, 1],
      ],
      out,
      4,
    );
    expect(out[0]).toBe(255);
    // empty ramp must reset RGB to 0 (opaque black), not leave the old white
    writePaletteData([], out, 4);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
  });
});
