import { z } from 'zod';

import { pointGeometrySchema } from './geojson';

/**
 * Route stop — an ordered pickup / delivery / depot point along a route
 * (ADR-005). `seq` orders the stops within a route; `dwellSeconds` is how long
 * a vehicle pauses (status `at_stop`, `s` frozen) before pulling away (ADR-002
 * speed/dwell model).
 *
 * `point` is the stop geometry. The engine ALSO carries the stop's
 * distance-along-route `s` (computed from the cumulative table at load) so ETA
 * is `stopS - currentS` over the rolling-average speed (ADR-004) — that derived
 * `s` is engine state, not persisted here.
 */
export const routeStopSchema = z.object({
  id: z.string().min(1),
  routeId: z.string().min(1),
  /** 0-based order of this stop along the route. */
  seq: z.number().int().nonnegative(),
  name: z.string().min(1),
  point: pointGeometrySchema,
  /** Seconds the vehicle dwells at this stop before resuming. */
  dwellSeconds: z.number().int().nonnegative(),
});
export type RouteStop = z.infer<typeof routeStopSchema>;
