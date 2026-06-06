import type { LoopMode, VehicleStatus, VehicleTelemetry } from 'atlas-shared/schemas';
import {
  estimateEtaSeconds,
  isPointInZone,
  projectAlongRoute,
  pushSpeedSample,
  remainingDistanceToStop,
  stepGeofence,
  type GeofenceTracker,
} from 'atlas-shared/geo';

import type { BaselineRoute, SimBaseline } from '../baseline/types.js';
import type { ReducerEvent } from './events.js';
import { applyBrakingTaper, ARRIVAL_DISTANCE_M, cruiseSpeed } from './speed-model.js';
import { advanceS, findNextStop } from './route-progress.js';
import type { PrngState } from './prng.js';
import type { VehicleState, WorldState } from './world-state.js';

/**
 * The pure tick reducer (ADR-002 A1) — the api-heavy spine.
 *
 *   tick(baseline, state, dtSeconds) -> { state, events }
 *
 * NO wall-clock, NO IO, NO `Date.now()`, NO `Math.random()` inside. Time (`dt`)
 * and all randomness (the PRNG carried in `state`) are supplied. This is what
 * makes the engine deterministic (same baseline + same initial state + N ticks
 * -> the same world), exhaustively unit-testable, and seekable (a seek to tick N
 * is a fold of this function N times from the initial state).
 *
 * Each tick, per vehicle, it:
 *   1. computes the cruise speed (base + bounded seeded jitter), then the
 *      braking taper toward the next stop (the speed/dwell model, ADR-002 E1);
 *   2. either DWELLS (status `at_stop`, `s` frozen, dwell timer counts down) or
 *      ADVANCES `s` by `speed * dt`, projecting `s` -> lat/lng/heading via the
 *      shared cumulative-table projector (ADR-002 D1) and wrapping/reversing at
 *      route end per `loop_mode` (ADR-002 F1);
 *   3. runs the per-(vehicle, zone) geofence hysteresis state machine (ADR-004)
 *      and emits exactly one `enter`/`exit` per CONFIRMED crossing;
 *   4. computes the live ETA to the next stop (remaining distance / rolling-avg
 *      speed, ADR-004), and emits status-change / arrived / departed events.
 *
 * It returns a NEW WorldState (never mutates the input) and the events that
 * fired this tick (without wall-clock `at` — the shell stamps that, see
 * `events.ts`). The authoritative per-vehicle telemetry is exposed via
 * {@link telemetryFor} so the shell/gateway can build the WS frames without
 * re-deriving the projection.
 */

export interface TickResult {
  readonly state: WorldState;
  readonly events: readonly ReducerEvent[];
}

/** Advance the whole world by one fixed tick of `dtSeconds`. */
export function tick(baseline: SimBaseline, state: WorldState, dtSeconds: number): TickResult {
  const nextTick = state.tick + 1;
  let prng = state.prng;
  const nextVehicles = new Map<string, VehicleState>();
  const events: ReducerEvent[] = [];

  for (const vehicle of baseline.vehicles) {
    const prev = state.vehicles.get(vehicle.id);
    if (prev === undefined) {
      throw new Error(`world state is missing vehicle ${vehicle.id} (baseline/state mismatch)`);
    }
    const baselineRoute = baseline.routes.get(vehicle.routeId);
    if (baselineRoute === undefined) {
      throw new Error(`vehicle ${vehicle.id} references unknown route ${vehicle.routeId}`);
    }

    const result = stepVehicle(baseline, baselineRoute, prev, vehicle.baseSpeedMps, dtSeconds, nextTick, prng);
    prng = result.prng;
    nextVehicles.set(vehicle.id, result.vehicle);
    for (const event of result.events) events.push(event);
  }

  return {
    state: { tick: nextTick, prng, vehicles: nextVehicles },
    events,
  };
}

interface StepVehicleResult {
  readonly vehicle: VehicleState;
  readonly prng: PrngState;
  readonly events: readonly ReducerEvent[];
}

function stepVehicle(
  baseline: SimBaseline,
  baselineRoute: BaselineRoute,
  prev: VehicleState,
  baseSpeedMps: number,
  dtSeconds: number,
  nextTick: number,
  prngIn: PrngState,
): StepVehicleResult {
  const events: ReducerEvent[] = [];
  const loopMode = baselineRoute.route.loopMode;

  // --- 1. dwell handling --------------------------------------------------
  if (prev.status === 'at_stop' && prev.dwellRemainingS > 0) {
    const dwellRemaining = prev.dwellRemainingS - dtSeconds;
    if (dwellRemaining > 0) {
      // Still dwelling: `s` frozen, speed 0. Geofence + telemetry still advance.
      const vehicleAtStop: VehicleState = {
        ...prev,
        speedMps: 0,
        dwellRemainingS: dwellRemaining,
        speedBuffer: pushSpeedSample(prev.speedBuffer, 0),
      };
      const geo = stepGeofences(baseline, baselineRoute, vehicleAtStop, nextTick);
      for (const e of geo.events) events.push(e);
      return { vehicle: geo.vehicle, prng: prngIn, events };
    }
    // Dwell finished: depart this stop, resume en route.
    const departedStop = baselineRoute.stops.find((bs) => bs.stop.seq === prev.dwellingStopSeq);
    if (departedStop !== undefined) {
      events.push({
        type: 'departed',
        tick: nextTick,
        vehicleId: prev.vehicleId,
        zoneId: null,
        payload: { stopId: departedStop.stop.id, stopName: departedStop.stop.name },
      });
    }
    events.push(statusChange(prev.vehicleId, nextTick, 'at_stop', 'en_route'));
    const resumed: VehicleState = {
      ...prev,
      status: 'en_route',
      dwellRemainingS: 0,
      dwellingStopSeq: -1,
    };
    // Fall through to motion this same tick with the resumed state.
    return stepMotion(baseline, baselineRoute, resumed, baseSpeedMps, dtSeconds, nextTick, prngIn, events, loopMode);
  }

  // --- 2. motion ----------------------------------------------------------
  return stepMotion(baseline, baselineRoute, prev, baseSpeedMps, dtSeconds, nextTick, prngIn, events, loopMode);
}

function stepMotion(
  baseline: SimBaseline,
  baselineRoute: BaselineRoute,
  prev: VehicleState,
  baseSpeedMps: number,
  dtSeconds: number,
  nextTick: number,
  prngIn: PrngState,
  carriedEvents: ReducerEvent[],
  loopMode: LoopMode,
): StepVehicleResult {
  const events = carriedEvents;

  // Cruise speed = base + bounded seeded jitter (the only PRNG draw per tick).
  const cruise = cruiseSpeed(baseSpeedMps, prngIn);
  const prng = cruise.prng;

  // Next stop ahead + remaining distance, for the braking taper + ETA.
  const nextStop = findNextStop(baselineRoute, prev.s, prev.direction);
  const remainingToStopM = nextStop?.remainingM ?? null;
  const taperedSpeed = applyBrakingTaper(cruise.speedMps, remainingToStopM);

  // --- arrival test: close enough -> begin dwell --------------------------
  // The braking taper (applyBrakingTaper) guarantees the vehicle is already
  // crawling (~ARRIVAL_SPEED_MPS) by the time it is within ARRIVAL_DISTANCE_M,
  // so reaching the arrival band IS the arrival — a separate speed gate would
  // sit a hair above the taper floor and never fire (the step distance skips the
  // narrow window). `dwellingStopSeq` guards against re-triggering the same stop.
  if (
    nextStop !== null &&
    remainingToStopM !== null &&
    remainingToStopM <= ARRIVAL_DISTANCE_M &&
    nextStop.stop.stop.dwellSeconds > 0 &&
    prev.dwellingStopSeq !== nextStop.stop.stop.seq
  ) {
    events.push({
      type: 'arrived',
      tick: nextTick,
      vehicleId: prev.vehicleId,
      zoneId: null,
      payload: { stopId: nextStop.stop.stop.id, stopName: nextStop.stop.stop.name },
    });
    events.push(statusChange(prev.vehicleId, nextTick, prev.status, 'at_stop'));
    const arrived: VehicleState = {
      ...prev,
      s: nextStop.stop.s,
      speedMps: 0,
      status: 'at_stop',
      dwellRemainingS: nextStop.stop.stop.dwellSeconds,
      dwellingStopSeq: nextStop.stop.stop.seq,
      speedBuffer: pushSpeedSample(prev.speedBuffer, 0),
    };
    const geo = stepGeofences(baseline, baselineRoute, arrived, nextTick);
    for (const e of geo.events) events.push(e);
    return { vehicle: geo.vehicle, prng, events };
  }

  // --- advance `s` --------------------------------------------------------
  const deltaM = taperedSpeed * dtSeconds;
  const advanced = advanceS(baselineRoute, prev.s, prev.direction, deltaM, loopMode);

  const moved: VehicleState = {
    ...prev,
    s: advanced.s,
    direction: advanced.direction,
    speedMps: taperedSpeed,
    status: prev.status === 'at_stop' ? 'en_route' : prev.status,
    dwellRemainingS: 0,
    // Once we have left the dwelled stop behind, clear the guard so a later
    // re-approach (loop / ping_pong) can dwell again.
    dwellingStopSeq: advanced.wrapped ? -1 : prev.dwellingStopSeq,
    speedBuffer: pushSpeedSample(prev.speedBuffer, taperedSpeed),
  };

  const geo = stepGeofences(baseline, baselineRoute, moved, nextTick);
  for (const e of geo.events) events.push(e);
  return { vehicle: geo.vehicle, prng, events };
}

interface GeofenceStepAllResult {
  readonly vehicle: VehicleState;
  readonly events: readonly ReducerEvent[];
}

/**
 * Run the hysteresis state machine for this vehicle against EVERY zone, emit any
 * confirmed enter/exit, and recompute the confirmed `currentZoneId`. Pure: the
 * updated trackers are stored back into the returned VehicleState.
 */
function stepGeofences(
  baseline: SimBaseline,
  baselineRoute: BaselineRoute,
  vehicle: VehicleState,
  nextTick: number,
): GeofenceStepAllResult {
  const events: ReducerEvent[] = [];
  const projected = projectAlongRoute(baselineRoute.projector, vehicle.s);
  const nextTrackers = new Map<string, GeofenceTracker>();
  let currentZoneId: string | null = null;

  for (const zone of baseline.zones) {
    const tracker = vehicle.geofenceTrackers.get(zone.id) ?? { state: 'outside', pendingTicks: 0 };
    const rawInside = isPointInZone(projected.lng, projected.lat, zone.geometry);
    const stepped = stepGeofence(tracker, rawInside);
    nextTrackers.set(zone.id, stepped.tracker);

    if (stepped.transition === 'enter') {
      events.push({
        type: 'geofence.enter',
        tick: nextTick,
        vehicleId: vehicle.vehicleId,
        zoneId: zone.id,
        payload: { zoneId: zone.id, zoneName: zone.name },
      });
    } else if (stepped.transition === 'exit') {
      events.push({
        type: 'geofence.exit',
        tick: nextTick,
        vehicleId: vehicle.vehicleId,
        zoneId: zone.id,
        payload: { zoneId: zone.id, zoneName: zone.name },
      });
    }

    // The confirmed inside zone (the last one wins if zones overlap — authored
    // not to, but deterministic regardless).
    if (stepped.tracker.state === 'inside') {
      currentZoneId = zone.id;
    }
  }

  return {
    vehicle: { ...vehicle, geofenceTrackers: nextTrackers, currentZoneId },
    events,
  };
}

function statusChange(
  vehicleId: string,
  tick: number,
  from: VehicleStatus,
  to: VehicleStatus,
): ReducerEvent {
  return {
    type: 'status.change',
    tick,
    vehicleId,
    zoneId: null,
    payload: { from, to },
  };
}

/**
 * Derive the authoritative WS telemetry for one vehicle from the current world
 * (projection + ETA). Pure; called by the shell/gateway to build snapshot/tick
 * frames. Kept here (next to the reducer) so the projection logic has exactly
 * one home.
 */
export function telemetryFor(
  baseline: SimBaseline,
  vehicle: VehicleState,
): VehicleTelemetry {
  const baselineRoute = baseline.routes.get(vehicle.routeId);
  if (baselineRoute === undefined) {
    throw new Error(`telemetry: vehicle ${vehicle.vehicleId} references unknown route`);
  }
  const projected = projectAlongRoute(baselineRoute.projector, vehicle.s);
  const total = baselineRoute.projector.totalLengthM;
  const progress = total > 0 ? Math.min(1, Math.max(0, vehicle.s / total)) : 0;

  const nextStop = findNextStop(baselineRoute, vehicle.s, vehicle.direction);
  const remainingM = remainingDistanceToStop(vehicle.s, nextStop?.stop.s ?? null);
  const etaSeconds =
    nextStop === null
      ? null
      : estimateEtaSeconds(remainingM, vehicle.speedBuffer, vehicle.dwellRemainingS);

  return {
    vehicleId: vehicle.vehicleId,
    lat: projected.lat,
    lng: projected.lng,
    headingDeg: projected.headingDeg,
    speedMps: vehicle.speedMps,
    routeId: vehicle.routeId,
    distanceAlongRouteM: vehicle.s,
    progress,
    status: vehicle.status,
    nextStopId: nextStop?.stop.stop.id ?? null,
    etaSeconds: etaSeconds === null ? null : Math.max(0, etaSeconds),
    currentZoneId: vehicle.currentZoneId,
  };
}
