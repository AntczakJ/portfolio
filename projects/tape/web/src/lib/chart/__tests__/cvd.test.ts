/**
 * CVD painter pure-helper coverage (Task 3.2c).
 *
 * The painter draws pixels (untestable in jsdom without brittle canvas
 * mocking), but its scale math is pure and load-bearing: the slope
 * classification feeds the colour choice + the SR slope word, the value
 * range must always straddle zero so the baseline is visible, and the
 * value→Y map must be monotonic with higher CVD higher on screen.
 */
import { describe, expect, it } from 'vitest';

import {
  cvdSlopeDirection,
  cvdValueRange,
  cvdValueToY,
} from '../painters/cvd';
import type { BarRegion } from '../scale';
import type { CvdPoint } from '@/lib/stores/stream-store';

function pt(bucketTs: number, cvd: number): CvdPoint {
  return { bucketTs, cvd };
}

const region: BarRegion = { x: 0, y: 0, w: 200, h: 100 };

describe('cvdSlopeDirection', () => {
  it('is flat for fewer than two points', () => {
    expect(cvdSlopeDirection([])).toBe(0);
    expect(cvdSlopeDirection([pt(1, 5)])).toBe(0);
  });

  it('is +1 when the last segment rises', () => {
    expect(cvdSlopeDirection([pt(1, 2), pt(2, 5)])).toBe(1);
  });

  it('is -1 when the last segment falls', () => {
    expect(cvdSlopeDirection([pt(1, 5), pt(2, 1)])).toBe(-1);
  });

  it('is 0 when the last segment is flat', () => {
    expect(cvdSlopeDirection([pt(1, 3), pt(2, 3)])).toBe(0);
  });

  it('reads only the final segment, ignoring earlier shape', () => {
    expect(cvdSlopeDirection([pt(1, 10), pt(2, 1), pt(3, 4)])).toBe(1);
  });
});

describe('cvdValueRange', () => {
  it('always includes zero', () => {
    expect(cvdValueRange([pt(1, 5), pt(2, 9)])).toEqual({ min: 0, max: 9 });
    expect(cvdValueRange([pt(1, -3), pt(2, -8)])).toEqual({ min: -8, max: 0 });
  });

  it('spans the full negative-to-positive extent', () => {
    expect(cvdValueRange([pt(1, -4), pt(2, 7)])).toEqual({ min: -4, max: 7 });
  });

  it('expands a degenerate zero-span range so it never divides by zero', () => {
    const r = cvdValueRange([]);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

describe('cvdValueToY', () => {
  it('maps higher CVD to a lower Y (higher on screen)', () => {
    const range = { min: -10, max: 10 };
    const yHigh = cvdValueToY(10, range, region);
    const yLow = cvdValueToY(-10, range, region);
    expect(yHigh).toBeLessThan(yLow);
  });

  it('places zero between the min and max Y', () => {
    const range = { min: -10, max: 10 };
    const yZero = cvdValueToY(0, range, region);
    const yMax = cvdValueToY(10, range, region);
    const yMin = cvdValueToY(-10, range, region);
    expect(yZero).toBeGreaterThan(yMax);
    expect(yZero).toBeLessThan(yMin);
  });

  it('keeps the line inside the padded region', () => {
    const range = { min: 0, max: 100 };
    const yTop = cvdValueToY(100, range, region);
    const yBottom = cvdValueToY(0, range, region);
    expect(yTop).toBeGreaterThanOrEqual(region.y);
    expect(yBottom).toBeLessThanOrEqual(region.y + region.h);
  });
});
