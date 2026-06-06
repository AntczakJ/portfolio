import { doublePrecision, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import type { LineStringGeometry } from 'atlas-shared/schemas';

import { loopModeEnum } from './enums';

/**
 * routes — predefined polylines a vehicle follows (ADR-005). Hand-authored
 * GeoJSON LineStrings for the demo city, baked into a seeded fixture (Task 3.3)
 * and loaded once at engine start.
 *
 * `geometry` is a GeoJSON LineString in `jsonb` (typed via Drizzle `$type`, so
 * the rest of the codebase reads it as the shared `LineStringGeometry`). The
 * authoritative geo is computed in-engine (turf) from this geometry — no spatial
 * SQL, so plain `jsonb` is enough (PostGIS is the v2 upgrade). `length_m` is
 * precomputed (turf, metres) at seed time.
 *
 * Ids are stable hand-authored strings (e.g. `route-downtown-loop`), not random
 * UUIDs, so the seed + the WS contract reference a route by a legible id.
 */
export const routes = pgTable('routes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  geometry: jsonb('geometry').$type<LineStringGeometry>().notNull(),
  lengthM: doublePrecision('length_m').notNull(),
  loopMode: loopModeEnum('loop_mode').notNull().default('loop'),
});

export type RouteRow = typeof routes.$inferSelect;
export type NewRouteRow = typeof routes.$inferInsert;
