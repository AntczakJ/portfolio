import { faker } from '@faker-js/faker';
import length from '@turf/length';
import { lineString } from '@turf/helpers';
import {
  routeSchema,
  routeStopSchema,
  vehicleSchema,
  zoneSchema,
  type LineStringGeometry,
  type PolygonGeometry,
  type Route,
  type RouteStop,
  type Vehicle,
  type VehicleType,
  type Zone,
} from 'atlas-shared/schemas';

import type { BaselineInput } from '../engine/baseline/build-baseline.js';
import {
  PORTO_ROUTES,
  PORTO_ZONES,
  SIM_SEED,
  VEHICLES_PER_ROUTE,
  type AuthoredRoute,
} from './porto-geometry.js';

/**
 * The Porto demo fixture (Task 3.3) — the FROZEN seeded baseline (ADR-002 B1 /
 * ADR-005).
 *
 * Turns the hand-authored static geometry (porto-geometry.ts) into validated
 * shared-schema entities (Route / RouteStop / Zone / Vehicle), and the fleet via
 * a SINGLE `faker.seed(SIM_SEED)` pass off the hot path — labels, types, and
 * per-vehicle base speeds are faker-derived but DETERMINISTIC and reproducible
 * (same seed -> byte-identical fleet, the portfolio determinism discipline).
 * faker is used ONLY here, once, at build/seed time — never in the tick loop
 * (the CSP/faker gotcha: faker stays off the runtime-eval hot path).
 *
 * Every entity is parsed through its Zod schema before it leaves this module, so
 * a malformed authored coordinate is caught at seed time, not at engine start.
 * Route `lengthM` is precomputed via turf `length` (metres) so the snapshot read
 * does not recompute it.
 *
 * The result feeds BOTH the DB seed (seed.ts persists these rows) AND the engine
 * baseline (buildBaseline consumes the same definitions) — one source, no drift.
 */

function toLineString(route: AuthoredRoute): LineStringGeometry {
  return {
    type: 'LineString',
    coordinates: route.geometry.map(([lng, lat]) => [lng, lat]),
  };
}

function toPolygon(ring: readonly (readonly [number, number])[]): PolygonGeometry {
  return {
    type: 'Polygon',
    coordinates: [ring.map(([lng, lat]) => [lng, lat])],
  };
}

/** Build the validated routes (with precomputed metre length). */
export function buildRoutes(): Route[] {
  return PORTO_ROUTES.map((authored) => {
    const geometry = toLineString(authored);
    const lengthM = length(lineString(geometry.coordinates), { units: 'meters' });
    return routeSchema.parse({
      id: authored.id,
      name: authored.name,
      geometry,
      lengthM,
      loopMode: authored.loopMode,
    } satisfies Route);
  });
}

/** Build the validated route stops (flattened across routes). */
export function buildStops(): RouteStop[] {
  const stops: RouteStop[] = [];
  for (const authored of PORTO_ROUTES) {
    for (const stop of authored.stops) {
      stops.push(
        routeStopSchema.parse({
          id: stop.id,
          routeId: authored.id,
          seq: stop.seq,
          name: stop.name,
          point: { type: 'Point', coordinates: [stop.point[0], stop.point[1]] },
          dwellSeconds: stop.dwellSeconds,
        } satisfies RouteStop),
      );
    }
  }
  return stops;
}

/** Build the validated zones. */
export function buildZones(): Zone[] {
  return PORTO_ZONES.map((authored) =>
    zoneSchema.parse({
      id: authored.id,
      name: authored.name,
      kind: authored.kind,
      geometry: toPolygon(authored.ring),
    } satisfies Zone),
  );
}

const VEHICLE_TYPES: readonly VehicleType[] = ['van', 'truck', 'courier'];

/**
 * Build the validated fleet via a single deterministic faker pass. ~18 vehicles
 * (VEHICLES_PER_ROUTE summed) spread across the routes — a lively-but-legible
 * fleet (ADR-005: ~12-30). Labels are sequential ("Unit 1".."Unit N") so the
 * fleet table reads cleanly; type + base speed are faker-derived but seeded.
 */
export function buildVehicles(): Vehicle[] {
  faker.seed(SIM_SEED);
  const vehicles: Vehicle[] = [];
  let n = 0;
  PORTO_ROUTES.forEach((route, routeIdx) => {
    const count = VEHICLES_PER_ROUTE[routeIdx] ?? 2;
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const type = VEHICLE_TYPES[faker.number.int({ min: 0, max: 2 })] ?? 'van';
      // Base cruise speed in m/s: couriers a touch faster, trucks slower.
      const speedBand =
        type === 'courier' ? { min: 9, max: 14 } : type === 'truck' ? { min: 6, max: 10 } : { min: 7, max: 12 };
      const baseSpeedMps = faker.number.float({ ...speedBand, fractionDigits: 1 });
      vehicles.push(
        vehicleSchema.parse({
          id: `veh-${String(n)}`,
          label: `Unit ${String(n)}`,
          type,
          routeId: route.id,
          baseSpeedMps,
          status: 'en_route',
        } satisfies Vehicle),
      );
    }
  });
  return vehicles;
}

/** The complete validated fixture (definitions). */
export interface PortoFixture {
  readonly routes: Route[];
  readonly stops: RouteStop[];
  readonly zones: Zone[];
  readonly vehicles: Vehicle[];
}

/** Build the whole fixture once (deterministic). */
export function buildPortoFixture(): PortoFixture {
  return {
    routes: buildRoutes(),
    stops: buildStops(),
    zones: buildZones(),
    vehicles: buildVehicles(),
  };
}

/** Build the engine {@link BaselineInput} from the fixture. */
export function fixtureToBaselineInput(fixture: PortoFixture): BaselineInput {
  return {
    routes: fixture.routes,
    stops: fixture.stops,
    zones: fixture.zones,
    vehicles: fixture.vehicles,
    prngSeed: SIM_SEED,
  };
}
