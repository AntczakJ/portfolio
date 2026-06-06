'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { PanelShell } from '@/components/panels/panel-shell';
import { StatusBadge } from '@/components/panels/status-badge';
import { cn } from '@/lib/cn';
import { formatEta, formatEtaLong, formatSpeed, progressPercent } from '@/lib/fleet/format';
import { statusDescriptor } from '@/lib/fleet/status-descriptor';
import { useFocusVehicle } from '@/lib/fleet/use-focus-vehicle';
import { useOpsStore } from '@/lib/store/ops-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';

/**
 * Fleet panel (Task 5.1) — the FIRST-CLASS fleet list AND the accessible non-map
 * alternative + the no-WebGL fallback.
 *
 * It is a genuine, sortable, keyboard-operable table (not a stub): every vehicle
 * with status (label + icon + colour, never colour-alone), current zone, speed,
 * % route complete, and live ETA. It reads the SAME live data as the map from the
 * SAME single socket — but via the 1 Hz React telemetry store, NOT the rAF loop
 * (the hard gate). 1 Hz re-renders are fine for a table.
 *
 * Keyboard / SR: a `role="grid"` of `role="row"`s; each row is a `<button>` so
 * Tab moves between vehicles and Enter/Space focuses one (selects + flies the
 * camera). Column headers are sort buttons. The grid carries an accessible name;
 * status is announced via the badge's label, not colour. This is the path a
 * screen-reader or keyboard-only user takes, and the view the no-WebGL fallback
 * shows (Phase 6 toggles to it; the data + socket are identical).
 */

type SortKey = 'label' | 'status' | 'speed' | 'progress' | 'eta';
type SortDir = 'asc' | 'desc';

interface FleetRow {
  id: string;
  label: string;
  status: ReturnType<typeof statusDescriptor>['status'];
  zoneName: string | null;
  speedMps: number;
  progress: number;
  etaSeconds: number | null;
  routeName: string;
}

function compareRows(a: FleetRow, b: FleetRow, key: SortKey): number {
  switch (key) {
    case 'label':
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    case 'status':
      return statusDescriptor(a.status).label.localeCompare(statusDescriptor(b.status).label);
    case 'speed':
      return a.speedMps - b.speedMps;
    case 'progress':
      return a.progress - b.progress;
    case 'eta':
      // Nulls (no ETA) sort last regardless of direction intent at the asc end.
      return (a.etaSeconds ?? Infinity) - (b.etaSeconds ?? Infinity);
  }
}

export function FleetPanel(): ReactNode {
  const hydrated = useTelemetryStore((s) => s.hydrated);
  const vehicleIds = useTelemetryStore((s) => s.vehicleIds);
  const vehicles = useTelemetryStore((s) => s.vehicles);
  const telemetry = useTelemetryStore((s) => s.telemetry);
  const routes = useTelemetryStore((s) => s.routes);
  const zones = useTelemetryStore((s) => s.zones);
  const selectedId = useOpsStore((s) => s.selectedVehicleId);
  const focusVehicle = useFocusVehicle();

  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const rows = useMemo<FleetRow[]>(() => {
    const built: FleetRow[] = [];
    for (const id of vehicleIds) {
      const def = vehicles[id];
      if (!def) continue;
      const t = telemetry[id];
      const route = routes[def.routeId];
      const zone = t?.currentZoneId ? zones[t.currentZoneId] : undefined;
      built.push({
        id,
        label: def.label,
        status: t?.status ?? 'idle',
        zoneName: zone?.name ?? null,
        speedMps: t?.speedMps ?? 0,
        progress: t?.progress ?? 0,
        etaSeconds: t?.etaSeconds ?? null,
        routeName: route?.name ?? def.routeId,
      });
    }
    built.sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return built;
  }, [vehicleIds, vehicles, telemetry, routes, zones, sortKey, sortDir]);

  const onSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const meta = hydrated ? `${String(rows.length)} units` : 'connecting';

  return (
    <PanelShell title="Fleet" meta={meta} className="h-full">
      {!hydrated ? (
        <p className="text-fg-subtle text-sm" role="status">
          Connecting to the live telemetry stream…
        </p>
      ) : (
        <div role="grid" aria-label="Fleet roster — the keyboard and screen-reader view of the live fleet" className="flex flex-col gap-1">
          {/* Column headers — sortable. role=row/columnheader for the grid. */}
          <div
            role="row"
            className="text-fg-subtle text-2xs grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 pb-1 font-mono tracking-wide uppercase"
          >
            <SortHeader label="Unit" col="label" active={sortKey} dir={sortDir} onSort={onSort} />
            <div className="flex items-center gap-2">
              <SortHeader label="ETA" col="eta" active={sortKey} dir={sortDir} onSort={onSort} align="end" />
            </div>
          </div>

          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <FleetRowItem
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onFocus={focusVehicle}
              />
            ))}
          </ul>

          {/* Sort affordances for the secondary columns, below the list so the
              header stays compact. */}
          <div role="row" className="mt-1 flex flex-wrap items-center gap-1.5 px-2 pt-1.5">
            <span className="text-fg-subtle text-2xs mr-1 uppercase tracking-wide">Sort</span>
            <SortChip label="Status" col="status" active={sortKey} dir={sortDir} onSort={onSort} />
            <SortChip label="Speed" col="speed" active={sortKey} dir={sortDir} onSort={onSort} />
            <SortChip label="Progress" col="progress" active={sortKey} dir={sortDir} onSort={onSort} />
          </div>
        </div>
      )}
    </PanelShell>
  );
}

function FleetRowItem({
  row,
  selected,
  onFocus,
}: {
  row: FleetRow;
  selected: boolean;
  onFocus: (id: string) => void;
}): ReactNode {
  const pct = progressPercent(row.progress);
  return (
    <li role="row">
      <button
        type="button"
        onClick={() => {
          onFocus(row.id);
        }}
        aria-pressed={selected}
        aria-label={`${row.label}, ${statusDescriptor(row.status).label}, ${
          row.zoneName ? `in ${row.zoneName}, ` : ''
        }${formatSpeed(row.speedMps)}, ${String(pct)} percent complete, ETA ${formatEtaLong(
          row.etaSeconds,
        )}`}
        className={cn(
          'group focus-visible:ring-accent w-full rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
          selected
            ? 'border-accent/60 bg-surface-3'
            : 'border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground truncate text-sm font-medium">{row.label}</span>
          <span className="text-accent-ink font-mono text-xs tabular-nums" aria-hidden="true">
            {formatEta(row.etaSeconds)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <StatusBadge status={row.status} size="sm" />
          <span className="text-fg-muted font-mono text-2xs tabular-nums" aria-hidden="true">
            {formatSpeed(row.speedMps)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {/* Progress bar — taller + cleaner so the distribution reads at a glance
              (P2-3); the text percentage carries the value too (not bar-alone). */}
          <span
            className="bg-surface ring-border relative h-1.5 flex-1 overflow-hidden rounded-full ring-1 ring-inset"
            aria-hidden="true"
          >
            <span
              className="bg-accent absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${String(pct)}%` }}
            />
          </span>
          <span className="text-fg-muted font-mono text-2xs tabular-nums" aria-hidden="true">
            {String(pct)}%
          </span>
        </div>
        <p className="text-fg-muted mt-1 truncate text-2xs" aria-hidden="true">
          {row.routeName}
          {row.zoneName ? ` · ${row.zoneName}` : ''}
        </p>
      </button>
    </li>
  );
}

function SortHeader({
  label,
  col,
  active,
  dir,
  onSort,
  align = 'start',
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'start' | 'end';
}): ReactNode {
  const isActive = active === col;
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => {
        onSort(col);
      }}
      className={cn(
        'focus-visible:ring-accent inline-flex items-center gap-1 rounded uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none',
        align === 'end' ? 'justify-end' : '',
        isActive ? 'text-accent-ink' : 'hover:text-fg-muted',
      )}
    >
      {label}
      {isActive ? (
        dir === 'asc' ? (
          <ArrowUp className="size-3" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3" aria-hidden="true" />
        )
      ) : null}
    </button>
  );
}

function SortChip({
  label,
  col,
  active,
  dir,
  onSort,
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}): ReactNode {
  const isActive = active === col;
  return (
    <button
      type="button"
      onClick={() => {
        onSort(col);
      }}
      aria-pressed={isActive}
      className={cn(
        'focus-visible:ring-accent inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
        isActive
          ? 'border-accent/60 text-accent-ink bg-surface-3'
          : 'border-border text-fg-subtle hover:border-border-strong hover:text-fg-muted',
      )}
    >
      {label}
      {isActive ? (
        dir === 'asc' ? (
          <ArrowUp className="size-2.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-2.5" aria-hidden="true" />
        )
      ) : null}
    </button>
  );
}
