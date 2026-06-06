import { z } from 'zod';

/**
 * GeoJSON Zod primitives (ADR-005).
 *
 * Routes (LineString), stops (Point), and zones (Polygon) are persisted as
 * GeoJSON in `jsonb` and travel over the wire inside snapshot frames. These
 * schemas validate the SHAPE at the trust boundary (DB read, WS frame parse) so
 * a malformed geometry never reaches the turf geo functions, which assume
 * well-formed input.
 *
 * Scope: only the geometry types Atlas actually uses. We intentionally do NOT
 * model the full GeoJSON spec (Feature, FeatureCollection, MultiPolygon, etc.)
 * — the domain stores bare geometries, and a narrower schema is a stricter
 * gate. Longitude/latitude bounds are enforced so a transposed lat/lng pair
 * (a classic GIS bug) is rejected at the boundary rather than silently
 * projecting a vehicle into the ocean.
 */

/** A single `[longitude, latitude]` position. GeoJSON order is lng-then-lat. */
export const positionSchema = z.tuple([
  z.number().min(-180).max(180), // longitude
  z.number().min(-90).max(90), // latitude
]);
export type Position = z.infer<typeof positionSchema>;

/** GeoJSON Point geometry — a stop or a vehicle position. */
export const pointGeometrySchema = z.object({
  type: z.literal('Point'),
  coordinates: positionSchema,
});
export type PointGeometry = z.infer<typeof pointGeometrySchema>;

/**
 * GeoJSON LineString geometry — a route polyline. At least two positions, so
 * the cumulative-segment-length table (ADR-002) has at least one segment.
 */
export const lineStringGeometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(positionSchema).min(2),
});
export type LineStringGeometry = z.infer<typeof lineStringGeometrySchema>;

/**
 * GeoJSON Polygon geometry — a zone / geofence. A polygon is an array of linear
 * rings; ring[0] is the exterior, ring[1..] are holes. Each ring is a closed
 * loop of at least four positions (first == last). We validate the structural
 * minimum (>= 1 ring, >= 4 positions per ring) here; turf's
 * boolean-point-in-polygon handles the geometry from there.
 */
export const polygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(positionSchema).min(4)).min(1),
});
export type PolygonGeometry = z.infer<typeof polygonGeometrySchema>;
