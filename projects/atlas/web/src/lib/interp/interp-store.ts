/**
 * The off-React-render-path telemetry store (Task 4.2, the hard gate).
 *
 * This is a PLAIN class holding mutable fields — NOT React state, NOT Zustand.
 * It is the boundary the "streaming surface is not React state per frame" rule
 * (ADR-001) protects: the WS client writes each authoritative tick here, and the
 * rAF loop reads it every frame to drive MapLibre imperatively. No React render
 * is involved in the per-frame path; per-marker per-frame through React state is
 * the exact frame-budget mistake this design avoids.
 *
 * Per vehicle it keeps the LAST two authoritative ticks (the segment to
 * interpolate across) and the wall-clock time the latest one landed (the loop's
 * `t` clock). Route projectors are built ONCE per route (the cumulative-length
 * table is expensive) and cached, so an incoming tick is O(1) — it does not
 * rebuild geometry.
 */

import { buildRouteProjector, type RouteProjector } from 'atlas-shared/geo';
import type { Route, VehicleTelemetry } from 'atlas-shared/schemas';

/** One vehicle's two authoritative endpoints + the clock for the latest tick. */
export interface VehicleInterpState {
  routeId: string;
  /** The older authoritative tick (interpolate FROM here). */
  last: VehicleTelemetry;
  /** The newer authoritative tick (interpolate TO here). */
  next: VehicleTelemetry;
  /** `performance.now()` when `next` landed — the rAF loop's `t` origin. */
  nextAtMs: number;
  /**
   * True when `last`/`next` should NOT be interpolated across (a route wrap, a
   * snapshot reseed, or a brand-new vehicle): the loop SNAPS to `next` rather
   * than tweening a giant rewind. Cleared once the next genuine forward tick
   * arrives and a real segment exists.
   */
  snap: boolean;
}

export class InterpStore {
  /** Per-vehicle interpolation state, keyed by vehicleId. */
  private readonly vehicles = new Map<string, VehicleInterpState>();
  /** Cached route projectors, keyed by routeId (built once per route). */
  private readonly projectors = new Map<string, RouteProjector>();
  /** Route lengths in metres, keyed by routeId (for wrap detection). */
  private readonly routeLengths = new Map<string, number>();
  /** When true the loop snaps to each tick (prefers-reduced-motion). */
  private reducedMotion = false;
  /** The expected inter-tick interval (ms), adapted from observed cadence. */
  private intervalMs = 1000;
  /** When the engine is paused (no ticks expected) — the loop freezes cleanly. */
  private frozen = false;

  /** Register/replace the route geometry projectors (snapshot frame). */
  setRoutes(routes: readonly Route[]): void {
    for (const route of routes) {
      if (!this.projectors.has(route.id)) {
        this.projectors.set(route.id, buildRouteProjector(route.geometry));
      }
      this.routeLengths.set(route.id, route.lengthM);
    }
  }

  getProjector(routeId: string): RouteProjector | undefined {
    return this.projectors.get(routeId);
  }

  getRouteLength(routeId: string): number | undefined {
    return this.routeLengths.get(routeId);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  setIntervalMs(ms: number): void {
    if (ms > 0 && Number.isFinite(ms)) this.intervalMs = ms;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Seed every vehicle from a snapshot frame's telemetry — both endpoints are
   * the same authoritative point and `snap` is set, so the first paint shows the
   * fleet AT the snapshot positions with no spurious tween from a stale prior
   * state. Routes must be registered first (the snapshot carries both).
   */
  seedFromSnapshot(telemetry: readonly VehicleTelemetry[], nowMs: number): void {
    this.vehicles.clear();
    for (const t of telemetry) {
      this.vehicles.set(t.vehicleId, {
        routeId: t.routeId,
        last: t,
        next: t,
        nextAtMs: nowMs,
        snap: true,
      });
    }
  }

  /**
   * Apply an authoritative tick for one vehicle: the current `next` becomes the
   * new `last`, the incoming telemetry becomes the new `next`, and the clock
   * resets. A route wrap (the new `s` jumps backwards by more than half the
   * route — loop/ping-pong, ADR-002) or a route change SNAPS rather than
   * tweening a rewind. A brand-new vehicle seeds both endpoints to itself.
   */
  applyTick(t: VehicleTelemetry, nowMs: number): void {
    const existing = this.vehicles.get(t.vehicleId);
    if (existing?.routeId !== t.routeId) {
      this.vehicles.set(t.vehicleId, {
        routeId: t.routeId,
        last: t,
        next: t,
        nextAtMs: nowMs,
        snap: true,
      });
      return;
    }

    const routeLen = this.routeLengths.get(t.routeId) ?? 0;
    const prevS = existing.next.distanceAlongRouteM;
    const newS = t.distanceAlongRouteM;
    // A wrap: s decreased by more than half the route (loop reset or ping-pong
    // turn projected as a large backwards jump in raw s). Snap, do not rewind.
    const wrapped = routeLen > 0 && prevS - newS > routeLen / 2;

    this.vehicles.set(t.vehicleId, {
      routeId: t.routeId,
      last: existing.next,
      next: t,
      nextAtMs: nowMs,
      snap: wrapped,
    });
  }

  /** The current per-vehicle states the rAF loop iterates each frame. */
  entries(): IterableIterator<[string, VehicleInterpState]> {
    return this.vehicles.entries();
  }

  get size(): number {
    return this.vehicles.size;
  }

  clear(): void {
    this.vehicles.clear();
  }
}
