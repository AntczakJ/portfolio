import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import type { PointGeometry } from 'atlas-shared/schemas';

import { routes } from './routes';

/**
 * route_stops — ordered pickup / delivery / depot points along a route
 * (ADR-005). `seq` orders them; `dwell_seconds` is the pause at the stop
 * (status `at_stop`, ADR-002 speed/dwell model).
 *
 * INDEX (ADR-005): `(route_id, seq)` serves the per-route ordered stop read the
 * engine does at load and the detail panel does per vehicle.
 *
 * `point` is a GeoJSON Point in `jsonb`. The stop's distance-along-route `s` is
 * derived in-engine from the cumulative table (not persisted) so ETA is
 * `stopS - currentS` (ADR-004).
 */
export const routeStops = pgTable(
  'route_stops',
  {
    id: text('id').primaryKey(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    point: jsonb('point').$type<PointGeometry>().notNull(),
    dwellSeconds: integer('dwell_seconds').notNull().default(0),
  },
  (table) => [index('route_stops_route_id_seq_idx').on(table.routeId, table.seq)],
);

export type RouteStopRow = typeof routeStops.$inferSelect;
export type NewRouteStopRow = typeof routeStops.$inferInsert;
