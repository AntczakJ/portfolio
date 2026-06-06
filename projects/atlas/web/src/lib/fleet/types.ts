/**
 * Local placeholder domain types for the Atlas web client (Phase 2 scaffold).
 *
 * TODO: import from `atlas-shared` (`projects/atlas/src/lib/schemas/`) once
 * Phase 1 (backend-engineer) lands the shared Zod schemas — the FE/BE contract
 * (vehicle, route, stop, zone, telemetry tick, WS frame envelope). These local
 * shapes mirror the PLAN.md "Simulation / mock data shape" + ADR-005 schema so
 * the static map fixture (Phase 2) renders the real geometry shape; when the
 * shared schema arrives they are replaced by the `z.infer` types from it and
 * the static fixture is swapped for the seeded backend snapshot.
 *
 * Geometry is plain GeoJSON (RFC 7946) `[lng, lat]` coordinate order — the
 * MapLibre + turf order. The map wrapper consumes these directly as GeoJSON
 * sources (Task 2.2).
 */

/** Vehicle lifecycle status. Never rendered colour-alone — always with a label. */
export type VehicleStatus = 'en_route' | 'at_stop' | 'idle' | 'returning';

/** Geofence zone classification. */
export type ZoneKind = 'depot' | 'delivery_zone' | 'restricted';

/** A vehicle's static identity + its current authoritative telemetry snapshot.
 * In Phase 2 the position is the seeded static start; Phase 4 makes it live. */
export interface Vehicle {
  id: string;
  label: string;
  type: 'van' | 'truck' | 'courier';
  routeId: string;
  status: VehicleStatus;
  /** Current authoritative position — GeoJSON [lng, lat]. */
  position: [number, number];
  /** Heading in degrees clockwise from north (0 = north). Drives icon-rotate. */
  heading: number;
  /** Current speed, metres per second. */
  speedMps: number;
  /** Distance travelled along the route, metres from the route start. */
  distanceAlongRouteM: number;
  /** Fraction of the route completed, 0..1. */
  progress: number;
  /** Seconds to the next stop (live in Phase 4; static seed in Phase 2). */
  etaSeconds: number;
  /** Id of the zone the vehicle is currently inside, if any. */
  currentZoneId: string | null;
}

/** An ordered stop (pickup / delivery / depot) on a route. */
export interface RouteStop {
  id: string;
  seq: number;
  name: string;
  /** GeoJSON [lng, lat]. */
  point: [number, number];
  dwellSeconds: number;
}

/** A route a vehicle follows — a GeoJSON LineString plus ordered stops. */
export interface Route {
  id: string;
  name: string;
  /** GeoJSON LineString coordinates — array of [lng, lat]. */
  geometry: [number, number][];
  /** Precomputed route length in metres. */
  lengthM: number;
  /** Route-end behaviour (ADR-002). */
  loopMode: 'loop' | 'ping_pong';
  stops: RouteStop[];
}

/** A geofence zone — a GeoJSON Polygon (single ring, [lng, lat]). */
export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** GeoJSON Polygon outer ring — array of [lng, lat], closed (first == last). */
  ring: [number, number][];
}

/** The static seeded world the Phase 2 map renders (stands in for the backend
 * snapshot frame until Phase 4 wires the live WebSocket). */
export interface FleetSnapshot {
  vehicles: Vehicle[];
  routes: Route[];
  zones: Zone[];
}
