import along from '@turf/along';
import { lineString } from '@turf/helpers';
import length from '@turf/length';
import { describe, expect, it } from 'vitest';

import type { LineStringGeometry, PolygonGeometry } from '../schemas/geojson';
import {
  estimateEtaSeconds,
  MIN_ETA_SPEED_MPS,
  pushSpeedSample,
  remainingDistanceToStop,
  ROLLING_SPEED_WINDOW,
  rollingAverageSpeed,
} from './eta';
import { CONFIRM_TICKS, initialGeofenceTracker, isPointInZone, stepGeofence } from './geofence';
import { buildRouteProjector, projectAlongRoute, routeLengthM } from './route';

/**
 * Phase 1 geo smoke tests (the heavy suite is Task 8.1). These pin the
 * load-bearing invariants now: projection agrees with the turf `along` oracle,
 * route length matches turf `length`, and the geofence hysteresis does NOT flap
 * on a boundary skim.
 */

// A simple ~east-then-north L-shaped route near Lisbon, hand-picked.
const ROUTE: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [-9.142, 38.71],
    [-9.135, 38.71],
    [-9.135, 38.716],
  ],
};

describe('route projection', () => {
  it('total length matches turf length (metres)', () => {
    const projector = buildRouteProjector(ROUTE);
    const turfMeters = length(lineString(ROUTE.coordinates), { units: 'meters' });
    expect(routeLengthM(projector)).toBeCloseTo(turfMeters, 1);
  });

  it('projects s -> position within a metre of the turf along() oracle', () => {
    const projector = buildRouteProjector(ROUTE);
    const samples = [0, 0.25, 0.5, 0.75, 1];
    for (const frac of samples) {
      const s = projector.totalLengthM * frac;
      const ours = projectAlongRoute(projector, s);
      const oracle = along(lineString(ROUTE.coordinates), s, { units: 'meters' });
      const [oLng, oLat] = oracle.geometry.coordinates;
      // ~1e-5 degrees is on the order of a metre; assert close.
      expect(ours.lng).toBeCloseTo(oLng ?? 0, 4);
      expect(ours.lat).toBeCloseTo(oLat ?? 0, 4);
    }
  });

  it('clamps s outside [0, length] to the endpoints', () => {
    const projector = buildRouteProjector(ROUTE);
    const start = projectAlongRoute(projector, -100);
    const end = projectAlongRoute(projector, projector.totalLengthM + 100);
    expect(start.lng).toBeCloseTo(-9.142, 6);
    expect(end.lat).toBeCloseTo(38.716, 6);
  });

  it('heading is the first segment bearing near the start (roughly east)', () => {
    const projector = buildRouteProjector(ROUTE);
    const p = projectAlongRoute(projector, 1);
    // Due east is 90 degrees clockwise from north.
    expect(p.headingDeg).toBeGreaterThan(80);
    expect(p.headingDeg).toBeLessThan(100);
  });
});

describe('ETA', () => {
  it('rolling buffer is bounded to the window', () => {
    let buffer: number[] = [];
    for (let i = 0; i < ROLLING_SPEED_WINDOW + 5; i++) {
      buffer = pushSpeedSample(buffer, i);
    }
    expect(buffer.length).toBe(ROLLING_SPEED_WINDOW);
  });

  it('averages the rolling speed buffer', () => {
    expect(rollingAverageSpeed([2, 4, 6])).toBeCloseTo(4, 6);
    expect(rollingAverageSpeed([])).toBe(0);
  });

  it('floors the divisor so a near-stopped vehicle does not report infinity', () => {
    const eta = estimateEtaSeconds(1000, [0, 0, 0]);
    expect(eta).not.toBeNull();
    expect(eta).toBeCloseTo(1000 / MIN_ETA_SPEED_MPS, 3);
  });

  it('returns null when there is no next stop', () => {
    expect(estimateEtaSeconds(null, [5, 5])).toBeNull();
    expect(remainingDistanceToStop(100, null)).toBeNull();
  });

  it('folds dwell remaining into the ETA while at a stop', () => {
    const eta = estimateEtaSeconds(50, [10, 10], 8);
    expect(eta).toBeCloseTo(8 + 50 / 10, 6);
  });

  it('never reports a negative remaining distance for a passed stop', () => {
    expect(remainingDistanceToStop(200, 150)).toBe(0);
  });
});

describe('geofence hysteresis (no-flap invariant)', () => {
  const ZONE: PolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-9.14, 38.71],
        [-9.13, 38.71],
        [-9.13, 38.72],
        [-9.14, 38.72],
        [-9.14, 38.71],
      ],
    ],
  };

  it('point-in-polygon agrees with an obvious inside/outside', () => {
    expect(isPointInZone(-9.135, 38.715, ZONE)).toBe(true);
    expect(isPointInZone(-9.2, 38.715, ZONE)).toBe(false);
  });

  it('fires exactly one enter after CONFIRM_TICKS sustained-inside ticks', () => {
    let tracker = initialGeofenceTracker();
    const transitions: Array<'enter' | 'exit'> = [];
    for (let i = 0; i < CONFIRM_TICKS; i++) {
      const r = stepGeofence(tracker, true);
      tracker = r.tracker;
      if (r.transition) transitions.push(r.transition);
    }
    expect(transitions).toEqual(['enter']);
    expect(tracker.state).toBe('inside');
  });

  it('does NOT flap when a vehicle skims the boundary (raw test oscillates)', () => {
    let tracker = initialGeofenceTracker();
    const transitions: Array<'enter' | 'exit'> = [];
    // Alternating in/out, never CONFIRM_TICKS consecutive of either.
    const skim = [true, false, true, false, true, false, true, false];
    for (const rawInside of skim) {
      const r = stepGeofence(tracker, rawInside);
      tracker = r.tracker;
      if (r.transition) transitions.push(r.transition);
    }
    expect(transitions).toEqual([]);
    // Stays in its initial confirmed state — never flipped.
    expect(tracker.state).toBe('outside');
  });

  it('fires one enter then one exit across a genuine crossing', () => {
    let tracker = initialGeofenceTracker();
    const transitions: Array<'enter' | 'exit'> = [];
    const path = [
      true,
      true, // confirm enter
      true,
      true,
      false,
      false, // confirm exit
      false,
    ];
    for (const rawInside of path) {
      const r = stepGeofence(tracker, rawInside);
      tracker = r.tracker;
      if (r.transition) transitions.push(r.transition);
    }
    expect(transitions).toEqual(['enter', 'exit']);
    expect(tracker.state).toBe('outside');
  });
});
