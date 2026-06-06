import type { Route, RouteStop, Vehicle, Zone } from 'atlas-shared/schemas';
import type { RouteProjector } from 'atlas-shared/geo';

/**
 * The simulation baseline (ADR-002 B1) — the FROZEN static world definition the
 * engine folds forward from. Built ONCE from the seed fixture (off the hot
 * path): the route/stop/zone/vehicle definitions plus the DERIVED per-route
 * projector (the cumulative-segment-length table, built once via
 * `buildRouteProjector`) and the per-stop distance-along-route `s`.
 *
 * The baseline never mutates. The mutable per-tick world (WorldState) is folded
 * from it; a seek to tick N re-folds from the same baseline + the same initial
 * WorldState, so the world is exactly reproducible (ADR-002 determinism).
 */

/** A stop with its distance-along-route `s` (metres) derived at build time. */
export interface BaselineStop {
  readonly stop: RouteStop;
  /** Distance along the route from start to this stop, in metres. */
  readonly s: number;
}

/** A route prepared for the engine: definition + projector + ordered stops-by-s. */
export interface BaselineRoute {
  readonly route: Route;
  readonly projector: RouteProjector;
  /** Stops ordered by `seq`, each carrying its derived `s`. */
  readonly stops: readonly BaselineStop[];
}

/**
 * The complete frozen baseline. `routes` is keyed by route id for O(1) lookup
 * in the reducer; `vehicles` and `zones` keep their authored order (stable
 * iteration -> deterministic event ordering within a tick).
 */
export interface SimBaseline {
  readonly routes: ReadonlyMap<string, BaselineRoute>;
  readonly vehicles: readonly Vehicle[];
  readonly zones: readonly Zone[];
  /** The PRNG seed (the per-tick jitter stream root). */
  readonly prngSeed: number;
  /** The fixed authoritative tick length in milliseconds (ADR-002 — 1000). */
  readonly tickMs: number;
}
