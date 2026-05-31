import { describe, expect, it } from 'vitest';

import {
  formatOklch,
  lerpOklch,
  mixOklchStrings,
  parseOklch,
} from '../color';

describe('parseOklch', () => {
  it('parses an opaque oklch triple', () => {
    const parsed = parseOklch('oklch(0.74 0.16 155)');
    expect(parsed.L).toBeCloseTo(0.74);
    expect(parsed.C).toBeCloseTo(0.16);
    expect(parsed.H).toBeCloseTo(155);
    expect(parsed.alpha).toBeUndefined();
  });

  it('parses an oklch triple with alpha', () => {
    const parsed = parseOklch('oklch(0.82 0.16 195 / 0.25)');
    expect(parsed.L).toBeCloseTo(0.82);
    expect(parsed.alpha).toBeCloseTo(0.25);
  });

  it('tolerates extra whitespace', () => {
    const parsed = parseOklch('  oklch(  0.5   0.1   200  )  ');
    expect(parsed.L).toBeCloseTo(0.5);
  });

  it('throws on malformed input', () => {
    expect(() => parseOklch('rgb(1, 2, 3)')).toThrow(/parseOklch/);
    expect(() => parseOklch('oklch()')).toThrow(/parseOklch/);
  });
});

describe('formatOklch', () => {
  it('round-trips a parsed triple', () => {
    const original = 'oklch(0.74 0.16 155)';
    const parsed = parseOklch(original);
    const formatted = formatOklch(parsed);
    expect(formatted).toBe(original);
  });

  it('preserves alpha when present', () => {
    const original = 'oklch(0.82 0.16 195 / 0.25)';
    const parsed = parseOklch(original);
    const formatted = formatOklch(parsed);
    expect(formatted).toBe(original);
  });
});

describe('lerpOklch', () => {
  const a = parseOklch('oklch(0.2 0.05 100)');
  const b = parseOklch('oklch(0.8 0.15 120)');

  it('returns a at t=0', () => {
    const out = lerpOklch(a, b, 0);
    expect(out.L).toBeCloseTo(0.2);
    expect(out.C).toBeCloseTo(0.05);
    expect(out.H).toBeCloseTo(100);
  });

  it('returns b at t=1', () => {
    const out = lerpOklch(a, b, 1);
    expect(out.L).toBeCloseTo(0.8);
    expect(out.C).toBeCloseTo(0.15);
    expect(out.H).toBeCloseTo(120);
  });

  it('returns the midpoint at t=0.5', () => {
    const out = lerpOklch(a, b, 0.5);
    expect(out.L).toBeCloseTo(0.5);
    expect(out.C).toBeCloseTo(0.1);
    expect(out.H).toBeCloseTo(110);
  });

  it('clamps t below 0 and above 1', () => {
    const below = lerpOklch(a, b, -1);
    const above = lerpOklch(a, b, 2);
    expect(below.L).toBeCloseTo(0.2);
    expect(above.L).toBeCloseTo(0.8);
  });

  it('takes the short arc on hue', () => {
    const dark = parseOklch('oklch(0.5 0.2 350)');
    const light = parseOklch('oklch(0.5 0.2 10)');
    // Short arc from 350 -> 10 is +20° (passing through 0), midpoint
    // should be at 0 (mod 360), not at 180.
    const mid = lerpOklch(dark, light, 0.5);
    expect(mid.H).toBeCloseTo(0);
  });
});

describe('mixOklchStrings', () => {
  it('returns a valid oklch() string', () => {
    const out = mixOklchStrings(
      'oklch(0.2 0.05 100)',
      'oklch(0.8 0.15 120)',
      0.5,
    );
    expect(out).toMatch(/^oklch\(/);
    const parsed = parseOklch(out);
    expect(parsed.L).toBeCloseTo(0.5);
  });
});
