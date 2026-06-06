import type { LoopMode } from 'atlas-shared/schemas';

import type { BaselineRoute, BaselineStop } from '../baseline/types.js';
import type { Direction } from './world-state.js';

/**
 * Route-progress helpers (ADR-002 D1 / F1) — pure.
 *
 * Advance distance-along-route `s`, wrap/reverse at route end per the route's
 * `loop_mode`, and find the next stop ahead of the current `s` in the current
 * direction. The reducer wires these; it does not re-implement the geometry
 * (that is `atlas-shared/geo`).
 */

/** The outcome of advancing `s` by one tick, including a route-end transition. */
export interface AdvanceResult {
  /** The new distance-along-route, in `[0, totalLengthM]`. */
  readonly s: number;
  /** The new direction (flips on a ping_pong end; unchanged otherwise). */
  readonly direction: Direction;
  /** True if this advance wrapped (loop) or reversed (ping_pong) at an end. */
  readonly wrapped: boolean;
}

/**
 * Advance `s` by `deltaM` metres in `direction`, applying the route-end rule:
 *   - `loop`: walking forward past the end wraps `s` to 0 (and keeps going);
 *     walking backward is not used for loop routes (direction stays +1).
 *   - `ping_pong`: hitting either end reverses direction and reflects the
 *     overshoot back into the route, so the vehicle bounces.
 * Deterministic and bounded — a single tick's deltaM is small relative to the
 * route length, so at most one end is crossed per tick at the 1 Hz cadence.
 */
export function advanceS(
  baselineRoute: BaselineRoute,
  s: number,
  direction: Direction,
  deltaM: number,
  loopMode: LoopMode,
): AdvanceResult {
  const total = baselineRoute.projector.totalLengthM;
  if (total <= 0) {
    return { s: 0, direction, wrapped: false };
  }

  if (loopMode === 'loop') {
    // Loop always travels forward; wrap modulo the total length.
    const raw = s + deltaM;
    if (raw >= total) {
      const wrappedS = raw % total;
      return { s: wrappedS, direction: 1, wrapped: true };
    }
    return { s: raw, direction: 1, wrapped: false };
  }

  // ping_pong: reflect at the ends.
  const raw = s + deltaM * direction;
  if (raw > total) {
    const overshoot = raw - total;
    return { s: Math.max(0, total - overshoot), direction: -1, wrapped: true };
  }
  if (raw < 0) {
    const overshoot = -raw;
    return { s: Math.min(total, overshoot), direction: 1, wrapped: true };
  }
  return { s: raw, direction, wrapped: false };
}

/**
 * Find the next stop ahead of `s` in the given direction, and the remaining
 * distance to it (metres). Returns null when there is no stop ahead before the
 * route end (the route-end behaviour then carries the vehicle on).
 *
 * Forward (direction +1): the stop with the smallest `s` strictly greater than
 * the current `s` (within a small epsilon so a just-departed stop is skipped).
 * Backward (direction -1, ping_pong): the stop with the largest `s` strictly
 * less than the current `s`.
 */
export interface NextStop {
  readonly stop: BaselineStop;
  readonly remainingM: number;
}

const STOP_EPSILON_M = 0.5;

export function findNextStop(
  baselineRoute: BaselineRoute,
  s: number,
  direction: Direction,
): NextStop | null {
  let best: BaselineStop | null = null;
  for (const candidate of baselineRoute.stops) {
    if (direction === 1) {
      if (candidate.s > s + STOP_EPSILON_M) {
        if (best === null || candidate.s < best.s) best = candidate;
      }
    } else {
      if (candidate.s < s - STOP_EPSILON_M) {
        if (best === null || candidate.s > best.s) best = candidate;
      }
    }
  }
  if (best === null) return null;
  const remainingM = Math.abs(best.s - s);
  return { stop: best, remainingM };
}
