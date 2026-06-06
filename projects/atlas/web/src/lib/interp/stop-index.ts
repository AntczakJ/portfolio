/**
 * Per-route stop `s` index (Task 4.3, remaining-route geometry).
 *
 * The remaining-route line is drawn `current_s .. next_stop_s` along the route.
 * The telemetry carries `nextStopId`, but not the stop's distance-along-route;
 * this module precomputes each stop's `s` (metres) from the snapshot via the
 * shared `projectPointToS` (the SAME projection the engine uses, so FE/BE agree)
 * and exposes a lookup by `(routeId, stopId)`. Built once per snapshot, off the
 * render path.
 */

import { buildRouteProjector, projectPointToS } from 'atlas-shared/geo';
import type { Route, RouteStop } from 'atlas-shared/schemas';

/** Maps `stopId -> distance-along-route s (metres)`. */
export type StopSIndex = Map<string, number>;

/**
 * Build the stop->s index for a snapshot's routes + stops. A stop's `s` is its
 * nearest-point projection onto its route's geometry (clamped to the route).
 */
export function buildStopSIndex(routes: readonly Route[], stops: readonly RouteStop[]): StopSIndex {
  const index: StopSIndex = new Map();
  const projectors = new Map(routes.map((r) => [r.id, buildRouteProjector(r.geometry)]));
  const geometries = new Map(routes.map((r) => [r.id, r.geometry]));

  for (const stop of stops) {
    const projector = projectors.get(stop.routeId);
    const geometry = geometries.get(stop.routeId);
    if (!projector || !geometry) continue;
    index.set(stop.id, projectPointToS(projector, geometry, stop.point));
  }
  return index;
}
