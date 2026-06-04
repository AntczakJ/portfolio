'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangleIcon, RadioIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { BoardSummary, type StatusCounts } from './board-summary';
import { ConnectionIndicator } from './connection-indicator';
import { CreateMonitorDialog } from './create-monitor-dialog';
import { DemoIncidentButton } from './demo-incident-button';
import { LiveIncidentStrip } from './live-incident-strip';
import { MonitorCard } from './monitor-card';
import { Button } from '@/components/ui/button';
import {
  listMonitors,
  monitorsQueryKey,
  type MonitorRow,
} from '@/lib/api/monitors';
import { useLiveBoardConnection } from '@/lib/sse/use-live-board';
import { useLiveBoard } from '@/lib/store/live-store';
import { statusToken, type DisplayStatus } from '@/lib/status/status-tokens';
import { pushToast } from '@/lib/store/toast-store';
import { useNow } from '@/lib/time/use-now';
import type {
  AlertFiredEvent,
  IncidentCloseEvent,
  IncidentOpenEvent,
} from 'pulse-server/events';

/**
 * The live status board (Task 3.4) — the wow-moment surface.
 *
 * Initial data: `GET /monitors` (TanStack Query). Live updates: the single
 * `EventSource` on `/api/stream` (the success criterion — one
 * text/event-stream connection, not a polling loop). The SSE client feeds
 * the Zustand live store; each card reads its own slice and re-renders on
 * its own results.
 *
 * The header carries the connection indicator (the liveness tell), the
 * summary bar (total + per-status tally, worst-status headline), and the
 * create-monitor CTA. The grid reflows single-column on mobile up to three
 * across on wide. Loading / error / empty states are all handled.
 *
 * Accessibility: a polite aria-live region announces status flips
 * ("Monitor status changed from up to down") without flooding — the store
 * coalesces to the latest announcement and we clear it after it is read.
 */
export function StatusBoard(): ReactNode {
  const now = useNow();

  const query = useQuery({
    queryKey: monitorsQueryKey,
    queryFn: listMonitors,
  });
  const monitors = query.data;

  // Keep the latest monitor list in a ref so the (stable) alert-toast callback
  // can resolve a monitor's name without re-opening the EventSource.
  const monitorsRef = useRef<MonitorRow[] | undefined>(monitors);
  monitorsRef.current = monitors;

  const nameFor = useCallback(
    (monitorId: string): string =>
      monitorsRef.current?.find((m) => m.id === monitorId)?.name ??
      'A monitor',
    [],
  );

  // C-1: the down/recovered toast fires from the SAME incident event that flips
  // the card, the summary and the strip — so the dramatic beat lands as one
  // coordinated transition, not on a later independent timer. The toast is
  // keyed `monitor-<id>` (supersede) so a monitor can never show as both down
  // AND recovered at once: a new "down" toast evicts that monitor's stale
  // "recovered", and the recovery toast evicts the "down".
  const onIncidentOpen = useCallback(
    (event: IncidentOpenEvent) => {
      const down = event.severity === 'down';
      pushToast({
        tone: down ? 'down' : 'info',
        title: down
          ? `${nameFor(event.monitorId)} is down`
          : `${nameFor(event.monitorId)} is degraded`,
        description: 'Incident opened — sending alerts.',
        supersedeKey: `monitor-${event.monitorId}`,
        // The demo-armed info toast must yield the instant the incident opens.
        dismissKeys: ['demo-armed'],
      });
    },
    [nameFor],
  );

  const onIncidentClose = useCallback(
    (event: IncidentCloseEvent) => {
      pushToast({
        tone: 'up',
        title: `${nameFor(event.monitorId)} is back up`,
        description: 'Incident resolved.',
        supersedeKey: `monitor-${event.monitorId}`,
      });
    },
    [nameFor],
  );

  // `alert.fired` AUGMENTS (does not stack on top of) the coordinated incident
  // toast: same supersede key, so it updates the monitor's single toast with
  // the delivery channel rather than pushing a second one.
  const onAlertFired = useCallback(
    (event: AlertFiredEvent) => {
      const name = nameFor(event.monitorId);
      const channel = event.channelType === 'webhook' ? 'webhook' : 'email';
      if (event.transition === 'open') {
        pushToast({
          tone: 'down',
          title: `${name} is down`,
          description: `Alert delivered to your ${channel} channel.`,
          supersedeKey: `monitor-${event.monitorId}`,
        });
      } else {
        pushToast({
          tone: 'up',
          title: `${name} is back up`,
          description: `Resolution sent to your ${channel} channel.`,
          supersedeKey: `monitor-${event.monitorId}`,
        });
      }
    },
    [nameFor],
  );

  const connection = useLiveBoardConnection({
    onAlertFired,
    onIncidentOpen,
    onIncidentClose,
  });

  // Reconcile the REST snapshot into the live store whenever it changes
  // (initial load + every reconnect refetch) — ADR-003 reconciliation.
  const hydrateFromRest = useLiveBoard((s) => s.hydrateFromRest);
  useEffect(() => {
    if (monitors) {
      hydrateFromRest(monitors);
    }
  }, [monitors, hydrateFromRest]);

  const liveMonitors = useLiveBoard((s) => s.monitors);
  const counts = useMemo<StatusCounts>(
    () => countStatuses(monitors ?? [], liveMonitors),
    [monitors, liveMonitors],
  );
  // Count open incidents only for monitors currently on the board (a stale
  // `hasOpenIncident` for a since-deleted monitor must not skew the summary).
  const openIncidentCount = useMemo(
    () =>
      (monitors ?? []).filter((m) => liveMonitors[m.id]?.hasOpenIncident).length,
    [monitors, liveMonitors],
  );

  return (
    <section aria-label="Status board" className="flex flex-col gap-5">
      <LiveAnnouncer />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex h-8 items-center">
            <ConnectionIndicator state={connection} />
          </div>
          <div className="flex items-start gap-2">
            <DemoIncidentButton />
            <div className="flex h-8 items-center">
              <CreateMonitorDialog />
            </div>
          </div>
        </div>
        {monitors && monitors.length > 0 ? (
          <BoardSummary counts={counts} openIncidents={openIncidentCount} />
        ) : null}
      </div>

      {/* Live open-incident strip — materialises at the top of the board the
          moment an incident opens (the dramatic beat), and clears on recovery. */}
      <LiveIncidentStrip monitors={monitors} now={now} />

      {query.isPending ? <BoardSkeleton /> : null}

      {query.isError ? (
        <BoardError onRetry={() => void query.refetch()} />
      ) : null}

      {query.isSuccess && monitors && monitors.length === 0 ? (
        <EmptyState />
      ) : null}

      {query.isSuccess && monitors && monitors.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {monitors.map((monitor) => (
            <li key={monitor.id}>
              <MonitorCard monitor={monitor} now={now} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The polite aria-live region; mirrors and then clears the store message. */
function LiveAnnouncer(): ReactNode {
  const announcement = useLiveBoard((s) => s.announcement);
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {announcement}
    </div>
  );
}

function countStatuses(
  monitors: readonly MonitorRow[],
  live: Readonly<
    Record<
      string,
      {
        status: DisplayStatus;
        lastCheckedAt: number | null;
        incidentSeverity: 'down' | 'degraded' | null;
      }
    >
  >,
): StatusCounts {
  const counts: StatusCounts = {
    total: monitors.length,
    up: 0,
    degraded: 0,
    down: 0,
    unknown: 0,
  };
  for (const m of monitors) {
    const liveState = live[m.id];
    // An open incident pins the status (C-1 fan-out): the summary bar tallies
    // the same severity the card shows, atomically. Otherwise the freshest
    // live status, otherwise the REST snapshot.
    const status: DisplayStatus =
      liveState?.incidentSeverity ??
      (liveState?.lastCheckedAt != null ? liveState.status : restStatus(m));
    counts[status] += 1;
  }
  return counts;
}

function restStatus(m: MonitorRow): DisplayStatus {
  return m.currentStatus === 'up' ||
    m.currentStatus === 'degraded' ||
    m.currentStatus === 'down'
    ? m.currentStatus
    : 'unknown';
}

function BoardSkeleton(): ReactNode {
  return (
    <ul
      aria-label="Loading monitors"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="h-[164px] animate-pulse rounded-lg border border-border bg-surface"
        />
      ))}
    </ul>
  );
}

function BoardError({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-status-down/40 bg-status-down-surface px-6 py-12 text-center">
      <AlertTriangleIcon className="size-6 text-status-down-text" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          Could not reach the API
        </p>
        <p className="text-sm text-fg-subtle">
          The monitor list failed to load. The board reconnects automatically
          when the API is back.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState(): ReactNode {
  const token = statusToken('up');
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-surface">
        <RadioIcon className={`size-5 ${token.text}`} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold text-foreground">
          No monitors yet
        </p>
        <p className="text-sm text-fg-subtle">
          Add an endpoint and Pulse starts probing it on its interval. The
          card appears here and goes live as real results stream in.
        </p>
      </div>
      <CreateMonitorDialog />
    </div>
  );
}
