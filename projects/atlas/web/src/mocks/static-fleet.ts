import { faker } from '@faker-js/faker';

import type { FleetSnapshot, Route, Vehicle, VehicleStatus, Zone } from '@/lib/fleet/types';

/**
 * Static seeded fleet fixture — Phase 2 map placeholder (conventions § 6).
 *
 * TODO: replaced by the backend's seeded snapshot frame once Phase 4 wires the
 * live WebSocket. For now this renders a believable STATIC fleet on the map so
 * the integration boundary (Task 2.2) can be built + reviewed without the
 * backend. Geometry is hand-authored over Porto's downtown core (demo-city.ts);
 * the fleet's labels/types are `faker.seed`-deterministic so the fixture is
 * stable across reloads, tests, and screenshots (the portfolio determinism
 * discipline). Positions/headings are computed deterministically along each
 * route — no live motion (that is Phase 4's rAF interpolation).
 *
 * Coordinates are GeoJSON [lng, lat]. Routes follow plausible road corridors in
 * Baixa / Aliados / Ribeira; zones are a depot + two delivery zones.
 */

const SEED = 41_1496; // Porto-flavoured deterministic seed.

/* -------------------------------------------------------------------------
 * Hand-authored route corridors (GeoJSON LineString coordinates).
 * Each polyline follows a plausible set of central-Porto streets so the
 * markers sit on real road geometry under the keyless basemap.
 * --------------------------------------------------------------------- */

const ROUTE_GEOMETRIES: Record<string, [number, number][]> = {
  'route-aliados': [
    [-8.6112, 41.1466],
    [-8.6109, 41.1483],
    [-8.6107, 41.1496],
    [-8.6105, 41.1509],
    [-8.6098, 41.1521],
    [-8.6082, 41.1528],
    [-8.6064, 41.1531],
  ],
  'route-ribeira': [
    [-8.6133, 41.1409],
    [-8.6118, 41.1413],
    [-8.6102, 41.142],
    [-8.6089, 41.143],
    [-8.6083, 41.1444],
    [-8.6087, 41.1459],
    [-8.61, 41.1468],
  ],
  'route-baixa': [
    [-8.6168, 41.1472],
    [-8.6149, 41.1475],
    [-8.6131, 41.1481],
    [-8.6116, 41.149],
    [-8.6104, 41.1502],
    [-8.609, 41.1512],
  ],
  'route-bolhao': [
    [-8.6075, 41.1471],
    [-8.6068, 41.1485],
    [-8.6058, 41.1498],
    [-8.6044, 41.1507],
    [-8.6028, 41.1512],
    [-8.6012, 41.1514],
  ],
};

const ROUTE_NAMES: Record<string, string> = {
  'route-aliados': 'Aliados Loop',
  'route-ribeira': 'Ribeira Riverside',
  'route-baixa': 'Baixa Cross-town',
  'route-bolhao': 'Bolhao Run',
};

const ROUTE_LOOP_MODE: Record<string, Route['loopMode']> = {
  'route-aliados': 'loop',
  'route-ribeira': 'ping_pong',
  'route-baixa': 'ping_pong',
  'route-bolhao': 'loop',
};

/* -------------------------------------------------------------------------
 * Pure geometry helpers — a lightweight stand-in for the shared `src/lib/geo/`
 * module (Phase 1, backend-engineer). Kept minimal: just enough to place a
 * static marker at a fraction along a polyline and face it down the segment.
 * The authoritative versions (turf-backed, units-pinned) arrive with the geo
 * module; these are deliberately self-contained for the Phase 2 fixture only.
 * --------------------------------------------------------------------- */

/** Approximate planar length of a [lng,lat] segment, scaled to metres-ish.
 * Good enough to distribute static markers proportionally along a polyline;
 * the real length uses turf haversine in the geo module. */
function segmentLength(a: [number, number], b: [number, number]): number {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(latRad);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

function routeTotalLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const curr = coords[i];
    if (!prev || !curr) continue;
    total += segmentLength(prev, curr);
  }
  return total;
}

/** Bearing in degrees clockwise from north for a [lng,lat] segment. */
function segmentBearing(a: [number, number], b: [number, number]): number {
  const lat1 = a[1] * (Math.PI / 180);
  const lat2 = b[1] * (Math.PI / 180);
  const dLng = (b[0] - a[0]) * (Math.PI / 180);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** Point + heading at fraction `t` (0..1) along a polyline. */
function pointAlong(
  coords: [number, number][],
  t: number,
): { position: [number, number]; heading: number } {
  const total = routeTotalLength(coords);
  const target = total * Math.min(Math.max(t, 0), 1);
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    if (!a || !b) continue;
    const len = segmentLength(a, b);
    if (acc + len >= target || i === coords.length - 1) {
      const local = len === 0 ? 0 : (target - acc) / len;
      const position: [number, number] = [
        a[0] + (b[0] - a[0]) * local,
        a[1] + (b[1] - a[1]) * local,
      ];
      return { position, heading: segmentBearing(a, b) };
    }
    acc += len;
  }
  const last = coords[coords.length - 1] ?? coords[0] ?? [0, 0];
  return { position: last, heading: 0 };
}

/* -------------------------------------------------------------------------
 * Hand-authored zones (GeoJSON Polygon outer rings, closed).
 * --------------------------------------------------------------------- */

const ZONES: Zone[] = [
  {
    id: 'zone-depot-campanha',
    name: 'Central Depot',
    kind: 'depot',
    ring: [
      [-8.6075, 41.1455],
      [-8.6048, 41.1455],
      [-8.6048, 41.1474],
      [-8.6075, 41.1474],
      [-8.6075, 41.1455],
    ],
  },
  {
    id: 'zone-delivery-aliados',
    name: 'Aliados Delivery',
    kind: 'delivery_zone',
    ring: [
      [-8.6122, 41.1492],
      [-8.6092, 41.1492],
      [-8.6092, 41.1518],
      [-8.6122, 41.1518],
      [-8.6122, 41.1492],
    ],
  },
  {
    id: 'zone-delivery-ribeira',
    name: 'Ribeira Delivery',
    kind: 'delivery_zone',
    ring: [
      [-8.6128, 41.1408],
      [-8.6088, 41.1408],
      [-8.6088, 41.1436],
      [-8.6128, 41.1436],
      [-8.6128, 41.1408],
    ],
  },
];

/* -------------------------------------------------------------------------
 * Build routes (with one or two stops each) + a static fleet distributed
 * along the routes. Deterministic via faker.seed.
 * --------------------------------------------------------------------- */

function buildRoutes(): Route[] {
  return Object.entries(ROUTE_GEOMETRIES).map(([id, geometry]) => {
    const lengthM = routeTotalLength(geometry) * 111_320; // deg → metres-ish
    const fallback: [number, number] = geometry[0] ?? [0, 0];
    const last = geometry[geometry.length - 1] ?? fallback;
    const mid = geometry[Math.floor(geometry.length / 2)] ?? fallback;
    return {
      id,
      name: ROUTE_NAMES[id] ?? id,
      geometry,
      lengthM: Math.round(lengthM),
      loopMode: ROUTE_LOOP_MODE[id] ?? 'loop',
      stops: [
        {
          id: `${id}-stop-1`,
          seq: 0,
          name: 'Pickup',
          point: mid,
          dwellSeconds: 30,
        },
        {
          id: `${id}-stop-2`,
          seq: 1,
          name: 'Delivery',
          point: last,
          dwellSeconds: 45,
        },
      ],
    } satisfies Route;
  });
}

const VEHICLE_TYPES: Vehicle['type'][] = ['van', 'truck', 'courier'];
const STATUSES: VehicleStatus[] = ['en_route', 'en_route', 'at_stop', 'returning'];

function buildVehicles(routes: Route[]): Vehicle[] {
  faker.seed(SEED);
  const vehicles: Vehicle[] = [];
  // ~10 vehicles distributed across the routes (a lively-but-legible fleet).
  const perRoute = [3, 3, 2, 2];
  routes.forEach((route, routeIdx) => {
    const count = perRoute[routeIdx] ?? 2;
    for (let i = 0; i < count; i += 1) {
      const t = (i + 1) / (count + 1); // spread evenly, avoid the endpoints
      const { position, heading } = pointAlong(route.geometry, t);
      const status =
        STATUSES[(routeIdx + i) % STATUSES.length] ?? 'en_route';
      const type = VEHICLE_TYPES[faker.number.int({ min: 0, max: 2 })] ?? 'van';
      const idNum = vehicles.length + 1;
      vehicles.push({
        id: `veh-${String(idNum)}`,
        label: `Unit ${String(idNum)}`,
        type,
        routeId: route.id,
        status,
        position,
        heading: Math.round(heading),
        speedMps:
          status === 'at_stop' ? 0 : faker.number.float({ min: 6, max: 13, fractionDigits: 1 }),
        distanceAlongRouteM: Math.round(route.lengthM * t),
        progress: Number(t.toFixed(3)),
        etaSeconds:
          status === 'at_stop'
            ? faker.number.int({ min: 10, max: 45 })
            : faker.number.int({ min: 60, max: 600 }),
        currentZoneId: null,
      });
    }
  });
  return vehicles;
}

/** The deterministic static snapshot the Phase 2 map renders. */
export function getStaticFleetSnapshot(): FleetSnapshot {
  const routes = buildRoutes();
  const vehicles = buildVehicles(routes);
  return { vehicles, routes, zones: ZONES };
}
