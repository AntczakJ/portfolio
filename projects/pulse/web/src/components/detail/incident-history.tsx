'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import { IncidentRow, type IncidentRowData } from '@/components/incidents/incident-row';
import {
  incidentKeys,
  listMonitorIncidents,
} from '@/lib/api/incidents';
import { useLiveBoard, type LiveIncident } from '@/lib/store/live-store';
import { incidentDurationMs } from '@/lib/time/duration';
import { useNow } from '@/lib/time/use-now';
import type { IncidentListItem } from 'pulse-server';

interface IncidentHistoryProps {
  monitorId: string;
  monitorName: string;
}

/**
 * The monitor-detail incident history (Task 5.5). Reads
 * `GET /monitors/:id/incidents` and merges the live SSE overlay so an incident
 * that opened/closed live for THIS monitor reflects instantly. Open durations
 * tick up; a fresh open prepends. The monitor name is already in the header, so
 * the rows do not re-link it.
 */
export function IncidentHistory({
  monitorId,
  monitorName,
}: IncidentHistoryProps): ReactNode {
  const now = useNow();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: incidentKeys.forMonitor(monitorId, 20),
    queryFn: () => listMonitorIncidents(monitorId, 20),
  });

  // Reconcile from REST whenever an incident opens/closes live.
  const incidentToken = useLiveBoard((s) => s.incidentToken);
  useEffect(() => {
    if (incidentToken === 0) return;
    void queryClient.invalidateQueries({
      queryKey: incidentKeys.forMonitor(monitorId, 20),
    });
  }, [incidentToken, monitorId, queryClient]);

  const liveIncidents = useLiveBoard((s) => s.incidents);
  const restItems = query.data?.items;

  const rows = useMemo<IncidentRowData[]>(
    () =>
      mergeMonitorIncidents(
        restItems,
        liveIncidents,
        monitorId,
        monitorName,
        now,
      ),
    [restItems, liveIncidents, monitorId, monitorName, now],
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-px">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded bg-surface" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-fg-subtle">
        No incidents for this monitor. When it crosses its failure threshold,
        the incident appears here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
      {rows.map((row) => (
        <IncidentRow
          key={row.id}
          incident={row}
          now={now}
          linkMonitor={false}
        />
      ))}
    </ul>
  );
}

function mergeMonitorIncidents(
  restItems: readonly IncidentListItem[] | undefined,
  live: Readonly<Record<string, LiveIncident>>,
  monitorId: string,
  monitorName: string,
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
    if (inc.monitorId !== monitorId) continue;
    const existing = byId.get(inc.incidentId);
    if (existing) {
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
      byId.set(inc.incidentId, {
        id: inc.incidentId,
        monitorId: inc.monitorId,
        monitorName,
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

  return [...byId.values()].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}
