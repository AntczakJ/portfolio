import { describe, expect, it } from 'vitest';

import { easeOutExpo, easeOutQuart } from './easing';

describe('easeOutExpo', () => {
  it('lands exactly on the endpoints (so a settled cross-fade hits the target)', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it('clamps out-of-range progress to the endpoints', () => {
    expect(easeOutExpo(-0.5)).toBe(0);
    expect(easeOutExpo(2)).toBe(1);
  });

  it('decelerates: front-loaded (eased(t) > t for t in (0,1))', () => {
    // ease-OUT means most of the distance is covered early, then it eases in.
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.25);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.5);
    expect(easeOutExpo(0.5)).toBeCloseTo(1 - Math.pow(2, -5), 6);
  });

  it('is monotonically increasing across the range', () => {
    let prev = easeOutExpo(0);
    for (let i = 1; i <= 20; i += 1) {
      const t = i / 20;
      const v = easeOutExpo(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('easeOutQuart', () => {
  it('lands exactly on the endpoints', () => {
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
  });

  it('clamps out-of-range progress', () => {
    expect(easeOutQuart(-1)).toBe(0);
    expect(easeOutQuart(1.5)).toBe(1);
  });

  it('is front-loaded and monotonic', () => {
    expect(easeOutQuart(0.5)).toBeCloseTo(1 - Math.pow(0.5, 4), 6);
    expect(easeOutQuart(0.5)).toBeGreaterThan(0.5);
    let prev = easeOutQuart(0);
    for (let i = 1; i <= 20; i += 1) {
      const v = easeOutQuart(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
