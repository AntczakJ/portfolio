import { z } from 'zod';

import { lineStringGeometrySchema } from './geojson';
import { loopModeSchema } from './enums';

/**
 * Route — a predefined polyline a vehicle follows (ADR-005). Routes are
 * HAND-AUTHORED GeoJSON LineStrings for the demo city (not OSM-sampled), baked
 * into a seeded static fixture (Task 3.3).
 *
 * `lengthM` is precomputed (turf `length`, metres) at seed time and stored, so
 * the snapshot read does not recompute it; the engine builds its own
 * cumulative-segment-length table from `geometry` at load (ADR-002).
 */
export const routeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: lineStringGeometrySchema,
  /** Total route length in METRES (turf default is km — pinned to metres). */
  lengthM: z.number().positive(),
  loopMode: loopModeSchema,
});
export type Route = z.infer<typeof routeSchema>;
