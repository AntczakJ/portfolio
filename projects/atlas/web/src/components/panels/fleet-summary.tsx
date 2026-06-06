'use client';

import { Activity, Gauge, MapPinned, Radio } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { statusDescriptor } from '@/lib/fleet/status-descriptor';
import { formatSpeed } from '@/lib/fleet/format';
import { cn } from '@/lib/cn';
import { useTelemetryStore } from '@/lib/store/telemetry-store';
import type { VehicleStatus } from '@/lib/fleet/types';

/**
 * FleetSummary (P1-4 fix) — the designed empty state for the vehicle detail rail.
 *
 * Before a vehicle is selected the rail used to be a quarter-screen of placeholder
 * text (a dead zone the designer-critic flagged against Stripe/Vercel). This fills
 * it with a live fleet-summary instrument: a status breakdown (counts per status,
 * never colour-alone — each carries its label + dot), the count of vehicles
 * currently inside a geofence, and the fleet average speed. It reads the same 1 Hz
 * telemetry store as the rest of the panels (no extra socket, no rAF coupling) so
 * the space EARNS itself and keeps proving the world is live before any selection.
 */

const STATUS_ORDER: VehicleStatus[] = ['en_route', 'at_stop', 'returning', 'idle'];

export function FleetSummary(): ReactNode {
  const hydrated = useTelemetryStore((s) => s.hydrated);
  const vehicleIds = useTelemetryStore((s) => s.vehicleIds);
  const telemetry = useTelemetryStore((s) => s.telemetry);

  const summary = useMemo(() => {
    const counts: Record<VehicleStatus, number> = {
      en_route: 0,
      at_stop: 0,
      returning: 0,
      idle: 0,
    };
    let inZone = 0;
    let speedSum = 0;
    let moving = 0;
    for (const id of vehicleIds) {
      const t = telemetry[id];
      const status: VehicleStatus = t?.status ?? 'idle';
      counts[status] += 1;
      if (t?.currentZoneId) inZone += 1;
      if (t && t.speedMps > 0.2) {
        speedSum += t.speedMps;
        moving += 1;
      }
    }
    return {
      counts,
      inZone,
      total: vehicleIds.length,
      avgSpeed: moving > 0 ? speedSum / moving : 0,
    };
  }, [vehicleIds, telemetry]);

  if (!hydrated) {
    return (
      <p className="text-fg-muted text-sm leading-normal" role="status">
        Connecting to the live telemetry stream…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-foreground text-md flex items-center gap-2 font-semibold">
          <Activity className="text-accent-ink size-4 shrink-0" aria-hidden="true" />
          Fleet overview
        </h3>
        <p className="text-fg-muted mt-0.5 text-xs leading-normal">
          Select a vehicle on the map or in the fleet list to pin its route, stops,
          live ETA, speed and recent events.
        </p>
      </div>

      {/* Status breakdown — counts per status, never colour-alone. */}
      <div>
        <h4 className="text-fg-muted text-2xs mb-1.5 font-mono tracking-wide uppercase">
          By status
        </h4>
        <ul className="grid grid-cols-2 gap-1.5">
          {STATUS_ORDER.map((status) => {
            const d = statusDescriptor(status);
            const count = summary.counts[status];
            const Icon = d.icon;
            return (
              <li
                key={status}
                className={cn(
                  'border-border bg-surface-2 flex items-center gap-2 rounded-md border px-2.5 py-2',
                  count === 0 && 'opacity-55',
                )}
              >
                <span
                  className={cn('size-2 shrink-0 rounded-full', d.dotClass)}
                  aria-hidden="true"
                />
                <Icon className={cn('size-3.5 shrink-0', d.textClass)} aria-hidden="true" />
                <span className="text-fg-muted truncate text-xs">{d.label}</span>
                <span className="text-foreground ml-auto font-mono text-sm tabular-nums">
                  {String(count)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Live aggregate instruments. */}
      <dl className="grid grid-cols-2 gap-2">
        <SummaryStat
          icon={MapPinned}
          label="In a geofence"
          value={`${String(summary.inZone)} / ${String(summary.total)}`}
        />
        <SummaryStat icon={Gauge} label="Avg speed" value={formatSpeed(summary.avgSpeed)} />
      </dl>

      <p className="text-fg-subtle flex items-center gap-1.5 text-2xs" aria-hidden="true">
        <Radio className="text-accent-ink size-3 shrink-0" aria-hidden="true" />
        Live aggregates update every tick.
      </p>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="border-border bg-surface-2 rounded-md border px-2.5 py-2">
      <dt className="text-fg-muted text-2xs flex items-center gap-1 uppercase">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="text-foreground mt-0.5 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
