import bearing from '@turf/bearing';
import distance from '@turf/distance';
import { point } from '@turf/helpers';

import type { LineStringGeometry } from '../schemas/geojson';
import type { ProjectedPoint, RouteProjector } from './types';

/**
 * Route projection (ADR-002 D1 / ADR-004).
 *
 * All distances are in METRES. turf defaults to kilometres, so every call here
 * passes `{ units: 'meters' }` explicitly — the ADR-004 units sharp edge.
 */

const METERS = { units: 'meters' } as const;

/** Normalise any bearing/heading into the [0, 360) range. */
export function normalizeHeading(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Build a {@link RouteProjector} from a route LineString — done ONCE at load,
 * not per tick. Computes the cumulative per-vertex distance table (turf
 * `distance` per segment, metres) so per-tick projection is an O(log segments)
 * binary search.
 */
export function buildRouteProjector(geometry: LineStringGeometry): RouteProjector {
  const coordinates = geometry.coordinates.map(([lng, lat]) => [lng, lat] as const);
  const cumulative: number[] = new Array<number>(coordinates.length);
  cumulative[0] = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    if (prev === undefined || curr === undefined) {
      // Unreachable given the loop bounds; satisfies noUncheckedIndexedAccess.
      throw new Error('route geometry has a hole in its coordinate array');
    }
    const segmentM = distance(point([prev[0], prev[1]]), point([curr[0], curr[1]]), METERS);
    cumulative[i] = (cumulative[i - 1] ?? 0) + segmentM;
  }
  const totalLengthM = cumulative[cumulative.length - 1] ?? 0;
  return { coordinates, cumulative, totalLengthM };
}

/** Total route length in metres (=== the projector's last cumulative value). */
export function routeLengthM(projector: RouteProjector): number {
  return projector.totalLengthM;
}

/**
 * Clamp a raw distance-along-route `s` into the projector's `[0, totalLengthM]`
 * domain. The engine's route-end behaviour (loop / ping-pong) is applied BEFORE
 * projection; this is a final safety clamp so a tiny float overshoot never
 * indexes past the table.
 */
export function clampS(projector: RouteProjector, s: number): number {
  if (s <= 0) return 0;
  if (s >= projector.totalLengthM) return projector.totalLengthM;
  return s;
}

/**
 * Find the index `i` of the segment `[i, i+1]` that contains distance `s`, via
 * binary search over the cumulative table. Returns an index in
 * `[0, coordinates.length - 2]`.
 */
function findSegmentIndex(projector: RouteProjector, s: number): number {
  const { cumulative } = projector;
  // Largest i such that cumulative[i] <= s.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const midVal = cumulative[mid] ?? Infinity;
    if (midVal <= s) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Clamp so we always have a valid [i, i+1] segment.
  return Math.min(lo, cumulative.length - 2);
}

/**
 * Project a distance-along-route `s` (metres) to a lat/lng/heading
 * (ADR-002 D1): binary-search the segment, linearly interpolate the position
 * within it, and take the heading as the segment bearing. Pure and exact (the
 * lerp matches turf `along`, which is the test oracle).
 */
export function projectAlongRoute(projector: RouteProjector, s: number): ProjectedPoint {
  const clamped = clampS(projector, s);
  const i = findSegmentIndex(projector, clamped);
  const a = projector.coordinates[i];
  const b = projector.coordinates[i + 1];
  if (a === undefined || b === undefined) {
    throw new Error('route projector has fewer than two coordinates');
  }
  const startCum = projector.cumulative[i] ?? 0;
  const endCum = projector.cumulative[i + 1] ?? startCum;
  const segmentLen = endCum - startCum;
  const tRaw = segmentLen > 0 ? (clamped - startCum) / segmentLen : 0;
  const t = Math.min(1, Math.max(0, tRaw));

  const lng = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;

  const segmentBearing = bearing(point([a[0], a[1]]), point([b[0], b[1]]));
  return { lat, lng, headingDeg: normalizeHeading(segmentBearing) };
}
