/**
 * The rAF interpolation loop (Task 4.2, the wow's beating heart).
 *
 * A SINGLE `requestAnimationFrame` loop reads the off-render-path
 * {@link InterpStore} every frame, interpolates each vehicle's pose between its
 * last + next authoritative ticks, and drives MapLibre ONCE per frame through
 * the imperative controller (`setVehiclesGeoJSON` -> one `GeoJSONSource.setData`,
 * no React reconciliation). At ~1 Hz server data and ~60 fps frames this is the
 * 1 Hz-data / 60 fps-motion gap that is the senior signal.
 *
 * Reduced-motion: the store's `reducedMotion` flag makes every vehicle SNAP to
 * its newest authoritative position (no tween) — the loop still runs (the fleet
 * stays live) but markers step rather than glide.
 *
 * The loop also refreshes the trail (behind) + remaining-route (ahead) layers,
 * THROTTLED to a few times a second (those lines move slowly relative to the
 * 60 fps marker glide and a full re-slice every frame is wasted work) — still
 * off the React render path, a MapLibre `setData` on the trail/route sources.
 */

import { sliceRouteGeometry } from 'atlas-shared/geo';
import type { FeatureCollection, LineString, Point } from 'geojson';

import { interpolatePose, tickProgress } from '@/lib/interp/interpolation';
import type { InterpStore, VehicleInterpState } from '@/lib/interp/interp-store';

/** The subset of the controller the loop drives (kept narrow for testing). */
export interface LoopMapTarget {
  setVehiclesGeoJSON: (fc: FeatureCollection<Point>) => void;
  setTrailsGeoJSON: (fc: FeatureCollection<LineString>) => void;
  setRemainingGeoJSON: (fc: FeatureCollection<LineString>) => void;
}

/** How often (ms) to re-slice the trail + remaining-route lines. */
const LINE_REFRESH_MS = 200;

export class RafLoop {
  private rafId: number | null = null;
  // -Infinity so the very first frame always refreshes the trail/remaining lines.
  private lastLineRefreshMs = Number.NEGATIVE_INFINITY;
  private readonly store: InterpStore;
  private readonly target: LoopMapTarget;
  /** Per-vehicle next-stop distance-along-route `s` (metres), for remaining. */
  private readonly nextStopS = new Map<string, number | null>();

  constructor(store: InterpStore, target: LoopMapTarget) {
    this.store = store;
    this.target = target;
  }

  /** Record (or clear) a vehicle's next-stop `s` so the remaining-route slice
   * draws current..nextStop. Driven off authoritative ticks by the WS glue. */
  setNextStopS(vehicleId: string, s: number | null): void {
    this.nextStopS.set(vehicleId, s);
  }

  start(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    const frame = (nowMs: number): void => {
      this.tickFrame(nowMs);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Build + push one frame. Public for a deterministic unit/integration test
   * (call with a controlled clock instead of the rAF callback). */
  tickFrame(nowMs: number): void {
    if (this.store.size === 0) return;

    const reduced = this.store.isReducedMotion();
    const frozen = this.store.isFrozen();
    const intervalMs = this.store.getIntervalMs();

    const vehicleFeatures: FeatureCollection<Point>['features'] = [];

    for (const [id, state] of this.store.entries()) {
      const pose = this.poseFor(state, nowMs, reduced || frozen, intervalMs);
      vehicleFeatures.push({
        type: 'Feature',
        id,
        properties: {
          id,
          // The HUMAN short marker label ("U7"), unified with the panels — the
          // label layer's icon-image keys on this (P1-3: no `veh-N` on markers).
          marker: this.store.markerLabel(id),
          status: state.next.status,
          heading: pose.headingDeg,
        },
        geometry: { type: 'Point', coordinates: pose.position },
      });
    }

    this.target.setVehiclesGeoJSON({ type: 'FeatureCollection', features: vehicleFeatures });

    // Throttled trail + remaining-route refresh.
    if (nowMs - this.lastLineRefreshMs >= LINE_REFRESH_MS) {
      this.lastLineRefreshMs = nowMs;
      this.refreshLines(nowMs, reduced || frozen, intervalMs);
    }
  }

  /** The interpolated (or snapped) pose for one vehicle this frame. */
  private poseFor(
    state: VehicleInterpState,
    nowMs: number,
    snapMode: boolean,
    intervalMs: number,
  ): { position: [number, number]; headingDeg: number } {
    const projector = this.store.getProjector(state.routeId);
    // No projector yet (routes not seeded) — fall back to the raw next point.
    if (!projector) {
      return {
        position: [state.next.lng, state.next.lat],
        headingDeg: state.next.headingDeg,
      };
    }

    // Snap: reduced-motion, a frozen engine, a wrap, or a fresh seed -> hold at
    // the newest authoritative point, no tween.
    if (snapMode || state.snap || state.last === state.next) {
      return {
        position: [state.next.lng, state.next.lat],
        headingDeg: state.next.headingDeg,
      };
    }

    const t = tickProgress(nowMs - state.nextAtMs, intervalMs);
    const pose = interpolatePose(
      {
        lastS: state.last.distanceAlongRouteM,
        nextS: state.next.distanceAlongRouteM,
        lastHeadingDeg: state.last.headingDeg,
        nextHeadingDeg: state.next.headingDeg,
        projector,
      },
      t,
    );
    return pose;
  }

  /** Re-slice the trail (start..current) + remaining (current..nextStop) lines
   * for every vehicle off its interpolated `s`. Off the React render path. */
  private refreshLines(nowMs: number, snapMode: boolean, intervalMs: number): void {
    const trails: FeatureCollection<LineString>['features'] = [];
    const remaining: FeatureCollection<LineString>['features'] = [];

    for (const [id, state] of this.store.entries()) {
      const projector = this.store.getProjector(state.routeId);
      if (!projector) continue;

      const currentS = this.currentS(state, nowMs, snapMode, intervalMs);

      // Trail: the last stretch the vehicle has covered (a bounded tail, not the
      // whole route, so it reads as a fading recent path, not the full line).
      const trailLenM = Math.min(currentS, 350);
      const trailCoords = sliceRouteGeometry(projector, currentS - trailLenM, currentS);
      if (trailCoords.length >= 2) {
        trails.push({
          type: 'Feature',
          id,
          properties: { id },
          geometry: { type: 'LineString', coordinates: trailCoords },
        });
      }

      // Remaining: current..nextStop (or current..route-end if no next stop).
      const stopS = this.nextStopS.get(id);
      const targetS = stopS ?? projector.totalLengthM;
      if (targetS > currentS + 1) {
        const remCoords = sliceRouteGeometry(projector, currentS, targetS);
        if (remCoords.length >= 2) {
          remaining.push({
            type: 'Feature',
            id,
            properties: { id },
            geometry: { type: 'LineString', coordinates: remCoords },
          });
        }
      }
    }

    this.target.setTrailsGeoJSON({ type: 'FeatureCollection', features: trails });
    this.target.setRemainingGeoJSON({ type: 'FeatureCollection', features: remaining });
  }

  /** The interpolated distance-along-route for one vehicle this frame. */
  private currentS(
    state: VehicleInterpState,
    nowMs: number,
    snapMode: boolean,
    intervalMs: number,
  ): number {
    if (snapMode || state.snap || state.last === state.next) {
      return state.next.distanceAlongRouteM;
    }
    const t = tickProgress(nowMs - state.nextAtMs, intervalMs);
    return (
      state.last.distanceAlongRouteM +
      (state.next.distanceAlongRouteM - state.last.distanceAlongRouteM) * t
    );
  }
}
