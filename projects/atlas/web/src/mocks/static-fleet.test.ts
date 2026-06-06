import { describe, expect, it } from 'vitest';

import { DEMO_CITY_BBOX } from '@/lib/fleet/demo-city';

import { getStaticFleetSnapshot } from './static-fleet';

/**
 * Phase 2 sanity suite for the static map fixture. Locks the two things the map
 * wrapper relies on: determinism (same seed → same fleet) and that all authored
 * geometry sits inside the keyless `.pmtiles` bbox (so the basemap covers it).
 * The heavy engine/geo/WS suites are Phase 8 (test-engineer).
 */

function insideBbox([lng, lat]: [number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = DEMO_CITY_BBOX;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

describe('static fleet fixture', () => {
  it('is deterministic across calls (seeded)', () => {
    const a = getStaticFleetSnapshot();
    const b = getStaticFleetSnapshot();
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('produces a lively-but-legible fleet', () => {
    const { vehicles } = getStaticFleetSnapshot();
    expect(vehicles.length).toBeGreaterThanOrEqual(8);
    expect(vehicles.length).toBeLessThanOrEqual(30);
  });

  it('places every vehicle inside the keyless basemap bbox', () => {
    const { vehicles } = getStaticFleetSnapshot();
    for (const v of vehicles) {
      expect(insideBbox(v.position), `${v.id} at ${v.position.join(',')}`).toBe(true);
    }
  });

  it('keeps every route vertex inside the basemap bbox', () => {
    const { routes } = getStaticFleetSnapshot();
    for (const route of routes) {
      for (const coord of route.geometry) {
        expect(insideBbox(coord), `${route.id} vertex`).toBe(true);
      }
    }
  });

  it('gives every vehicle a heading and a route', () => {
    const { vehicles, routes } = getStaticFleetSnapshot();
    const routeIds = new Set(routes.map((r) => r.id));
    for (const v of vehicles) {
      expect(v.heading).toBeGreaterThanOrEqual(0);
      expect(v.heading).toBeLessThanOrEqual(360);
      expect(routeIds.has(v.routeId)).toBe(true);
    }
  });
});
