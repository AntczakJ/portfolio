import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon as turfPolygon } from '@turf/helpers';

import type { PolygonGeometry } from '../schemas/geojson';
import type { GeofenceState, GeofenceTracker } from './types';

/**
 * Geofence transition detection with hysteresis (ADR-004 B1).
 *
 * The CONFIRMED state (`GeofenceTracker.state`), not the raw per-tick
 * point-in-polygon, drives the `geofence.enter` / `geofence.exit` event. A
 * transition only fires after `>= CONFIRM_TICKS` consecutive ticks where the
 * raw test disagrees with the confirmed state. A vehicle skimming the boundary
 * oscillates the RAW test but never accumulates enough consecutive
 * disagreements to flip the CONFIRMED state, so no duplicate / flapping events
 * fire — the unit-tested no-flap invariant (a boundary-skim fixture produces
 * zero spurious events).
 *
 * Pure and deterministic: the tracker lives in WorldState, so folding the
 * reducer to tick N reconstructs every (vehicle, zone) tracker exactly. No
 * wall-clock, no IO.
 */

/**
 * Consecutive opposing ticks required to confirm a transition. At the 1 Hz
 * cadence (ADR-002) this is ~CONFIRM_TICKS seconds of latency after the raw
 * crossing — within the "~1 tick of the crossing" success-criterion tolerance,
 * and the right trade for zero flapping.
 */
export const CONFIRM_TICKS = 2;

/** Raw point-in-polygon test. Coordinates are `[lng, lat]` (GeoJSON order). */
export function isPointInZone(lng: number, lat: number, zone: PolygonGeometry): boolean {
  return booleanPointInPolygon(point([lng, lat]), turfPolygon(zone.coordinates));
}

/** A fresh tracker for a vehicle that starts OUTSIDE every zone. */
export function initialGeofenceTracker(): GeofenceTracker {
  return { state: 'outside', pendingTicks: 0 };
}

/** The outcome of advancing one (vehicle, zone) tracker by a tick. */
export interface GeofenceStepResult {
  /** The next tracker state (pure — the caller stores it back in WorldState). */
  tracker: GeofenceTracker;
  /**
   * The confirmed transition this tick, if any: `'enter'` when the confirmed
   * state flipped outside -> inside, `'exit'` for inside -> outside, else null.
   */
  transition: 'enter' | 'exit' | null;
}

/**
 * Advance one (vehicle, zone) hysteresis tracker by a single tick given the raw
 * point-in-polygon result for this tick.
 *
 * - If the raw test AGREES with the confirmed state, the pending counter resets
 *   to 0 (any in-progress flip is abandoned — this is what defeats skimming).
 * - If the raw test DISAGREES, the pending counter increments; once it reaches
 *   {@link CONFIRM_TICKS} the confirmed state flips and exactly one transition
 *   is reported (counter resets).
 */
export function stepGeofence(tracker: GeofenceTracker, rawInside: boolean): GeofenceStepResult {
  const rawState: GeofenceState = rawInside ? 'inside' : 'outside';

  if (rawState === tracker.state) {
    // Agreement — abandon any pending flip. No event.
    if (tracker.pendingTicks === 0) {
      return { tracker, transition: null };
    }
    return { tracker: { state: tracker.state, pendingTicks: 0 }, transition: null };
  }

  // Disagreement — accumulate toward a confirmed flip.
  const pending = tracker.pendingTicks + 1;
  if (pending >= CONFIRM_TICKS) {
    const transition = rawState === 'inside' ? 'enter' : 'exit';
    return { tracker: { state: rawState, pendingTicks: 0 }, transition };
  }
  return { tracker: { state: tracker.state, pendingTicks: pending }, transition: null };
}
