/**
 * Geo module types (ADR-004). Pure data shapes shared FE + BE.
 *
 * UNITS ARE PINNED TO METRES throughout (the ADR-004 sharp edge: turf defaults
 * to kilometres; every turf call in this module passes `{ units: 'meters' }`
 * explicitly, and every length/distance these types carry is in metres). Do not
 * mix a turf default-km value into these shapes.
 */

/** A projected position along a route: where a scalar `s` (metres) lands. */
export interface ProjectedPoint {
  /** WGS84 latitude. */
  lat: number;
  /** WGS84 longitude. */
  lng: number;
  /** Heading in degrees clockwise from north, [0, 360) — the segment bearing. */
  headingDeg: number;
}

/**
 * A route prepared for fast per-tick projection (ADR-002 D1). Built ONCE at
 * load from the route geometry; the cumulative-length table makes `s` ->
 * lat/lng/heading an O(log segments) binary search instead of re-walking the
 * LineString every tick.
 */
export interface RouteProjector {
  /** The route's coordinate ring, `[lng, lat]` positions. */
  readonly coordinates: readonly (readonly [number, number])[];
  /**
   * Cumulative distance in METRES from the route start to each vertex.
   * `cumulative[0] === 0`; `cumulative[n-1] === totalLengthM`. Length === the
   * number of coordinates.
   */
  readonly cumulative: readonly number[];
  /** Total route length in metres (=== last cumulative value). */
  readonly totalLengthM: number;
}

/** The confirmed inside/outside state of one (vehicle, zone) pair (ADR-004). */
export type GeofenceState = 'inside' | 'outside';

/**
 * Per-(vehicle, zone) hysteresis accumulator (ADR-004 B1). The CONFIRMED
 * `state` drives events, not the raw point-in-polygon: a transition only fires
 * after `>= CONFIRM` consecutive opposing ticks (or a margin crossing), so a
 * boundary-skimming vehicle never accumulates enough to flip and does not flap.
 *
 * This lives in WorldState so a deterministic seek (fold the reducer to tick N)
 * reconstructs it exactly.
 */
export interface GeofenceTracker {
  /** The current confirmed state. */
  state: GeofenceState;
  /**
   * Consecutive ticks the raw test has disagreed with `state`. Reset to 0 on
   * agreement; a transition fires (and this resets) once it reaches CONFIRM.
   */
  pendingTicks: number;
}
