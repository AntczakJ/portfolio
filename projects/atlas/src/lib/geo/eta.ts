/**
 * ETA computation (ADR-004 C1).
 *
 * ETA = remaining distance to the next stop (metres, from the cumulative table)
 * divided by a ROLLING-AVERAGE speed over the last K ticks — NOT the
 * instantaneous speed. The braking taper into stops drives instantaneous speed
 * toward zero, which would spike instantaneous-speed ETA toward infinity near
 * every stop; the rolling average smooths past the taper and the per-tick
 * jitter so the displayed ETA ticks down steadily. The result is clamped at a
 * sane floor so a near-stopped vehicle never reports an absurd ETA, and dwell
 * remaining is folded in while the vehicle is at a stop.
 *
 * All distances are METRES, speeds METRES/SECOND, ETAs SECONDS.
 */

/** How many recent per-tick speeds the rolling average considers. */
export const ROLLING_SPEED_WINDOW = 10;

/**
 * Minimum speed (m/s) the ETA divisor is clamped to. Below this a vehicle is
 * effectively stopped; dividing by a near-zero average would explode the ETA,
 * so we floor the divisor rather than report infinity.
 */
export const MIN_ETA_SPEED_MPS = 0.5;

/**
 * Push a new speed sample into a bounded rolling buffer (newest last), dropping
 * the oldest beyond {@link ROLLING_SPEED_WINDOW}. Returns a NEW array (pure —
 * the engine keeps this per-vehicle buffer in WorldState, so a deterministic
 * fold reconstructs it). Negative samples are clamped to 0.
 */
export function pushSpeedSample(buffer: readonly number[], speedMps: number): number[] {
  const next = [...buffer, Math.max(0, speedMps)];
  if (next.length > ROLLING_SPEED_WINDOW) {
    return next.slice(next.length - ROLLING_SPEED_WINDOW);
  }
  return next;
}

/** The arithmetic mean of a rolling speed buffer; 0 for an empty buffer. */
export function rollingAverageSpeed(buffer: readonly number[]): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (const v of buffer) sum += v;
  return sum / buffer.length;
}

/**
 * Estimate seconds to travel `remainingDistanceM` at the rolling-average speed.
 * Returns `null` when there is no remaining distance to a next stop (e.g. route
 * end with no next stop). The divisor is floored at {@link MIN_ETA_SPEED_MPS}.
 *
 * @param remainingDistanceM remaining metres to the next stop (>= 0), or null
 *   when there is no next stop.
 * @param speedBuffer the per-vehicle rolling speed buffer (m/s samples).
 * @param dwellRemainingSeconds seconds still to dwell at the CURRENT stop; while
 *   dwelling, ETA-to-next-stop is dwell remaining + onward travel.
 */
export function estimateEtaSeconds(
  remainingDistanceM: number | null,
  speedBuffer: readonly number[],
  dwellRemainingSeconds = 0,
): number | null {
  if (remainingDistanceM === null) return null;
  const divisor = Math.max(MIN_ETA_SPEED_MPS, rollingAverageSpeed(speedBuffer));
  const travelSeconds = remainingDistanceM / divisor;
  return Math.max(0, dwellRemainingSeconds) + travelSeconds;
}

/**
 * Remaining distance in metres from the current `s` to a stop at `stopS` along
 * the SAME route (partial-route, the cumulative table from ADR-002). Returns
 * `null` when `stopS` is null (no next stop). A stop already passed yields 0
 * rather than a negative distance.
 */
export function remainingDistanceToStop(currentS: number, stopS: number | null): number | null {
  if (stopS === null) return null;
  return Math.max(0, stopS - currentS);
}
