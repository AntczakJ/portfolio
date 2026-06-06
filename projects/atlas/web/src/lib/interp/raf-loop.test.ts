import type { LineStringGeometry, Route, VehicleTelemetry } from 'atlas-shared/schemas';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { describe, expect, it } from 'vitest';

import { InterpStore } from './interp-store';
import { RafLoop } from './raf-loop';

/**
 * RafLoop integration (Task 4.2) — the core wow claim made deterministic: with
 * the store fed two authoritative ticks 1 s apart, the marker's screen position
 * CHANGES between ticks (interpolation is live, not stepped). The live-browser
 * E2E asserts the same against a real socket; this pins the math + the loop
 * wiring without a browser.
 */

const ROUTE_GEOM: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [-8.61, 41.14],
    [-8.6, 41.14],
    [-8.6, 41.15],
  ],
};

const ROUTE: Route = {
  id: 'route-test',
  name: 'Test',
  geometry: ROUTE_GEOM,
  lengthM: 2000,
  loopMode: 'loop',
};

function telemetry(s: number, headingDeg: number): VehicleTelemetry {
  return {
    vehicleId: 'veh-1',
    lat: 41.14,
    lng: -8.61,
    headingDeg,
    speedMps: 10,
    routeId: 'route-test',
    distanceAlongRouteM: s,
    progress: s / 2000,
    status: 'en_route',
    nextStopId: null,
    etaSeconds: 60,
    currentZoneId: null,
  };
}

interface Captured {
  vehicles: FeatureCollection<Point>[];
  trails: FeatureCollection<LineString>[];
  remaining: FeatureCollection<LineString>[];
}

function makeTarget(c: Captured) {
  return {
    setVehiclesGeoJSON: (fc: FeatureCollection<Point>) => c.vehicles.push(fc),
    setTrailsGeoJSON: (fc: FeatureCollection<LineString>) => c.trails.push(fc),
    setRemainingGeoJSON: (fc: FeatureCollection<LineString>) => c.remaining.push(fc),
  };
}

function vehicleLng(fc: FeatureCollection<Point> | undefined): number {
  const f = fc?.features[0];
  const lng = f?.geometry.coordinates[0];
  if (lng === undefined) throw new Error('no vehicle feature');
  return lng;
}

describe('RafLoop interpolation', () => {
  it('moves the marker BETWEEN authoritative ticks (not stepped)', () => {
    const store = new InterpStore();
    store.setRoutes([ROUTE]);
    store.setIntervalMs(1000);

    const captured: Captured = { vehicles: [], trails: [], remaining: [] };
    const loop = new RafLoop(store, makeTarget(captured));

    // Two authoritative ticks 1 s apart: s=0 (t0) then s=1000 (t1).
    store.applyTick(telemetry(0, 90), 0);
    store.applyTick(telemetry(1000, 90), 0); // both at clock 0 -> segment [0,1000]

    // Frame at +0 ms -> at the last point; +500 ms -> halfway; +1000 ms -> next.
    loop.tickFrame(0);
    loop.tickFrame(500);
    loop.tickFrame(1000);

    const lng0 = vehicleLng(captured.vehicles[0]);
    const lng500 = vehicleLng(captured.vehicles[1]);
    const lng1000 = vehicleLng(captured.vehicles[2]);

    // The longitude must STRICTLY advance frame to frame — interpolation is live.
    expect(lng500).toBeGreaterThan(lng0);
    expect(lng1000).toBeGreaterThan(lng500);
  });

  it('snaps (no tween) under reduced motion', () => {
    const store = new InterpStore();
    store.setRoutes([ROUTE]);
    store.setReducedMotion(true);

    const captured: Captured = { vehicles: [], trails: [], remaining: [] };
    const loop = new RafLoop(store, makeTarget(captured));

    store.applyTick(telemetry(0, 90), 0);
    store.applyTick(telemetry(1000, 90), 0);

    loop.tickFrame(0);
    loop.tickFrame(500);

    // Reduced-motion holds at the newest authoritative point — no mid-tween move.
    expect(vehicleLng(captured.vehicles[0])).toBeCloseTo(vehicleLng(captured.vehicles[1]), 9);
  });

  it('emits a trail behind and a remaining-route ahead', () => {
    const store = new InterpStore();
    store.setRoutes([ROUTE]);
    const captured: Captured = { vehicles: [], trails: [], remaining: [] };
    const loop = new RafLoop(store, makeTarget(captured));
    loop.setNextStopS('veh-1', 1800);

    // A forward segment so the marker is mid-route with road behind + ahead.
    store.applyTick(telemetry(500, 90), 0);
    store.applyTick(telemetry(900, 90), 0);

    loop.tickFrame(0);

    const trail = captured.trails.at(-1);
    const remaining = captured.remaining.at(-1);
    expect(trail?.features.length).toBe(1);
    expect(remaining?.features.length).toBe(1);
    // The trail + remaining are each multi-point LineStrings.
    expect(trail?.features[0]?.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(remaining?.features[0]?.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
  });
});
