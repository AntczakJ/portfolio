import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  fleetSnapshotResponseSchema,
  routesResponseSchema,
  vehiclesResponseSchema,
  zonesResponseSchema,
} from 'atlas-shared/schemas';

import { buildApp, type BuiltApp } from '../app.js';
import type { Env } from '../config/env.schema.js';

/**
 * Public read REST endpoints (Task 6.3, ADR-005) integration cover via
 * `app.inject()` — a real built Fastify app (the Zod serializer, the rate-limit
 * plugin, the engine composition root), NOT mocks. The endpoints serve DB-LESS
 * from the in-memory engine, so the test needs no Postgres: a postgres-js handle
 * is created but never queried (the snapshot/definitions come from the engine).
 *
 * Asserts:
 *   - each endpoint returns 200 with a body that re-parses against the SHARED
 *     response schema (the serializer contract holds, and the web's types match);
 *   - the snapshot carries live telemetry with positions; routes carry geometry;
 *     zones carry polygons;
 *   - rate-limit headers are present and the per-route budgets are wired (the
 *     static-definitions budget is tighter than the snapshot budget);
 *   - the cache-control posture: static defs cacheable, the live snapshot
 *     no-store.
 */

const TEST_ENV: Env = {
  PORT: 0,
  NODE_ENV: 'test',
  // Never connected to in these tests — the engine is the DB-less source.
  DATABASE_URL: 'postgres://atlas:atlas@127.0.0.1:5438/atlas',
  CORS_ORIGINS: ['http://localhost:3093'],
};

describe('public read REST endpoints', () => {
  let built: BuiltApp;

  beforeAll(async () => {
    built = await buildApp(TEST_ENV);
    await built.app.ready();
  });

  afterAll(async () => {
    await built.app.close();
    // No query ran (the endpoints are DB-less), but close the lazy pool cleanly.
    await built.dbHandle.sql.end({ timeout: 1 });
  });

  it('GET /api/fleet/snapshot returns live telemetry with positions (no-store)', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/fleet/snapshot' });
    expect(res.statusCode).toBe(200);

    const body: unknown = res.json();
    const parsed = fleetSnapshotResponseSchema.parse(body);
    expect(parsed.vehicles.length).toBeGreaterThan(0);
    expect(parsed.telemetry.length).toBe(parsed.vehicles.length);

    const first = parsed.telemetry[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(Number.isFinite(first.lat)).toBe(true);
      expect(Number.isFinite(first.lng)).toBe(true);
    }

    expect(res.headers['cache-control']).toBe('no-store');
    // The global rate-limit plugin stamps the budget headers on every reply.
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('GET /api/routes returns route geometry + stops (cacheable)', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/routes' });
    expect(res.statusCode).toBe(200);

    const parsed = routesResponseSchema.parse(res.json());
    expect(parsed.routes.length).toBeGreaterThan(0);

    const route = parsed.routes[0];
    expect(route).toBeDefined();
    if (route !== undefined) {
      expect(route.geometry.type).toBe('LineString');
      expect(route.geometry.coordinates.length).toBeGreaterThan(1);
    }
    expect(parsed.stops.length).toBeGreaterThan(0);

    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('GET /api/zones returns geofence polygons (cacheable)', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/zones' });
    expect(res.statusCode).toBe(200);

    const parsed = zonesResponseSchema.parse(res.json());
    expect(parsed.zones.length).toBeGreaterThan(0);

    const zone = parsed.zones[0];
    expect(zone).toBeDefined();
    if (zone !== undefined) {
      expect(zone.geometry.type).toBe('Polygon');
      expect(zone.geometry.coordinates[0]?.length).toBeGreaterThan(2);
    }
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('GET /api/vehicles returns the static fleet roster (cacheable)', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/vehicles' });
    expect(res.statusCode).toBe(200);

    const parsed = vehiclesResponseSchema.parse(res.json());
    expect(parsed.vehicles.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('applies a per-route rate limit (tighter on the static definitions)', async () => {
    const snapshotRes = await built.app.inject({ method: 'GET', url: '/api/fleet/snapshot' });
    const zonesRes = await built.app.inject({ method: 'GET', url: '/api/zones' });

    const snapshotLimit = Number(snapshotRes.headers['x-ratelimit-limit']);
    const zonesLimit = Number(zonesRes.headers['x-ratelimit-limit']);

    expect(snapshotLimit).toBe(60);
    expect(zonesLimit).toBe(30);
    // The static definitions get a tighter budget than the pollable snapshot.
    expect(zonesLimit).toBeLessThan(snapshotLimit);
  });
});
