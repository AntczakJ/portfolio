import { doublePrecision, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { vehicles } from './vehicles';
import { vehicleStatusEnum } from './enums';

/**
 * telemetry_snapshots — the latest authoritative per-vehicle telemetry,
 * UPSERTED periodically (ADR-005 C1) — NOT the per-tick firehose. The engine is
 * the live source of truth; this row serves the snapshot frame on a cold
 * connect, the SSR floor (the static fleet table), and reconnect reconcile.
 *
 * PK is `vehicle_id` (one row per vehicle, upserted), so the snapshot read is a
 * single indexed scan. Mirrors the shared `VehicleTelemetry` shape; units are
 * METRES / METRES-PER-SECOND / DEGREES / SECONDS (ADR-004).
 */
export const telemetrySnapshots = pgTable('telemetry_snapshots', {
  vehicleId: text('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  headingDeg: doublePrecision('heading_deg').notNull(),
  speedMps: doublePrecision('speed_mps').notNull(),
  routeId: text('route_id').notNull(),
  distanceAlongRouteM: doublePrecision('distance_along_route_m').notNull(),
  progress: doublePrecision('progress').notNull(),
  status: vehicleStatusEnum('status').notNull(),
  nextStopId: text('next_stop_id'),
  etaSeconds: doublePrecision('eta_seconds'),
  currentZoneId: text('current_zone_id'),
  /** Engine tick index this snapshot reflects. */
  serverTick: integer('server_tick').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type TelemetrySnapshotRow = typeof telemetrySnapshots.$inferSelect;
export type NewTelemetrySnapshotRow = typeof telemetrySnapshots.$inferInsert;
