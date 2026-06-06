import { doublePrecision, index, pgTable, text } from 'drizzle-orm/pg-core';

import { routes } from './routes';
import { vehicleStatusEnum, vehicleTypeEnum } from './enums';

/**
 * vehicles — the STATIC fleet definition (ADR-005). Identity, label, kind,
 * route assignment, base cruise speed. The LIVE per-tick state (position,
 * heading, `s`, status, current zone, ETA) is NOT here — that is authoritative
 * engine state, persisted only as a periodic snapshot (telemetry_snapshots).
 *
 * `status` is the last-known status (a snapshot convenience for the SSR floor);
 * the live value travels in the WS telemetry tick. `current_zone_id` is
 * deliberately NOT a column here — the confirmed zone is engine/telemetry state,
 * not a static definition.
 *
 * INDEX: `(route_id)` for the per-route fleet read.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    type: vehicleTypeEnum('type').notNull(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'restrict' }),
    baseSpeedMps: doublePrecision('base_speed_mps').notNull(),
    status: vehicleStatusEnum('status').notNull().default('en_route'),
  },
  (table) => [index('vehicles_route_id_idx').on(table.routeId)],
);

export type VehicleRow = typeof vehicles.$inferSelect;
export type NewVehicleRow = typeof vehicles.$inferInsert;
