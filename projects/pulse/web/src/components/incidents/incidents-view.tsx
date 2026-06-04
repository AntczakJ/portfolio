'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ActivityIcon, AlertTriangleIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { IncidentRow, type IncidentRowData } from './incident-row';
import { Button } from '@/components/ui/button';
import {
  incidentKeys,
  listIncidents,
  type IncidentStatusFilter,
} from '@/lib/api/incidents';
import { cn } from '@/lib/cn';
import { useLiveBoardConnection } from '@/lib/sse/use-live-board';
import { useLiveBoard, type LiveIncident } from '@/lib/store/live-store';
import { incidentDurationMs } from '@/lib/time/duration';
import { useNow } from '@/lib/time/use-now';
import type { IncidentListItem } from 'pulse-server';

/**
 * Task 5.4 — the incidents view. A clean timeline of recent incidents from
 * `GET /incidents`, live-updating from the SSE store: a new open incident
 * prepends (and pulses), a close updates its row, and open incidents tick their
 * duration upward each second.
 *
 * Data model: the REST snapshot is the floor; the live store's `incidents`
 * overlay is merged ON TOP so a row that opened/closed live reflects instantly.
 * On mount AND on every SSE reconnect (the connection re-opens -> the board's
 * refetch fires; here we also refetch when the incident token bumps) we
 * reconcile against the REST read so the list is authoritative.
 *
 * Filters: all / open / resolved. The filter narrows both the REST query and
 * the merged client view. Each row links to the monitor detail.
 */
export function IncidentsView(): ReactNode {
  const now = useNow();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<IncidentStatusFilter>('all');
  const reduceMotion = useReducedMotion();

  // The page opens the same single EventSource the board uses (global store).
  useLiveBoardConnection();

  const query = useQuery({
    queryKey: incidentKeys.list(filter, 50),
    queryFn: () => listIncidents(filter, 50),
  });

  // Reconcile from REST whenever an incident opens/closes live, so the list
  // settles on the authoritative server rows (durations, ordering, cause).
  const incidentToken = useLiveBoard((s) => s.incidentToken);
  useEffect(() => {
    if (incidentToken === 0) return;
    void queryClient.invalidateQueries({ queryKey: incidentKeys.all });
  }, [incidentToken, queryClient]);

  const liveIncidents = useLiveBoard((s) => s.incidents);
  const restItems = query.data?.items;

  // Merge the REST snapshot with the live overlay, then apply the filter and
  // compute each row's live duration (open rows tick up).
  const rows = useMemo<IncidentRowData[]>(
    () => mergeIncidents(restItems, liveIncidents, filter, now),
    [restItems, liveIncidents, filter, now],
  );

  return (
    <section aria-label="Incidents" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs value={filter} onChange={setFilter} />
        <p className="text-xs text-fg-subtle">
          Live — new incidents appear here as they open
        </p>
      </div>

      {query.isPending ? <ListSkeleton /> : null}

      {query.isError ? (
        <ListError onRetry={() => void query.refetch()} />
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <EmptyState filter={filter} />
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.div
                key={row.id}
                layout={!reduceMotion}
                initial={
                  reduceMotion
                    ? false
                    : { opacity: 0, height: 0, y: -6 }
                }
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <IncidentRow incident={row} now={now} />
              </motion.div>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Merge REST incidents with the live overlay:
 *   - start from the REST items (authoritative shape: name, url, cause),
 *   - overlay any live status/resolution we have for the same incident id,
 *   - add live-only incidents the REST snapshot has not caught up to yet,
 *   - filter, then sort newest-first by startedAt,
 *   - resolve each row's live duration (open -> ticking, closed -> fixed).
 */
function mergeIncidents(
  restItems: readonly IncidentListItem[] | undefined,
  live: Readonly<Record<string, LiveIncident>>,
  filter: IncidentStatusFilter,
  now: number,
): IncidentRowData[] {
  const byId = new Map<string, IncidentRowData>();

  for (const item of restItems ?? []) {
    byId.set(item.id, {
      id: item.id,
      monitorId: item.monitorId,
      monitorName: item.monitorName,
      status: item.status,
      severity: item.severity,
      startedAt: item.startedAt,
      durationMs: incidentDurationMs(
        item.startedAt,
        item.resolvedAt,
        item.durationMs,
        now,
      ),
      cause: item.cause,
    });
  }

  for (const inc of Object.values(live)) {
    const existing = byId.get(inc.incidentId);
    if (existing) {
      // Overlay the live status/resolution onto the richer REST row.
      byId.set(inc.incidentId, {
        ...existing,
        status: inc.status,
        severity: inc.severity,
        durationMs: incidentDurationMs(
          inc.startedAt,
          inc.resolvedAt,
          inc.durationMs,
          now,
        ),
      });
    } else {
      // A live-only incident the REST snapshot has not returned yet. Only
      // surface it if it opened RECENTLY — this is the "a brand-new incident
      // just opened, before the reconcile refetch lands" case. A stale entry
      // (e.g. an old `incident.open` replayed from the SSE ring buffer for a
      // since-deleted monitor) is older than the window and is dropped; the
      // authoritative REST list is the source of truth for everything else.
      const startedMs = Date.parse(inc.startedAt);
      const isRecent =
        !Number.isNaN(startedMs) && now - startedMs <= LIVE_ONLY_MAX_AGE_MS;
      if (!isRecent) continue;
      byId.set(inc.incidentId, {
        id: inc.incidentId,
        monitorId: inc.monitorId,
        monitorName: shortMonitor(inc.monitorId),
        status: inc.status,
        severity: inc.severity,
        startedAt: inc.startedAt,
        durationMs: incidentDurationMs(
          inc.startedAt,
          inc.resolvedAt,
          inc.durationMs,
          now,
        ),
        cause: inc.cause ?? 'Outage detected',
      });
    }
  }

  return [...byId.values()]
    .filter((r) => filter === 'all' || r.status === filter)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** How recent a live-ONLY incident (one the REST list has not returned) must be
 * to surface — guards against stale SSE-ring-buffer replays of old incidents. */
const LIVE_ONLY_MAX_AGE_MS = 2 * 60 * 1000;

/** A monitor id may arrive live before the REST row carries its name; show a
 * short id placeholder until the reconcile refetch fills it in. */
function shortMonitor(id: string): string {
  return `Monitor ${id.slice(0, 8)}`;
}

const FILTERS: readonly { value: IncidentStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

function FilterTabs({
  value,
  onChange,
}: {
  value: IncidentStatusFilter;
  onChange: (next: IncidentStatusFilter) => void;
}): ReactNode {
  return (
    <div
      role="tablist"
      aria-label="Filter incidents"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <button
            key={f.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => {
              onChange(f.value);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-xs'
                : 'text-fg-muted hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse bg-surface" />
      ))}
    </div>
  );
}

function ListError({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-status-down/40 bg-status-down-surface px-6 py-12 text-center">
      <AlertTriangleIcon className="size-6 text-status-down-text" />
      <p className="text-sm font-medium text-foreground">
        Could not load incidents
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState({ filter }: { filter: IncidentStatusFilter }): ReactNode {
  const message =
    filter === 'open'
      ? 'No open incidents. Everything is healthy right now.'
      : filter === 'resolved'
        ? 'No resolved incidents yet.'
        : 'No incidents recorded. When a monitor crosses its failure threshold, the incident appears here and counts its duration live.';
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-status-up-surface">
        <ActivityIcon className="size-5 text-status-up-text" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold text-foreground">
          {filter === 'all' ? 'No incidents' : `No ${filter} incidents`}
        </p>
        <p className="text-sm text-fg-subtle">{message}</p>
      </div>
    </div>
  );
}
