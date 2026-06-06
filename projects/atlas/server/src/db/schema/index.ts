/**
 * Drizzle schema barrel (ADR-005). Re-exports every table + enum so the Drizzle
 * client (`drizzle(client, { schema })`) and drizzle-kit see the whole model
 * from one import.
 *
 * Model (ADR-005): routes (geometry jsonb LineString, length_m, loop_mode) ->
 * route_stops (point jsonb, seq, dwell_seconds) + zones (geometry jsonb
 * Polygon, kind); vehicles (route assignment, base speed); telemetry_snapshots
 * (upserted latest per-vehicle); events (the bounded feed + history).
 */
export * from './enums';
export * from './routes';
export * from './route-stops';
export * from './zones';
export * from './vehicles';
export * from './telemetry-snapshots';
export * from './events';
