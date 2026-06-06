/**
 * Pure interpolation math (Task 4.2, the wow).
 *
 * The server emits an authoritative telemetry tick at ~1 Hz (ADR-002); the
 * client interpolates between the last two authoritative ticks of each vehicle
 * with `requestAnimationFrame` so a marker SLIDES continuously at ~60 fps rather
 * than jumping once a second. The gap between "1 Hz data" and "60 fps motion" is
 * the senior signal (a skeptic sees one WS frame/sec in DevTools yet buttery
 * motion).
 *
 * Position is lerped along the route GEOMETRY (via the shared
 * `atlas-shared/geo` cumulative-length projector — the same math the engine
 * projects from, so the interpolated path follows the road, not a straight
 * chord between the two tick points). Heading is shortest-arc interpolated so a
 * marker rounding a corner rotates the short way (e.g. 350 deg -> 10 deg goes
 * through 0, not the long way round 180).
 *
 * Everything here is PURE and framework-free — no MapLibre, no React, no
 * wall-clock. The rAF loop supplies the clock; this module is unit-tested in
 * isolation (the lerp/slerp correctness gate).
 */

import { projectAlongRoute, type RouteProjector } from 'atlas-shared/geo';

/**
 * The two authoritative endpoints the loop interpolates BETWEEN for one
 * vehicle, plus the route projector the position lerp walks. `last` is the
 * older authoritative tick, `next` the newer one; `t` in [0, 1] slides from
 * `last` to `next`.
 *
 * Distances are metres-along-route (the engine's `distanceAlongRouteM`), so the
 * interpolated position is projected from the in-between distance — the marker
 * tracks the polyline exactly, including around vertices.
 */
export interface InterpEndpoints {
  /** Distance-along-route of the older authoritative tick, metres. */
  lastS: number;
  /** Distance-along-route of the newer authoritative tick, metres. */
  nextS: number;
  /** Heading of the older tick, degrees clockwise from north [0, 360). */
  lastHeadingDeg: number;
  /** Heading of the newer tick, degrees [0, 360). */
  nextHeadingDeg: number;
  /** The route the vehicle is on, so `s` projects to lat/lng/heading. */
  projector: RouteProjector;
}

/** An interpolated marker pose for one animation frame. */
export interface InterpPose {
  /** GeoJSON [lng, lat]. */
  position: [number, number];
  /** Heading in degrees clockwise from north [0, 360). */
  headingDeg: number;
}

/** Clamp a value into [0, 1]. */
export function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/** Normalise a heading into [0, 360). */
export function normalizeHeading(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Shortest-arc interpolation between two headings (degrees). Picks the signed
 * delta in (-180, 180] so the marker rotates the short way around the compass
 * (350 -> 10 sweeps +20 through 0, not -340 the long way). `t` in [0, 1].
 */
export function lerpHeading(fromDeg: number, toDeg: number, t: number): number {
  const a = normalizeHeading(fromDeg);
  const b = normalizeHeading(toDeg);
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeHeading(a + delta * clamp01(t));
}

/**
 * Interpolate a vehicle's pose at fraction `t` between its last and next
 * authoritative ticks. Position is the projection of the lerped
 * distance-along-route (so it follows the road geometry); heading is the
 * shortest-arc blend of the two authoritative headings.
 *
 * Route-end wrap (loop / ping-pong) is handled by the loop BEFORE building the
 * endpoints (it does not feed a backwards `nextS < lastS` across a wrap as a
 * giant rewind — it snaps on a wrap, see the raf-loop). Here we simply lerp the
 * scalar `s`, which the engine guarantees is monotone within a non-wrapping
 * pair.
 */
export function interpolatePose(endpoints: InterpEndpoints, t: number): InterpPose {
  const k = clamp01(t);
  const s = endpoints.lastS + (endpoints.nextS - endpoints.lastS) * k;
  const projected = projectAlongRoute(endpoints.projector, s);
  return {
    position: [projected.lng, projected.lat],
    headingDeg: lerpHeading(endpoints.lastHeadingDeg, endpoints.nextHeadingDeg, k),
  };
}

/**
 * The fraction `t` in [0, 1] of the way from the last authoritative tick to the
 * next, given the wall-clock elapsed since the last tick landed and the
 * expected inter-tick interval. Clamped at 1 so a late next-tick FREEZES the
 * marker at the last authoritative position rather than dead-reckoning past it
 * (the "never drift past a small cap / never show stale-as-live" rule — at t==1
 * the marker simply holds at the newest authoritative point until a fresh tick
 * extends the segment).
 */
export function tickProgress(elapsedMs: number, intervalMs: number): number {
  if (intervalMs <= 0) return 1;
  return clamp01(elapsedMs / intervalMs);
}
