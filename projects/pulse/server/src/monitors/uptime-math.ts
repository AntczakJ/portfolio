import {
  DEGRADED_UPTIME_WEIGHT,
  type UptimeBreakdown,
} from '../lib/schemas/monitor-detail';
import type { MonitorStatus } from '../lib/schemas/events';

/**
 * Uptime computation — the ADR-004 hybrid, as PURE functions (no IO) so the
 * invariants are exhaustively unit-testable against fixtures.
 *
 * The rules (ADR-004), encoded once here:
 *   - Uptime is RESULT-BASED: each result "covers" the span until the next
 *     result, CAPPED at the monitor interval so a long gap does not inflate
 *     downtime.
 *   - `down` counts fully against uptime; `degraded` counts as 50%
 *     (DEGRADED_UPTIME_WEIGHT); `up` counts fully toward uptime.
 *   - A gap longer than `2 * interval` (paused monitor / worker down) is
 *     `unknown` and is EXCLUDED from both the numerator and the denominator —
 *     restarts must not read as outages.
 *   - The percentage is
 *       (upSeconds + 0.5 * degradedSeconds)
 *         / (upSeconds + degradedSeconds + downSeconds) * 100
 *     i.e. unknownSeconds never enter the denominator.
 *
 * Two entry points feed the same math:
 *   - {@link uptimeFromRawResults}  — the 24h path (raw `check_results`).
 *   - {@link uptimeFromRollups}     — the 7d/30d path (hourly rollup buckets)
 *                                     plus a raw top-up of the current partial
 *                                     hour, then summed with {@link mergeBreakdowns}.
 */

/** A raw check result, reduced to what the uptime math needs. */
export interface RawResultPoint {
  /** Epoch milliseconds (the result's `checked_at`). */
  checkedAtMs: number;
  status: MonitorStatus;
}

/** An hourly rollup bucket, reduced to what the uptime math needs. */
export interface RollupBucketCounts {
  upCount: number;
  degradedCount: number;
  downCount: number;
}

const EMPTY_BREAKDOWN: UptimeBreakdown = {
  upSeconds: 0,
  degradedSeconds: 0,
  downSeconds: 0,
  unknownSeconds: 0,
};

/**
 * Compute the second-level uptime breakdown from a window of RAW results.
 *
 * `results` must be ASCENDING by `checkedAtMs`. `windowStartMs` / `windowEndMs`
 * bound the window; `intervalSeconds` is the monitor's configured interval — the
 * per-result coverage cap.
 *
 * Coverage model: a result at time `t` with status `s` covers the span from `t`
 * forward to the NEXT result (or `windowEndMs` for the last one), CAPPED at
 * `interval`. Any span beyond the cap (so any inter-result gap wider than one
 * interval — paused monitor / worker down), AND a leading span before the first
 * result, is `unknown` and EXCLUDED from both numerator and denominator. For
 * ordinary interval-spaced results the uncovered remainder is ~0, so a healthy
 * monitor's uptime is unaffected; a long gap simply does not read as an outage
 * (ADR-004). (ADR-004 frames the unknown threshold as `2*interval`; capping
 * each result's coverage at one `interval` is the equivalent, simpler encoding —
 * anything past one interval is uncovered, and a genuine outage gap is many
 * intervals wide.)
 */
export function uptimeFromRawResults(
  results: readonly RawResultPoint[],
  windowStartMs: number,
  windowEndMs: number,
  intervalSeconds: number,
): UptimeBreakdown {
  const intervalMs = intervalSeconds * 1000;

  let upSeconds = 0;
  let degradedSeconds = 0;
  let downSeconds = 0;
  let unknownSeconds = 0;

  // Leading span: window start -> first result is unknown (no data observed).
  // We do NOT count it against uptime (excluded). It is surfaced as unknown
  // only if it is a genuine gap inside the window; a young monitor's
  // pre-birth time is the same shape (no data => excluded), so the partial
  // window falls out for free.
  if (results.length === 0) {
    return { ...EMPTY_BREAKDOWN, unknownSeconds: Math.max(0, (windowEndMs - windowStartMs) / 1000) };
  }

  const [first] = results;
  if (first && first.checkedAtMs > windowStartMs) {
    unknownSeconds += (first.checkedAtMs - windowStartMs) / 1000;
  }

  for (const [i, point] of results.entries()) {
    const next = results[i + 1];
    const spanEndMs = next ? next.checkedAtMs : windowEndMs;
    const spanMs = Math.max(0, spanEndMs - point.checkedAtMs);

    // The result covers at most `interval` of its span.
    const coveredMs = Math.min(spanMs, intervalMs);
    const seconds = coveredMs / 1000;

    switch (point.status) {
      case 'up':
        upSeconds += seconds;
        break;
      case 'degraded':
        degradedSeconds += seconds;
        break;
      case 'down':
        downSeconds += seconds;
        break;
    }

    // Anything beyond the per-result interval cap is time we have no signal for:
    // a genuine unknown gap (> 2*interval, worker down / paused) OR a shorter
    // over-cap remainder. Either way it is EXCLUDED as unknown rather than
    // attributed to the last status — that is what keeps the denominator honest
    // and stops a restart reading as an outage (ADR-004).
    const uncoveredMs = spanMs - coveredMs;
    if (uncoveredMs > 0) {
      unknownSeconds += uncoveredMs / 1000;
    }
  }

  return {
    upSeconds,
    degradedSeconds,
    downSeconds,
    unknownSeconds,
  };
}

/**
 * Compute the second-level uptime breakdown from a window of HOURLY ROLLUP
 * buckets. Each recorded check in a bucket represents ~`interval` seconds of
 * coverage, so a bucket's contribution is `count * interval` per status. The
 * rollup carries no notion of gaps (an `unknown` is a read-time derivation, not
 * a stored row), so this path yields no unknown seconds from the rollups
 * themselves — the unknown gap is recovered (a) by the partial-window
 * denominator falling out naturally and (b) by the raw top-up for the current
 * hour. The caller MERGES this with the raw top-up via {@link mergeBreakdowns}.
 */
export function uptimeFromRollups(
  buckets: readonly RollupBucketCounts[],
  intervalSeconds: number,
): UptimeBreakdown {
  let upSeconds = 0;
  let degradedSeconds = 0;
  let downSeconds = 0;

  for (const b of buckets) {
    upSeconds += b.upCount * intervalSeconds;
    degradedSeconds += b.degradedCount * intervalSeconds;
    downSeconds += b.downCount * intervalSeconds;
  }

  return { upSeconds, degradedSeconds, downSeconds, unknownSeconds: 0 };
}

/** Sum two breakdowns component-wise (rollup body + raw partial-hour top-up). */
export function mergeBreakdowns(a: UptimeBreakdown, b: UptimeBreakdown): UptimeBreakdown {
  return {
    upSeconds: a.upSeconds + b.upSeconds,
    degradedSeconds: a.degradedSeconds + b.degradedSeconds,
    downSeconds: a.downSeconds + b.downSeconds,
    unknownSeconds: a.unknownSeconds + b.unknownSeconds,
  };
}

/**
 * The uptime percentage from a breakdown (ADR-004):
 *   (up + 0.5*degraded) / (up + degraded + down) * 100
 * `unknown` is excluded from the denominator. Returns `null` when there is no
 * observed (up/degraded/down) time at all — the UI renders "no data".
 */
export function uptimePercentFromBreakdown(b: UptimeBreakdown): number | null {
  const observed = b.upSeconds + b.degradedSeconds + b.downSeconds;
  if (observed <= 0) return null;
  const good = b.upSeconds + DEGRADED_UPTIME_WEIGHT * b.degradedSeconds;
  const pct = (good / observed) * 100;
  // Clamp to [0, 100] against floating-point drift.
  return Math.min(100, Math.max(0, pct));
}

/** The observed (denominator) seconds of a breakdown — up+degraded+down. */
export function observedSeconds(b: UptimeBreakdown): number {
  return b.upSeconds + b.degradedSeconds + b.downSeconds;
}
