import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import type { PolygonGeometry } from 'atlas-shared/schemas';

import { zoneKindEnum } from './enums';

/**
 * zones — geofence polygons the engine tests each vehicle against (ADR-004 /
 * ADR-005). Depots + delivery zones + restricted areas, hand-drawn for the demo
 * city. `geometry` is a GeoJSON Polygon in `jsonb`; the engine runs the
 * hysteresis point-in-polygon (turf) against it every tick — no spatial SQL.
 */
export const zones = pgTable('zones', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: zoneKindEnum('kind').notNull(),
  geometry: jsonb('geometry').$type<PolygonGeometry>().notNull(),
});

export type ZoneRow = typeof zones.$inferSelect;
export type NewZoneRow = typeof zones.$inferInsert;
