'use client';

import { Gauge, Pause, Play, Radar } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useFocusVehicle } from '@/lib/fleet/use-focus-vehicle';
import { useSimControlStore } from '@/lib/store/sim-control-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';

/**
 * Demo / replay affordance (Task 5.4).
 *
 * The reproducible wow beat for a recruiter who will not wait: one button that
 * curates "watch a delivery cross a geofence" — it picks an en-route vehicle
 * that is NOT currently inside any zone (so it is heading toward one), selects +
 * flies the camera to it, and nudges the demo speed up so the cross-the-boundary
 * -and-fire beat (zone pulse + event row + status flip) plays within seconds
 * rather than on the engine's organic schedule.
 *
 * Tight on purpose (PLAN.md: do not balloon 5.4 into a full scrub UI). It speaks
 * the existing `sim.control` channel over the ONE socket (the sim-control store
 * bridges to the single WS client) — `setSpeed` / `pause` / `resume`. The
 * deterministic engine makes the seek/scrub a clean v2 lever; v1 ships the focus
 * affordance + a pause/speed control, which delivers the beat reliably.
 *
 * Disabled until the socket is live (no queueing a control into the void).
 */

/** The "show me the beat" speed bump — fast enough to reach a zone soon. */
const BEAT_SPEED = 4;

export function DemoControl(): ReactNode {
  const send = useSimControlStore((s) => s.send);
  const paused = useSimControlStore((s) => s.paused);
  const speed = useSimControlStore((s) => s.speed);
  const setPaused = useSimControlStore((s) => s.setPaused);
  const setSpeed = useSimControlStore((s) => s.setSpeed);
  const focusVehicle = useFocusVehicle();

  const connected = send !== null;

  const playBeat = (): void => {
    if (!send) return;
    // Find a vehicle approaching a zone: en route, not yet inside one.
    const { vehicleIds, telemetry } = useTelemetryStore.getState();
    const candidate =
      vehicleIds.find((id) => {
        const t = telemetry[id];
        return t?.status === 'en_route' && t.currentZoneId === null;
      }) ?? vehicleIds[0];
    if (!candidate) return;

    focusVehicle(candidate);
    // Resume if paused, then bump the demo speed so the crossing happens soon.
    if (paused) {
      send({ t: 'sim.control', action: 'resume' });
      setPaused(false);
    }
    send({ t: 'sim.control', action: 'setSpeed', multiplier: BEAT_SPEED });
    setSpeed(BEAT_SPEED);
  };

  const togglePause = (): void => {
    if (!send) return;
    if (paused) {
      send({ t: 'sim.control', action: 'resume' });
      setPaused(false);
    } else {
      send({ t: 'sim.control', action: 'pause' });
      setPaused(true);
    }
  };

  const changeSpeed = (multiplier: number): void => {
    if (!send) return;
    if (paused) {
      send({ t: 'sim.control', action: 'resume' });
      setPaused(false);
    }
    send({ t: 'sim.control', action: 'setSpeed', multiplier });
    setSpeed(multiplier);
  };

  return (
    <div className="border-border bg-surface flex items-center gap-2 rounded-lg border px-3 py-2">
      <button
        type="button"
        onClick={playBeat}
        disabled={!connected}
        className="bg-accent text-accent-contrast focus-visible:ring-accent inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        title="Focus a vehicle approaching a geofence and speed the demo so the crossing fires"
      >
        <Radar className="size-3.5" aria-hidden="true" />
        Play geofence beat
      </button>

      <span className="bg-border h-5 w-px" aria-hidden="true" />

      <button
        type="button"
        onClick={togglePause}
        disabled={!connected}
        aria-pressed={paused}
        aria-label={paused ? 'Resume the simulation' : 'Pause the simulation'}
        className="border-border bg-surface-2 text-fg-muted hover:text-foreground hover:border-border-strong focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        {paused ? (
          <Play className="size-3.5" aria-hidden="true" />
        ) : (
          <Pause className="size-3.5" aria-hidden="true" />
        )}
      </button>

      <div
        className="border-border bg-surface-2 text-fg-subtle hidden items-center gap-0.5 rounded-md border px-1 py-0.5 sm:flex"
        role="group"
        aria-label="Demo speed"
      >
        <Gauge className="text-fg-subtle ml-1 size-3" aria-hidden="true" />
        {[1, 2, 4, 8].map((mult) => (
          <button
            key={mult}
            type="button"
            onClick={() => {
              changeSpeed(mult);
            }}
            disabled={!connected}
            aria-pressed={!paused && speed === mult}
            className={cn(
              'focus-visible:ring-accent rounded px-1.5 py-0.5 font-mono text-2xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
              !paused && speed === mult
                ? 'bg-accent text-accent-contrast'
                : 'text-fg-muted hover:text-foreground',
            )}
          >
            {mult}x
          </button>
        ))}
      </div>
    </div>
  );
}
