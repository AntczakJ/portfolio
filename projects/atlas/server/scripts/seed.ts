/**
 * Atlas DB seed (Task 3.3, ADR-005) — IDEMPOTENT, DETERMINISTIC.
 *
 * Persists the demo-city DEFINITIONS (the hand-authored Porto routes + stops +
 * zones + the seeded fleet) so the snapshot frame, the events feed, the SSR
 * floor, and reconnect reconcile have a floor to read. The engine is the LIVE
 * source of truth (ADR-005) — this seed lays the static definitions + an initial
 * telemetry snapshot; live ticks run forward from the SAME frozen baseline
 * (porto-fixture.ts), so the persisted world and the in-memory world align.
 *
 * Determinism: the fleet comes from a single `faker.seed(SIM_SEED)` pass
 * (porto-fixture.ts) and the geometry is statically baked (porto-geometry.ts) —
 * no `Date.now()` / `Math.random()` in the generation, so a re-run converges to
 * the same rows. Idempotent: every upsert is `onConflictDoUpdate` / replace, so
 * re-running is safe (it does NOT wipe the live forward telemetry beyond
 * re-seeding the definitions + a tick-0 snapshot).
 *
 * Run (Postgres up on 5438, server/.env present):
 *   docker compose -f projects/atlas/docker-compose.yml up -d
 *   pnpm -F atlas-server db:migrate
 *   pnpm -F atlas-server seed
 *
 * The script reads DATABASE_URL the same way drizzle-kit + the runtime do.
 */
import { sql } from 'drizzle-orm';

import { createDbHandle } from '../src/db/drizzle.js';
import {
  events,
  routeStops,
  routes,
  telemetrySnapshots,
  vehicles,
  zones,
} from '../src/db/schema/index.js';
import { buildBaseline } from '../src/engine/baseline/build-baseline.js';
import { createInitialWorldState } from '../src/engine/reducer/world-state.js';
import { telemetryFor } from '../src/engine/reducer/tick.js';
import { buildPortoFixture, fixtureToBaselineInput } from '../src/seed/porto-fixture.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://atlas:atlas@localhost:5438/atlas';
  const { sql, db } = createDbHandle(databaseUrl, 4);

  const fixture = buildPortoFixture();
  const baseline = buildBaseline(fixtureToBaselineInput(fixture));
  const initialWorld = createInitialWorldState(baseline);

  process.stdout.write(
    `Seeding Porto demo city: ${String(fixture.routes.length)} routes, ` +
      `${String(fixture.stops.length)} stops, ${String(fixture.zones.length)} zones, ` +
      `${String(fixture.vehicles.length)} vehicles.\n`,
  );

  try {
    // Insert order respects FKs: routes -> route_stops + zones -> vehicles.
    await db
      .insert(routes)
      .values(
        fixture.routes.map((r) => ({
          id: r.id,
          name: r.name,
          geometry: r.geometry,
          lengthM: r.lengthM,
          loopMode: r.loopMode,
        })),
      )
      .onConflictDoUpdate({
        target: routes.id,
        set: {
          name: sql`excluded.name`,
          geometry: sql`excluded.geometry`,
          lengthM: sql`excluded.length_m`,
          loopMode: sql`excluded.loop_mode`,
        },
      });

    await db
      .insert(zones)
      .values(
        fixture.zones.map((z) => ({
          id: z.id,
          name: z.name,
          kind: z.kind,
          geometry: z.geometry,
        })),
      )
      .onConflictDoUpdate({
        target: zones.id,
        set: {
          name: sql`excluded.name`,
          kind: sql`excluded.kind`,
          geometry: sql`excluded.geometry`,
        },
      });

    await db
      .insert(routeStops)
      .values(
        fixture.stops.map((s) => ({
          id: s.id,
          routeId: s.routeId,
          seq: s.seq,
          name: s.name,
          point: s.point,
          dwellSeconds: s.dwellSeconds,
        })),
      )
      .onConflictDoUpdate({
        target: routeStops.id,
        set: {
          routeId: sql`excluded.route_id`,
          seq: sql`excluded.seq`,
          name: sql`excluded.name`,
          point: sql`excluded.point`,
          dwellSeconds: sql`excluded.dwell_seconds`,
        },
      });

    await db
      .insert(vehicles)
      .values(
        fixture.vehicles.map((v) => ({
          id: v.id,
          label: v.label,
          type: v.type,
          routeId: v.routeId,
          baseSpeedMps: v.baseSpeedMps,
          status: v.status,
        })),
      )
      .onConflictDoUpdate({
        target: vehicles.id,
        set: {
          label: vehicles.label,
          type: vehicles.type,
          routeId: vehicles.routeId,
          baseSpeedMps: vehicles.baseSpeedMps,
          status: vehicles.status,
        },
      });

    // An initial tick-0 telemetry snapshot so the SSR floor / cold-connect read
    // has a populated fleet even before the live engine has ticked once.
    const now = new Date();
    const snapshotRows = fixture.vehicles.map((v) => {
      const vehicleState = initialWorld.vehicles.get(v.id);
      if (vehicleState === undefined) {
        throw new Error(`seed: missing initial state for vehicle ${v.id}`);
      }
      const t = telemetryFor(baseline, vehicleState);
      return {
        vehicleId: t.vehicleId,
        lat: t.lat,
        lng: t.lng,
        headingDeg: t.headingDeg,
        speedMps: t.speedMps,
        routeId: t.routeId,
        distanceAlongRouteM: t.distanceAlongRouteM,
        progress: t.progress,
        status: t.status,
        nextStopId: t.nextStopId,
        etaSeconds: t.etaSeconds,
        currentZoneId: t.currentZoneId,
        serverTick: 0,
        updatedAt: now,
      };
    });
    await db
      .insert(telemetrySnapshots)
      .values(snapshotRows)
      .onConflictDoUpdate({
        target: telemetrySnapshots.vehicleId,
        set: {
          lat: telemetrySnapshots.lat,
          lng: telemetrySnapshots.lng,
          headingDeg: telemetrySnapshots.headingDeg,
          speedMps: telemetrySnapshots.speedMps,
          routeId: telemetrySnapshots.routeId,
          distanceAlongRouteM: telemetrySnapshots.distanceAlongRouteM,
          progress: telemetrySnapshots.progress,
          status: telemetrySnapshots.status,
          nextStopId: telemetrySnapshots.nextStopId,
          etaSeconds: telemetrySnapshots.etaSeconds,
          currentZoneId: telemetrySnapshots.currentZoneId,
          serverTick: telemetrySnapshots.serverTick,
          updatedAt: telemetrySnapshots.updatedAt,
        },
      });

    // Clear stale seeded events (the feed is a live forward window; a fresh seed
    // starts it empty rather than carrying a previous run's events).
    await db.delete(events);

    process.stdout.write('Seed complete (idempotent — re-runnable).\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`atlas seed failed: ${String(err)}\n`);
  process.exit(1);
});
