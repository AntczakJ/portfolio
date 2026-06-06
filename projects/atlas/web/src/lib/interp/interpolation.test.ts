import { buildRouteProjector } from 'atlas-shared/geo';
import type { LineStringGeometry } from 'atlas-shared/schemas';
import { describe, expect, it } from 'vitest';

import {
  clamp01,
  interpolatePose,
  lerpHeading,
  normalizeHeading,
  tickProgress,
  type InterpEndpoints,
} from './interpolation';

/**
 * Interpolation math correctness (Task 4.2). This is the wow's core — the lerp
 * along route geometry + the shortest-arc heading blend. The live-channel
 * smoothness is only believable if this is exact, so it is the unit gate that
 * stands in for the parts that need a live browser.
 */

// A simple east-then-north L route (lng/lat). Two equal-ish legs.
const ROUTE: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [-8.61, 41.14],
    [-8.6, 41.14],
    [-8.6, 41.15],
  ],
};

const projector = buildRouteProjector(ROUTE);

describe('clamp01', () => {
  it('clamps below 0 and above 1, passes through the middle', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
  });
});

describe('normalizeHeading', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
  });
});

describe('lerpHeading (shortest arc)', () => {
  it('takes the short way across the 0/360 seam', () => {
    // 350 -> 10 should pass through 0, i.e. midpoint is 0, not 180.
    expect(lerpHeading(350, 10, 0.5)).toBeCloseTo(0, 5);
  });

  it('takes the short way the other direction', () => {
    // 10 -> 350 should pass through 0 (sweeping negative).
    expect(lerpHeading(10, 350, 0.5)).toBeCloseTo(0, 5);
  });

  it('does not cross the seam when the short arc does not', () => {
    // 80 -> 100 midpoint is a plain 90.
    expect(lerpHeading(80, 100, 0.5)).toBeCloseTo(90, 5);
  });

  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerpHeading(40, 200, 0)).toBeCloseTo(40, 5);
    expect(lerpHeading(40, 200, 1)).toBeCloseTo(200, 5);
  });
});

describe('interpolatePose', () => {
  const endpoints: InterpEndpoints = {
    lastS: 0,
    nextS: projector.totalLengthM,
    lastHeadingDeg: 90,
    nextHeadingDeg: 0,
    projector,
  };

  it('lands on the route start at t=0 and the route end at t=1', () => {
    const start = interpolatePose(endpoints, 0);
    const end = interpolatePose(endpoints, 1);
    expect(start.position[0]).toBeCloseTo(-8.61, 4);
    expect(start.position[1]).toBeCloseTo(41.14, 4);
    expect(end.position[0]).toBeCloseTo(-8.6, 4);
    expect(end.position[1]).toBeCloseTo(41.15, 4);
  });

  it('follows the polyline (mid-route sits on a segment, not the chord)', () => {
    // Halfway along the L-route by distance is near the corner vertex, NOT the
    // straight-line midpoint between the two endpoints. The chord midpoint
    // would be ~[-8.605, 41.145]; the on-route point is near the [-8.6, 41.14]
    // corner. Assert the longitude is past the corner's lng (a chord would not
    // reach it at t=0.5 given the two legs are ~equal length).
    const mid = interpolatePose(endpoints, 0.5);
    // The route's two legs are similar length; at t=0.5 we are at/just past the
    // corner. Longitude should be at or beyond -8.6 (the corner), and the chord
    // midpoint (-8.605) is strictly west of that.
    expect(mid.position[0]).toBeGreaterThan(-8.605);
  });

  it('clamps t outside [0,1] (freeze at the newest authoritative point)', () => {
    const beyond = interpolatePose(endpoints, 1.7);
    const end = interpolatePose(endpoints, 1);
    expect(beyond.position[0]).toBeCloseTo(end.position[0], 6);
    expect(beyond.position[1]).toBeCloseTo(end.position[1], 6);
  });
});

describe('tickProgress', () => {
  it('is the elapsed fraction of the interval, clamped at 1', () => {
    expect(tickProgress(0, 1000)).toBe(0);
    expect(tickProgress(500, 1000)).toBe(0.5);
    expect(tickProgress(1000, 1000)).toBe(1);
    // A late next-tick: hold at 1 (freeze), never dead-reckon past.
    expect(tickProgress(2500, 1000)).toBe(1);
  });

  it('guards a zero/negative interval', () => {
    expect(tickProgress(10, 0)).toBe(1);
  });
});
