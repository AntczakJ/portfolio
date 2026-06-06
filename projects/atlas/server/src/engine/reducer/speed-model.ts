import { nextRange, type PrngState } from './prng.js';

/**
 * Speed / dwell model (ADR-002 E1). Small, legible, deterministic — reads as
 * real delivery motion (slow-in to a stop, pause, pull away) without a physics
 * engine. All helpers are PURE; the per-tick jitter is drawn from the PRNG
 * carried in WorldState (the reducer threads the advanced state forward), never
 * from `Math.random`.
 *
 * Units: distances METRES, speeds METRES/SECOND.
 */

/**
 * Distance (metres) ahead of a stop at which a vehicle begins braking. Inside
 * this band the cruise speed tapers smoothly toward (near) zero so the vehicle
 * eases into the stop rather than teleport-stopping (which would snap the
 * client interpolation).
 */
export const BRAKING_DISTANCE_M = 60;

/** Speed (m/s) at which a braking vehicle is considered "arrived" and dwells. */
export const ARRIVAL_SPEED_MPS = 1.5;

/** Distance (metres) within which a vehicle is treated as AT the stop. */
export const ARRIVAL_DISTANCE_M = 4;

/** Bounded fractional jitter on the cruise speed, +/- this fraction. */
export const CRUISE_JITTER_FRACTION = 0.12;

/**
 * The cruise speed for this tick: the vehicle's base speed perturbed by a
 * bounded seeded jitter so the fleet does not move in lockstep. Returns the
 * advanced PRNG state (the reducer stores it back). Clamped to stay positive.
 */
export function cruiseSpeed(
  baseSpeedMps: number,
  prng: PrngState,
): { prng: PrngState; speedMps: number } {
  const { state, value } = nextRange(prng, -CRUISE_JITTER_FRACTION, CRUISE_JITTER_FRACTION);
  const speed = baseSpeedMps * (1 + value);
  return { prng: state, speedMps: Math.max(0.5, speed) };
}

/**
 * Apply the braking taper: given the unbraked cruise speed and the remaining
 * distance to the next stop, scale the speed down smoothly as the stop nears.
 * Outside {@link BRAKING_DISTANCE_M} the cruise speed is returned unchanged;
 * inside it the speed scales linearly with the remaining fraction toward a small
 * floor. Pure.
 */
export function applyBrakingTaper(cruiseSpeedMps: number, remainingToStopM: number | null): number {
  if (remainingToStopM === null || remainingToStopM >= BRAKING_DISTANCE_M) {
    return cruiseSpeedMps;
  }
  const fraction = Math.max(0, remainingToStopM) / BRAKING_DISTANCE_M;
  // Ease toward ARRIVAL_SPEED_MPS rather than 0 so the vehicle keeps creeping
  // into the stop (it then transitions to dwell on the arrival test).
  return ARRIVAL_SPEED_MPS + (cruiseSpeedMps - ARRIVAL_SPEED_MPS) * fraction;
}
