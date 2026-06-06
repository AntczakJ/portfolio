import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  fleetSnapshotResponseSchema,
  routesResponseSchema,
  vehiclesResponseSchema,
  zonesResponseSchema,
} from 'atlas-shared/schemas';

import type { EngineService } from '../engine/engine-service.js';

/**
 * Public read REST endpoints (PLAN.md Task 6.3 backend portion, ADR-005).
 *
 * These serve the read surface the SSR floor / external consumers / the no-WebGL
 * initial paint consume. They serve DB-LESS from the in-memory {@link EngineService}
 * (the engine is the live source of truth, ADR-005), so they are available
 * without a reachable Postgres — exactly like the WS channel. The same shared Zod
 * response schemas (`atlas-shared/schemas`) drive the serializer here AND the
 * web's response types (types-only), so there is one source of truth for the read
 * contract (conventions section 5).
 *
 * Posture:
 *   - Rate limiting: every route carries its own per-route `@fastify/rate-limit`
 *     budget (the plugin is registered globally in `app.ts`; the per-route
 *     `config.rateLimit` overrides the global floor). The live snapshot is given
 *     a more generous budget (a no-WebGL client may poll it); the static
 *     definitions a tighter one (they do not change for a run).
 *   - Cache-control: the definitions (routes / zones / vehicles) are STATIC for a
 *     run, so a short `max-age` is set. The snapshot is LIVE, so it is `no-store`
 *     — a cached snapshot served as current would be stale-as-live, the exact
 *     thing the credibility line forbids.
 *
 * CORS: the global `@fastify/cors` (registered in `app.ts`) already allows the
 * configured web origin (`CORS_ORIGINS`), so these GETs are reachable from the
 * Next server (SSR fetch) and the browser.
 */

export interface PublicReadRouteDeps {
  readonly engineService: EngineService;
}

/** Live snapshot: a no-WebGL client may poll, so a more generous per-IP budget. */
const SNAPSHOT_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const;
/** Static definitions: changed once per run, a tighter budget is plenty. */
const DEFINITIONS_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

/** Static definitions are stable for a run — a short shared cache is fine. */
const DEFINITIONS_CACHE_CONTROL = 'public, max-age=60';
/** The snapshot is live — never serve a cached one as current. */
const SNAPSHOT_CACHE_CONTROL = 'no-store';

export function registerPublicReadRoutes(app: FastifyInstance, deps: PublicReadRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { engineService } = deps;

  /**
   * `GET /api/fleet/snapshot` — the current authoritative per-vehicle telemetry
   * snapshot + the static vehicle metadata to render it. The SSR floor table and
   * the no-WebGL initial paint read this.
   */
  typed.get(
    '/api/fleet/snapshot',
    {
      config: { rateLimit: SNAPSHOT_RATE_LIMIT },
      schema: { response: { 200: fleetSnapshotResponseSchema } },
    },
    (_request, reply) => {
      const snapshot = engineService.snapshot();
      void reply.header('cache-control', SNAPSHOT_CACHE_CONTROL);
      return {
        serverTick: snapshot.serverTick,
        ts: snapshot.ts,
        vehicles: [...engineService.definitions.vehicles],
        telemetry: [...snapshot.telemetry],
      };
    },
  );

  /**
   * `GET /api/routes` — the route definitions (GeoJSON LineStrings) + the ordered
   * stops per route. Static for a run.
   */
  typed.get(
    '/api/routes',
    {
      config: { rateLimit: DEFINITIONS_RATE_LIMIT },
      schema: { response: { 200: routesResponseSchema } },
    },
    (_request, reply) => {
      void reply.header('cache-control', DEFINITIONS_CACHE_CONTROL);
      return {
        routes: [...engineService.definitions.routes],
        stops: [...engineService.definitions.stops],
      };
    },
  );

  /**
   * `GET /api/zones` — the zone / geofence polygons. Static for a run.
   */
  typed.get(
    '/api/zones',
    {
      config: { rateLimit: DEFINITIONS_RATE_LIMIT },
      schema: { response: { 200: zonesResponseSchema } },
    },
    (_request, reply) => {
      void reply.header('cache-control', DEFINITIONS_CACHE_CONTROL);
      return { zones: [...engineService.definitions.zones] };
    },
  );

  /**
   * `GET /api/vehicles` — the static fleet roster (label / type / route). The
   * live position/status/ETA is the snapshot telemetry, not here.
   */
  typed.get(
    '/api/vehicles',
    {
      config: { rateLimit: DEFINITIONS_RATE_LIMIT },
      schema: { response: { 200: vehiclesResponseSchema } },
    },
    (_request, reply) => {
      void reply.header('cache-control', DEFINITIONS_CACHE_CONTROL);
      return { vehicles: [...engineService.definitions.vehicles] };
    },
  );
}
