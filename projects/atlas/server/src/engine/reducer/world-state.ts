import type { VehicleStatus } from 'atlas-shared/schemas';
import { initialGeofenceTracker, type GeofenceTracker } from 'atlas-shared/geo';

import type { SimBaseline } from '../baseline/types.js';
import { createPrng, type PrngState } from './prng.js';

/**
 * WorldState (ADR-002) — the MUTABLE per-tick simulation state the pure reducer
 * folds forward. Everything that changes tick-to-tick lives here; the static
 * definitions live in the {@link SimBaseline}. A seek to tick N is a fold of the
 * reducer from {@link createInitialWorldState} over N ticks — so this shape MUST
 * carry every piece of state the reducer reads (the PRNG, the geofence
 * hysteresis trackers, the rolling speed buffers, the dwell timers, the
 * ping-pong direction) for the fold to be exact.
 *
 * The reducer NEVER mutates a WorldState in place — it returns a NEW one (the
 * pure-reducer contract). The shell stores the returned state back.
 */

/** Direction of travel along the route (for ping_pong route-end). */
export type Direction = 1 | -1;

/** The mutable per-vehicle kinematic + status state. */
export interface VehicleState {
  readonly vehicleId: string;
  readonly routeId: string;
  /** Distance along the route from its start, in metres. */
  readonly s: number;
  /** Direction of travel: +1 forward, -1 reversed (ping_pong only). */
  readonly direction: Direction;
  /** Current ground speed in metres/second (>= 0; 0 while dwelling). */
  readonly speedMps: number;
  readonly status: VehicleStatus;
  /** Seconds still to dwell at the current stop; 0 unless `status === at_stop`. */
  readonly dwellRemainingS: number;
  /**
   * The `seq` of the stop currently being dwelled at, so the reducer does not
   * re-trigger a dwell for the same stop on consecutive ticks. -1 when not at /
   * just-left a stop.
   */
  readonly dwellingStopSeq: number;
  /** Rolling buffer of recent per-tick speeds (m/s) for the rolling-avg ETA. */
  readonly speedBuffer: readonly number[];
  /**
   * Per-zone hysteresis trackers, keyed by zone id (ADR-004). One per zone the
   * vehicle is tested against. Carried in WorldState so a fold reconstructs the
   * confirmed inside/outside state exactly.
   */
  readonly geofenceTrackers: ReadonlyMap<string, GeofenceTracker>;
  /** The zone id the vehicle is currently CONFIRMED inside, or null. */
  readonly currentZoneId: string | null;
}

/** The full mutable world. */
export interface WorldState {
  /** The authoritative tick index (0 at the baseline, +1 per reducer call). */
  readonly tick: number;
  /** The seeded jitter PRNG (ADR-002 B1). */
  readonly prng: PrngState;
  /** Per-vehicle state, keyed by vehicle id (stable iteration via the baseline). */
  readonly vehicles: ReadonlyMap<string, VehicleState>;
}

/**
 * Build the initial WorldState (tick 0) from a baseline. Every vehicle starts
 * at the start of its route (`s = 0`), forward, en route, with empty trackers
 * and an empty speed buffer. Deterministic: no wall-clock, no randomness here
 * (the PRNG is only consumed inside the reducer).
 *
 * Vehicles are spread along their route by a deterministic offset so the fleet
 * does not stack at the depot on first paint (the "already moving / already
 * distributed" requirement). The offset is derived purely from the vehicle's
 * index within its route and the route length — no PRNG draw, so it is stable.
 */
export function createInitialWorldState(baseline: SimBaseline): WorldState {
  const vehicles = new Map<string, VehicleState>();

  // Group vehicles by route so we can spread them along the polyline.
  const byRoute = new Map<string, string[]>();
  for (const vehicle of baseline.vehicles) {
    const list = byRoute.get(vehicle.routeId) ?? [];
    list.push(vehicle.id);
    byRoute.set(vehicle.routeId, list);
  }

  for (const vehicle of baseline.vehicles) {
    const baselineRoute = baseline.routes.get(vehicle.routeId);
    if (baselineRoute === undefined) {
      throw new Error(
        `vehicle ${vehicle.id} references unknown route ${vehicle.routeId} (baseline mismatch)`,
      );
    }
    const peers = byRoute.get(vehicle.routeId) ?? [vehicle.id];
    const indexOnRoute = peers.indexOf(vehicle.id);
    const count = peers.length;
    // Spread fraction in (0, 1) — avoid both endpoints so no vehicle starts
    // exactly at a route end (which would immediately trigger route-end logic).
    const fraction = (indexOnRoute + 1) / (count + 1);
    const startS = baselineRoute.projector.totalLengthM * fraction;

    const geofenceTrackers = new Map<string, GeofenceTracker>();
    for (const zone of baseline.zones) {
      geofenceTrackers.set(zone.id, initialGeofenceTracker());
    }

    vehicles.set(vehicle.id, {
      vehicleId: vehicle.id,
      routeId: vehicle.routeId,
      s: startS,
      direction: 1,
      speedMps: vehicle.baseSpeedMps,
      status: 'en_route',
      dwellRemainingS: 0,
      dwellingStopSeq: -1,
      speedBuffer: [],
      geofenceTrackers,
      currentZoneId: null,
    });
  }

  return {
    tick: 0,
    prng: createPrng(baseline.prngSeed),
    vehicles,
  };
}
