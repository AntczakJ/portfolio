import type { Route, RouteStop, Vehicle, Zone } from 'atlas-shared/schemas';
import { buildRouteProjector, projectPointToS } from 'atlas-shared/geo';

import type { BaselineRoute, BaselineStop, SimBaseline } from './types.js';

/**
 * Build the frozen {@link SimBaseline} from the raw seed/DB definitions
 * (ADR-002). Done ONCE at engine start, off the hot path: build each route's
 * cumulative-segment-length projector and project each stop onto the route to
 * derive its distance-along-route `s` (so the reducer's ETA is `stopS - currentS`
 * over the cumulative table, ADR-004 — no per-tick re-projection of stops).
 *
 * Stops are matched to their route via `routeId` and ordered by `seq`. A stop's
 * `s` is found by snapping its Point to the route LineString (turf
 * `nearestPointOnLine`, metres) and reading the snapped distance, then clamping
 * into the projector domain. Pure given the inputs (no wall-clock, no IO).
 */

const TICK_MS = 1000; // ADR-002 C1: fixed 1 Hz authoritative tick.

export interface BaselineInput {
  readonly routes: readonly Route[];
  readonly stops: readonly RouteStop[];
  readonly zones: readonly Zone[];
  readonly vehicles: readonly Vehicle[];
  /** The mulberry32 seed for the per-tick jitter stream (ADR-002 B1). */
  readonly prngSeed: number;
}

export function buildBaseline(input: BaselineInput): SimBaseline {
  const stopsByRoute = new Map<string, RouteStop[]>();
  for (const stop of input.stops) {
    const list = stopsByRoute.get(stop.routeId) ?? [];
    list.push(stop);
    stopsByRoute.set(stop.routeId, list);
  }

  const routes = new Map<string, BaselineRoute>();
  for (const route of input.routes) {
    const projector = buildRouteProjector(route.geometry);
    const routeStops = (stopsByRoute.get(route.id) ?? [])
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map<BaselineStop>((stop) => ({
        stop,
        s: projectPointToS(projector, route.geometry, stop.point),
      }));
    routes.set(route.id, { route, projector, stops: routeStops });
  }

  // Fail loudly if a vehicle references a route we did not build (a seed bug).
  for (const vehicle of input.vehicles) {
    if (!routes.has(vehicle.routeId)) {
      throw new Error(
        `baseline: vehicle ${vehicle.id} references unknown route ${vehicle.routeId}`,
      );
    }
  }

  return {
    routes,
    vehicles: input.vehicles,
    zones: input.zones,
    prngSeed: input.prngSeed,
    tickMs: TICK_MS,
  };
}
