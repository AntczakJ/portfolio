'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { StatusBadge } from '@/components/panels/status-badge';
import { cn } from '@/lib/cn';
import {
  formatEta,
  formatEtaLong,
  formatSpeed,
  progressPercent,
} from '@/lib/fleet/format';
import { statusDescriptor } from '@/lib/fleet/status-descriptor';
import { useFocusVehicle } from '@/lib/fleet/use-focus-vehicle';
import type { VehicleStatus } from '@/lib/fleet/types';
import { useOpsStore } from '@/lib/store/ops-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';
import { useHeadlessTelemetry } from '@/lib/ws/use-headless-telemetry';

/**
 * FleetTableView (Task 6.1 / 6.2) — the full-width fleet table that replaces the
 * map when WebGL is unavailable OR the user chooses the table view.
 *
 * It is a genuine semantic `<table>` (a true data grid, not a list of buttons):
 * native `<th scope="col">` headers carrying `aria-sort`, `<tr>` rows, and a
 * focusable, selectable row that pins the detail panel (and flies the camera if a
 * map exists). The SAME live data as the map, from the SAME single socket — fed
 * here by the headless telemetry hook when this is the active surface (so there is
 * never a second concurrent socket; the map's own hook does not run while this
 * does).
 *
 * Wider than the left-rail FleetPanel: it surfaces route, current zone, speed,
 * progress and ETA as their own columns because it has the room — this is the
 * primary surface in the no-WebGL world, so it earns the density.
 */

type SortKey = 'label' | 'status' | 'route' | 'zone' | 'speed' | 'progress' | 'eta';
type SortDir = 'asc' | 'desc';

interface TableRow {
  id: string;
  label: string;
  status: VehicleStatus;
  routeName: string;
  zoneName: string | null;
  speedMps: number;
  progress: number;
  etaSeconds: number | null;
}

function compareRows(a: TableRow, b: TableRow, key: SortKey): number {
  switch (key) {
    case 'label':
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    case 'status':
      return statusDescriptor(a.status).label.localeCompare(statusDescriptor(b.status).label);
    case 'route':
      return a.routeName.localeCompare(b.routeName);
    case 'zone':
      return (a.zoneName ?? '￿').localeCompare(b.zoneName ?? '￿');
    case 'speed':
      return a.speedMps - b.speedMps;
    case 'progress':
      return a.progress - b.progress;
    case 'eta':
      return (a.etaSeconds ?? Infinity) - (b.etaSeconds ?? Infinity);
  }
}

export function FleetTableView({ mapUnavailable }: { mapUnavailable: boolean }): ReactNode {
  // The headless socket runs ONLY while this surface is mounted (the map's hook
  // is unmounted because the map is not rendered) — one socket, never two.
  useHeadlessTelemetry(true);

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

  const rows = useMemo<TableRow[]>(() => {
    const built: TableRow[] = [];
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
        routeName: route?.name ?? def.routeId,
        zoneName: zone?.name ?? null,
        speedMps: t?.speedMps ?? 0,
        progress: t?.progress ?? 0,
        etaSeconds: t?.etaSeconds ?? null,
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

  return (
    <div className="border-border bg-surface flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-foreground text-xs font-semibold tracking-wider uppercase">
          Fleet roster
        </h2>
        <span className="text-fg-subtle font-mono text-2xs tracking-wide">
          {hydrated ? `${String(rows.length)} units · live` : 'connecting'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!hydrated ? (
          <p className="text-fg-subtle p-4 text-sm" role="status">
            Connecting to the live telemetry stream…
          </p>
        ) : (
          <table
            role="grid"
            aria-label={`Live fleet roster${
              mapUnavailable ? ' — the keyboard and screen-reader alternative to the map' : ''
            }`}
            className="w-full border-collapse text-sm"
          >
            <caption className="sr-only">
              Live fleet roster
              {mapUnavailable ? ' — the keyboard and screen-reader alternative to the map' : ''}.
              Select a row to pin a vehicle&apos;s detail. Column headers sort the table.
            </caption>
            <thead className="bg-surface-2 sticky top-0 z-10">
              <tr className="text-fg-subtle text-2xs uppercase">
                <SortableTh label="Unit" col="label" sortKey={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Status" col="status" sortKey={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Route" col="route" sortKey={sortKey} dir={sortDir} onSort={onSort} className="hidden md:table-cell" />
                <SortableTh label="Zone" col="zone" sortKey={sortKey} dir={sortDir} onSort={onSort} className="hidden lg:table-cell" />
                <SortableTh label="Speed" col="speed" sortKey={sortKey} dir={sortDir} onSort={onSort} align="end" />
                <SortableTh label="Progress" col="progress" sortKey={sortKey} dir={sortDir} onSort={onSort} align="end" className="hidden sm:table-cell" />
                <SortableTh label="ETA" col="eta" sortKey={sortKey} dir={sortDir} onSort={onSort} align="end" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <TableRowItem
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  onFocus={focusVehicle}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TableRowItem({
  row,
  selected,
  onFocus,
}: {
  row: TableRow;
  selected: boolean;
  onFocus: (id: string) => void;
}): ReactNode {
  const pct = progressPercent(row.progress);
  return (
    <tr
      aria-selected={selected}
      tabIndex={0}
      onClick={() => {
        onFocus(row.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus(row.id);
        }
      }}
      aria-label={`${row.label}, ${statusDescriptor(row.status).label}, ${row.routeName}, ${
        row.zoneName ? `in ${row.zoneName}, ` : 'not in a zone, '
      }${formatSpeed(row.speedMps)}, ${String(pct)} percent complete, ETA ${formatEtaLong(
        row.etaSeconds,
      )}`}
      className={cn(
        'border-border focus-visible:ring-accent cursor-pointer border-b transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        selected ? 'bg-surface-3' : 'hover:bg-surface-2',
      )}
    >
      <td className="text-foreground px-3 py-2 font-medium">{row.label}</td>
      <td className="px-3 py-2">
        <StatusBadge status={row.status} size="sm" />
      </td>
      <td className="text-fg-muted hidden px-3 py-2 md:table-cell">{row.routeName}</td>
      <td className="text-fg-muted hidden px-3 py-2 lg:table-cell">{row.zoneName ?? '—'}</td>
      <td className="text-fg-muted px-3 py-2 text-right font-mono text-xs tabular-nums">
        {formatSpeed(row.speedMps)}
      </td>
      <td className="hidden px-3 py-2 text-right sm:table-cell">
        <span className="text-fg-muted font-mono text-xs tabular-nums">{String(pct)}%</span>
      </td>
      <td className="text-accent-ink px-3 py-2 text-right font-mono text-xs tabular-nums">
        {formatEta(row.etaSeconds)}
      </td>
    </tr>
  );
}

function SortableTh({
  label,
  col,
  sortKey,
  dir,
  onSort,
  align = 'start',
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'start' | 'end';
  className?: string;
}): ReactNode {
  const isActive = sortKey === col;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-2 font-mono font-medium tracking-wide', className)}
    >
      <button
        type="button"
        onClick={() => {
          onSort(col);
        }}
        className={cn(
          'focus-visible:ring-accent inline-flex items-center gap-1 rounded uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none',
          align === 'end' ? 'w-full justify-end' : '',
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
    </th>
  );
}
