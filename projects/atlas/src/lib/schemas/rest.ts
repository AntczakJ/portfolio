import { z } from 'zod';

import { routeSchema } from './route';
import { routeStopSchema } from './stop';
import { vehicleTelemetrySchema } from './telemetry';
import { vehicleSchema } from './vehicle';
import { zoneSchema } from './zone';

/**
 * Public read REST response contract (PLAN.md Task 6.3 backend portion, ADR-005).
 *
 * These are the shapes the rate-limited public GET endpoints serve, and the type
 * surface the web SSR floor / no-WebGL initial paint / external consumers read.
 * They are SHARED here (conventions section 5) so the web side imports the
 * response TYPES (types-only — Zod erased from the browser bundle) and the
 * Fastify server uses the SCHEMAS as its `fastify-type-provider-zod` serializer
 * compilers — one source of truth for the read surface, no duplicated DTO.
 *
 * The endpoints serve DB-LESS from the in-memory engine (ADR-005: the engine is
 * the live source of truth; this keeps the read surface available without a
 * reachable Postgres, exactly like the WS channel). The snapshot is LIVE (the
 * current authoritative per-vehicle telemetry); the definitions (routes / zones
 * / vehicles) are STATIC for a run.
 *
 * The snapshot response is deliberately a SUPERSET-compatible cousin of the WS
 * `snapshot` frame (same telemetry + definitions payload) but without the WS
 * envelope (`t` / `seq` / `protocolVersion`): a REST consumer does not need the
 * frame-stream metadata, and reusing the WS frame shape verbatim would leak the
 * transport into the read contract.
 */

/**
 * `GET /api/fleet/snapshot` — the current authoritative per-vehicle telemetry
 * snapshot plus the static definitions a cold consumer needs to render it. The
 * SSR floor renders the fleet table from `telemetry` joined to `vehicles`; the
 * map preview renders `routes` / `zones`.
 */
export const fleetSnapshotResponseSchema = z.object({
  /** The engine tick index this snapshot reflects. */
  serverTick: z.number().int().nonnegative(),
  /** Server emit time, epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  /** Static vehicle metadata (identity / label / type / route assignment). */
  vehicles: z.array(vehicleSchema),
  /** The current authoritative telemetry of every vehicle (live). */
  telemetry: z.array(vehicleTelemetrySchema),
});
export type FleetSnapshotResponse = z.infer<typeof fleetSnapshotResponseSchema>;

/**
 * `GET /api/routes` — the route definitions (GeoJSON LineStrings + the ordered
 * stops per route). Static for a run.
 */
export const routesResponseSchema = z.object({
  routes: z.array(routeSchema),
  stops: z.array(routeStopSchema),
});
export type RoutesResponse = z.infer<typeof routesResponseSchema>;

/**
 * `GET /api/zones` — the zone / geofence polygons. Static for a run.
 */
export const zonesResponseSchema = z.object({
  zones: z.array(zoneSchema),
});
export type ZonesResponse = z.infer<typeof zonesResponseSchema>;

/**
 * `GET /api/vehicles` — the vehicle metadata (label / type / route assignment).
 * The live position/status/ETA is NOT here — that is the snapshot telemetry; this
 * is the static fleet roster. Static for a run.
 */
export const vehiclesResponseSchema = z.object({
  vehicles: z.array(vehicleSchema),
});
export type VehiclesResponse = z.infer<typeof vehiclesResponseSchema>;
