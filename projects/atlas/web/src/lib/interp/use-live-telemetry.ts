'use client';

import { useEffect, useRef } from 'react';

import type { AtlasMapController } from '@/lib/map/map-controller';
import { InterpStore } from '@/lib/interp/interp-store';
import { RafLoop } from '@/lib/interp/raf-loop';
import { buildStopSIndex, type StopSIndex } from '@/lib/interp/stop-index';
import { useConnectionStore } from '@/lib/store/connection-store';
import { useEventsStore } from '@/lib/store/events-store';
import { useSimControlStore } from '@/lib/store/sim-control-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';
import { snapshotFrameToFleet } from '@/lib/ws/snapshot-adapter';
import { TelemetryWsClient } from '@/lib/ws/ws-client';
import { resolveWsUrl } from '@/lib/ws/ws-url';

/**
 * useLiveTelemetry — wire the single WebSocket + the rAF interpolation loop to
 * the (already-mounted) imperative map controller (Task 4.2 + 4.3).
 *
 * This is the glue, and it keeps the hard gate: NOTHING per-frame goes through
 * React state. The WS client writes each authoritative tick into the
 * off-render-path InterpStore; a single RafLoop reads it every frame and drives
 * the controller's `setVehiclesGeoJSON` / trail / remaining-route imperatively.
 * Only the LOW-frequency connection status + the geofence zone-pulse touch React
 * (the connection store + the zone-pulse paint call — both a handful of times,
 * not per frame).
 *
 * Lifecycle: mounts when the controller is `ready`; opens ONE socket; on unmount
 * closes the socket and stops the loop. On reduced-motion the loop snaps to
 * ticks (markers step, the fleet stays live). The live reduced-motion flag is
 * read through a ref so it never re-creates the socket — the mount effect's only
 * genuine dependencies are the controller + ready (no `exhaustive-deps` escape
 * hatch needed; the root ESLint config has no react-hooks plugin so an inline
 * disable would itself error — the Phase 2 lesson).
 *
 * @param controller the mounted controller (null until the map is ready)
 * @param ready true once the map's first style + layers are up
 * @param reducedMotion the current prefers-reduced-motion state
 */
export function useLiveTelemetry(
  controller: AtlasMapController | null,
  ready: boolean,
  reducedMotion: boolean,
): void {
  // Bridge the live reduced-motion flag to the loop's store through refs, so the
  // mount-once effect below references neither `reducedMotion` (kept current via
  // the ref) and does not re-create the socket on a motion-pref change.
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const interpRef = useRef<InterpStore | null>(null);

  useEffect(() => {
    interpRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (!controller || !ready) return;

    const interp = new InterpStore();
    interp.setReducedMotion(reducedMotionRef.current);
    interpRef.current = interp;

    const loop = new RafLoop(interp, {
      setVehiclesGeoJSON: (fc) => {
        controller.setVehiclesGeoJSON(fc);
      },
      setTrailsGeoJSON: (fc) => {
        controller.setTrailsGeoJSON(fc);
      },
      setRemainingGeoJSON: (fc) => {
        controller.setRemainingGeoJSON(fc);
      },
    });

    // Per-vehicle nextStop -> s index, rebuilt on each snapshot.
    let stopSIndex: StopSIndex = new Map();
    const setNextStopFor = (vehicleId: string, nextStopId: string | null): void => {
      const s = nextStopId !== null ? (stopSIndex.get(nextStopId) ?? null) : null;
      loop.setNextStopS(vehicleId, s);
    };

    const connection = useConnectionStore.getState();
    // The LOW-frequency React stores the panels read (Task 5). They are fed from
    // the SAME socket — never a second connection. 1 Hz is fine for React; the
    // per-frame motion stays in the off-render InterpStore + the rAF loop above.
    const telemetryStore = useTelemetryStore.getState();
    const eventsStore = useEventsStore.getState();
    const simControl = useSimControlStore.getState();

    const client = new TelemetryWsClient({
      url: resolveWsUrl(),
      callbacks: {
        onSnapshot: (frame) => {
          // Re-derive the full world on the map, register route projectors, seed
          // the interp store, and rebuild the stop index.
          const fleet = snapshotFrameToFleet(frame);
          controller.setSnapshot(fleet);
          // The interp store + stop index consume the SHARED wire types directly
          // (geometry as GeoJSON LineString), not the adapted view model.
          interp.setRoutes(frame.routes);
          interp.seedFromSnapshot(frame.telemetry, performance.now());
          stopSIndex = buildStopSIndex(frame.routes, frame.stops);
          for (const t of frame.telemetry) setNextStopFor(t.vehicleId, t.nextStopId);
          interp.setFrozen(false);
          // Seed the low-frequency panel store (static defs + first telemetry).
          telemetryStore.applySnapshot({
            vehicles: frame.vehicles,
            routes: frame.routes,
            stops: frame.stops,
            zones: frame.zones,
            telemetry: frame.telemetry,
          });
          connection.setServerTick(frame.serverTick);
        },
        onTick: (frame) => {
          const now = performance.now();
          for (const t of frame.telemetry) {
            interp.applyTick(t, now);
            setNextStopFor(t.vehicleId, t.nextStopId);
          }
          // 1 Hz React update for the panels — replaces the changed vehicles.
          telemetryStore.applyTick(frame.telemetry);
          connection.setServerTick(frame.serverTick);
        },
        onEvent: (frame) => {
          // Zone pulse on a geofence enter/exit (a low-frequency paint call,
          // reduced-motion-safe inside the controller).
          const event = frame.event;
          if (
            (event.type === 'geofence.enter' || event.type === 'geofence.exit') &&
            event.zoneId !== null
          ) {
            controller.pulseZone(event.zoneId);
          }
          // The events feed + the detail panel's recent-events read this store.
          // The geofence beat is now wired three ways: zone pulse (above) + the
          // event row (here) + the status flip (folded into the next tick's
          // telemetry, already applied to the telemetry store).
          eventsStore.pushEvent(event);
          connection.setServerTick(frame.serverTick);
        },
        onHeartbeat: (frame) => {
          connection.setServerTick(frame.serverTick);
        },
        onStatus: (status) => {
          connection.setStatus(status);
          // On a drop the InterpStore keeps holding the last authoritative
          // positions (the loop freezes them at t==1) — never stale-as-live. A
          // fresh snapshot on reconnect reseeds cleanly.
          interp.setFrozen(status !== 'live');
          // Publish/clear the sim-control bridge so the demo affordance can only
          // send over a live socket (no queueing into the void).
          simControl.setSend(status === 'live' ? (frame) => { client.send(frame); } : null);
        },
      },
    });

    connection.setStatus('connecting');
    client.connect();
    loop.start();

    return () => {
      client.close();
      loop.stop();
      interp.clear();
      interpRef.current = null;
      simControl.setSend(null);
    };
  }, [controller, ready]);
}
