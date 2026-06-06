'use client';

import { useEffect } from 'react';

import { useConnectionStore } from '@/lib/store/connection-store';
import { useEventsStore } from '@/lib/store/events-store';
import { useSimControlStore } from '@/lib/store/sim-control-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';
import { TelemetryWsClient } from '@/lib/ws/ws-client';
import { resolveWsUrl } from '@/lib/ws/ws-url';

/**
 * useHeadlessTelemetry (Task 6.1 — the no-WebGL / table-view arm).
 *
 * The same single WebSocket as the map, but with NO map controller and NO rAF
 * interpolation loop. When the map surface is not rendered (WebGL unavailable, or
 * the user chose the table view), nothing else opens the socket, so the fleet
 * table needs its own connection to the live stream — fed into the SAME
 * low-frequency React stores the panels read (telemetry / events / connection /
 * sim-control). It opens exactly ONE socket while mounted.
 *
 * This is deliberately a trimmed copy of `useLiveTelemetry`'s store-feeding side
 * WITHOUT the off-render InterpStore + RafLoop + the controller calls. The 1 Hz
 * React updates are all the table needs (no per-frame motion to interpolate).
 *
 * Hard gate held: this is mounted ONLY when the map is NOT (the OpsSurface
 * renders either the map [which runs `useLiveTelemetry`] or the table [which runs
 * this]) — so there is never a second concurrent socket.
 */
export function useHeadlessTelemetry(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const connection = useConnectionStore.getState();
    const telemetryStore = useTelemetryStore.getState();
    const eventsStore = useEventsStore.getState();
    const simControl = useSimControlStore.getState();

    const client = new TelemetryWsClient({
      url: resolveWsUrl(),
      callbacks: {
        onSnapshot: (frame) => {
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
          telemetryStore.applyTick(frame.telemetry);
          connection.setServerTick(frame.serverTick);
        },
        onEvent: (frame) => {
          eventsStore.pushEvent(frame.event);
          connection.setServerTick(frame.serverTick);
        },
        onHeartbeat: (frame) => {
          connection.setServerTick(frame.serverTick);
        },
        onStatus: (status) => {
          connection.setStatus(status);
          simControl.setSend(
            status === 'live'
              ? (frame) => {
                  client.send(frame);
                }
              : null,
          );
        },
      },
    });

    connection.setStatus('connecting');
    client.connect();

    return () => {
      client.close();
      simControl.setSend(null);
    };
  }, [enabled]);
}
