/**
 * Adapt the shared WS `SnapshotFrame` (atlas-shared/schemas/ws) to the web map's
 * `FleetSnapshot` shape (the controller's existing input, Task 2.2).
 *
 * The snapshot frame carries the STATIC world definitions (vehicle metadata,
 * routes, stops, zones) PLUS the current authoritative `telemetry[]`. The map
 * controller consumes a `FleetSnapshot` (vehicles with a live position/heading,
 * routes with their stops nested, zones with a flat ring). This is the one
 * boundary that bridges the two shapes; everything downstream stays on the
 * web-local `FleetSnapshot` so the Phase-2 map layers are unchanged.
 *
 * Types are imported TYPE-ONLY from atlas-shared (verbatimModuleSyntax erases
 * Zod from the browser bundle — the frames come from our own trusted gateway and
 * are narrowed structurally on the client, not re-validated with Zod).
 */

import type {
  Route as SharedRoute,
  RouteStop as SharedStop,
  SnapshotFrame,
  Vehicle as SharedVehicle,
  VehicleTelemetry,
  Zone as SharedZone,
} from 'atlas-shared/schemas';

import type { FleetSnapshot, Route, RouteStop, Vehicle, Zone } from '@/lib/fleet/types';

function adaptStop(stop: SharedStop): RouteStop {
  return {
    id: stop.id,
    seq: stop.seq,
    name: stop.name,
    point: [stop.point.coordinates[0], stop.point.coordinates[1]],
    dwellSeconds: stop.dwellSeconds,
  };
}

function adaptRoute(route: SharedRoute, stops: readonly SharedStop[]): Route {
  return {
    id: route.id,
    name: route.name,
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
    lengthM: route.lengthM,
    loopMode: route.loopMode,
    stops: stops
      .filter((s) => s.routeId === route.id)
      .sort((a, b) => a.seq - b.seq)
      .map(adaptStop),
  };
}

function adaptZone(zone: SharedZone): Zone {
  const ring = zone.geometry.coordinates[0] ?? [];
  return {
    id: zone.id,
    name: zone.name,
    kind: zone.kind,
    ring: ring.map(([lng, lat]) => [lng, lat]),
  };
}

function adaptVehicle(vehicle: SharedVehicle, telemetry: VehicleTelemetry | undefined): Vehicle {
  return {
    id: vehicle.id,
    label: vehicle.label,
    type: vehicle.type,
    routeId: vehicle.routeId,
    status: telemetry?.status ?? vehicle.status,
    position: telemetry ? [telemetry.lng, telemetry.lat] : [0, 0],
    heading: telemetry?.headingDeg ?? 0,
    speedMps: telemetry?.speedMps ?? 0,
    distanceAlongRouteM: telemetry?.distanceAlongRouteM ?? 0,
    progress: telemetry?.progress ?? 0,
    etaSeconds: telemetry?.etaSeconds ?? 0,
    currentZoneId: telemetry?.currentZoneId ?? null,
  };
}

/** Build the web `FleetSnapshot` the map controller renders from a WS frame. */
export function snapshotFrameToFleet(frame: SnapshotFrame): FleetSnapshot {
  const telemetryByVehicle = new Map<string, VehicleTelemetry>();
  for (const t of frame.telemetry) telemetryByVehicle.set(t.vehicleId, t);

  return {
    vehicles: frame.vehicles.map((v) => adaptVehicle(v, telemetryByVehicle.get(v.id))),
    routes: frame.routes.map((r) => adaptRoute(r, frame.stops)),
    zones: frame.zones.map(adaptZone),
  };
}
