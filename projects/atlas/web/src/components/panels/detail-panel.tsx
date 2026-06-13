'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Gauge, MapPin, Route as RouteIcon, Timer, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { FleetSummary } from '@/components/panels/fleet-summary';
import { PanelShell } from '@/components/panels/panel-shell';
import { StatusBadge } from '@/components/panels/status-badge';
import { cn } from '@/lib/cn';
import { eventCopy } from '@/lib/fleet/event-copy';
import {
  formatEta,
  formatRelativeTime,
  formatSpeed,
  progressPercent,
} from '@/lib/fleet/format';
import { selectVehicleEvents, useEventsStore } from '@/lib/store/events-store';
import { useOpsStore } from '@/lib/store/ops-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';

/**
 * Vehicle detail panel (Task 5.2) — Motion slide-in via AnimatePresence.
 *
 * Pinned when a vehicle is selected (a fleet row click or a marker click).
 * Shows the route name, ordered stops, the live ETA ticking down, speed, and the
 * recent events for that vehicle — all from the 1 Hz telemetry + events stores
 * (NOT the rAF loop). Motion is allowed HERE: this is React-state UI chrome, not
 * the map surface. The slide-in collapses under `prefers-reduced-motion` (it
 * appears with no transform).
 */
export function DetailPanel(): ReactNode {
  const selectedId = useOpsStore((s) => s.selectedVehicleId);
  const select = useOpsStore((s) => s.selectVehicle);
  const reduce = useReducedMotion();

  return (
    <PanelShell
      title={selectedId ? 'Vehicle' : 'Overview'}
      meta={
        selectedId ? (
          <button
            type="button"
            onClick={() => {
              select(null);
            }}
            className="text-fg-subtle hover:text-fg-muted focus-visible:ring-accent inline-flex items-center gap-1 rounded uppercase focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Clear vehicle selection"
          >
            <X className="size-3" aria-hidden="true" />
            Clear
          </button>
        ) : null
      }
      className="h-full"
    >
      <AnimatePresence mode="wait" initial={false}>
        {selectedId ? (
          <motion.div
            key={selectedId}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            <DetailBody vehicleId={selectedId} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* P1-4: the empty rail earns its space with a live fleet-summary
                instrument rather than a quarter-screen of placeholder text. */}
            <FleetSummary />
          </motion.div>
        )}
      </AnimatePresence>
    </PanelShell>
  );
}

function DetailBody({ vehicleId }: { vehicleId: string }): ReactNode {
  const def = useTelemetryStore((s) => s.vehicles[vehicleId]);
  const t = useTelemetryStore((s) => s.telemetry[vehicleId]);
  const route = useTelemetryStore((s) => (def ? s.routes[def.routeId] : undefined));
  const zones = useTelemetryStore((s) => s.zones);
  const events = useEventsStore((s) => s.events);
  // The relative-time reference clock. Reading `Date.now()` during render is an
  // impurity (react-hooks/purity): the value is unstable across renders the rule
  // cannot reason about. We instead snapshot the clock in state and advance it on
  // a 1 s interval, so the "Xm ago" labels stay accurate while render stays pure.
  // Hoisted above the early return to honour the rules-of-hooks ordering.
  const nowMs = useNowMs();

  if (!def) {
    return <p className="text-fg-subtle text-sm">This vehicle is no longer in the fleet.</p>;
  }

  const status = t?.status ?? 'idle';
  const zoneName = t?.currentZoneId ? (zones[t.currentZoneId]?.name ?? null) : null;
  const pct = progressPercent(t?.progress ?? 0);
  const recent = selectVehicleEvents(events, vehicleId, 5);

  return (
    <div className="flex flex-col gap-4">
      {/* Header: label + status + route name. */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-foreground text-md font-semibold">{def.label}</h3>
          <StatusBadge status={status} />
        </div>
        <p className="text-fg-muted mt-0.5 flex items-center gap-1.5 text-xs">
          <RouteIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {route?.name ?? def.routeId}
          {zoneName ? <span className="text-fg-subtle">· in {zoneName}</span> : null}
        </p>
      </div>

      {/* Live metrics: ETA, speed, progress. Tabular numerals (instrument). */}
      <dl className="grid grid-cols-3 gap-2">
        <Metric icon={Timer} label="ETA next stop" value={formatEta(t?.etaSeconds ?? null)} live />
        <Metric icon={Gauge} label="Speed" value={formatSpeed(t?.speedMps ?? 0)} />
        <Metric icon={MapPin} label="Complete" value={`${String(pct)}%`} />
      </dl>

      {/* Ordered stops. */}
      {route && route.stops.length > 0 ? (
        <div>
          <h4 className="text-fg-subtle text-2xs mb-1.5 font-mono tracking-wide uppercase">
            Stops
          </h4>
          <ol className="flex flex-col gap-1">
            {route.stops.map((stop, i) => {
              const isNext = t?.nextStopId === stop.id;
              return (
                <li
                  key={stop.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                    isNext ? 'border-accent/50 bg-surface-3' : 'border-border bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-2xs',
                      isNext ? 'bg-accent text-accent-contrast' : 'bg-surface text-fg-subtle',
                    )}
                    aria-hidden="true"
                  >
                    {String(i + 1)}
                  </span>
                  <span className="text-foreground truncate">{stop.name}</span>
                  {isNext ? (
                    <span className="text-accent-ink ml-auto text-2xs uppercase">Next</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {/* Recent events for this vehicle. */}
      <div>
        <h4 className="text-fg-subtle text-2xs mb-1.5 font-mono tracking-wide uppercase">
          Recent events
        </h4>
        {recent.length === 0 ? (
          <p className="text-fg-subtle text-2xs">No events yet for this vehicle.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recent.map((event) => {
              const copy = eventCopy(event, def.label);
              const Icon = copy.icon;
              return (
                <li key={event.id} className="flex items-center gap-2 text-xs">
                  <Icon className={cn('size-3.5 shrink-0', copy.accentClass)} aria-hidden="true" />
                  <span className="text-fg-muted truncate">{copy.text}</span>
                  <span className="text-fg-subtle ml-auto font-mono text-2xs tabular-nums">
                    {formatRelativeTime(event.at, nowMs)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A render-pure "now" clock: snapshots `Date.now()` into state and re-snapshots
 * once per second. Keeps the relative-time labels accurate without reading the
 * impure `Date.now()` during render (react-hooks/purity). The lazy initializer
 * seeds the first value; the interval advances it. SSR renders a stable seed and
 * the post-hydration interval takes over.
 */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return nowMs;
}

function Metric({
  icon: Icon,
  label,
  value,
  live = false,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  live?: boolean;
}): ReactNode {
  return (
    <div className="border-border bg-surface-2 rounded-md border px-2 py-1.5">
      <dt className="text-fg-subtle text-2xs flex items-center gap-1 uppercase">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cn('mt-0.5 font-mono text-sm tabular-nums', live ? 'text-accent-ink' : 'text-foreground')}
        aria-live={live ? 'off' : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
