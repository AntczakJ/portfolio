'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DetailHeader } from './detail-header';
import { HistoryBar } from './history-bar';
import { IncidentHistory } from './incident-history';
import { RecentChecks } from './recent-checks';
import {
  ResponseTimeChart,
  type ChartHandle,
} from './response-time-chart';
import { UptimeCard } from './uptime-card';
import { WindowSelector } from './window-selector';
import { Button } from '@/components/ui/button';
import {
  getHistory,
  getMonitor,
  getRecentChecks,
  getSeries,
  getUptime,
  monitorDetailKeys,
} from '@/lib/api/monitor-detail';
import { MonitorApiError } from '@/lib/api/monitors';
import { useLiveBoardConnection } from '@/lib/sse/use-live-board';
import { useLiveBoard } from '@/lib/store/live-store';
import type {
  MonitorWindow,
  RecentCheck,
  UptimeResponse,
} from 'pulse-server';

interface MonitorDetailViewProps {
  monitorId: string;
}

const ALL_WINDOWS: readonly MonitorWindow[] = ['24h', '7d', '30d'];

/**
 * The monitor-detail view — the premium clean-SaaS detail surface (Task
 * 4.1 / 4.2).
 *
 * Data: TanStack Query keyed by `id` + `window` for uptime / series / history;
 * the monitor row and recent-checks are window-independent. The window selector
 * drives the three windowed queries off one toggle.
 *
 * LIVE: the page opens the same single `EventSource` the board uses (the SSE
 * store is global Zustand, so the header status flips on `status.change` and
 * the latest response time renders without any extra wiring). On the 24h window
 * the detail page ALSO live-appends each fresh `check.result` to the uPlot chart
 * (imperatively, off the React render path) and prepends it to the recent-checks
 * list — the wow moment continues here.
 */
export function MonitorDetailView({
  monitorId,
}: MonitorDetailViewProps): ReactNode {
  const [window, setWindow] = useState<MonitorWindow>('24h');

  // One EventSource for the page (the global store is shared with the board).
  useLiveBoardConnection();

  const monitorQuery = useQuery({
    queryKey: monitorDetailKeys.monitor(monitorId),
    queryFn: () => getMonitor(monitorId),
    retry: (count, error) =>
      error instanceof MonitorApiError && error.status === 404 ? false : count < 1,
  });

  const seriesQuery = useQuery({
    queryKey: monitorDetailKeys.series(monitorId, window),
    queryFn: () => getSeries(monitorId, window),
    enabled: monitorQuery.isSuccess,
  });

  const historyQuery = useQuery({
    queryKey: monitorDetailKeys.history(monitorId, window),
    queryFn: () => getHistory(monitorId, window),
    enabled: monitorQuery.isSuccess,
  });

  const checksQuery = useQuery({
    queryKey: monitorDetailKeys.checks(monitorId, 50),
    queryFn: () => getRecentChecks(monitorId, 50),
    enabled: monitorQuery.isSuccess,
  });

  // Prefetch all three windows' uptime so the three cards always show a number
  // regardless of the selected window (the cards summarise every window at once).
  const uptime24 = useUptimeFor(monitorId, '24h', monitorQuery.isSuccess);
  const uptime7 = useUptimeFor(monitorId, '7d', monitorQuery.isSuccess);
  const uptime30 = useUptimeFor(monitorId, '30d', monitorQuery.isSuccess);
  const uptimeByWindow: Record<MonitorWindow, UptimeResponse | undefined> = {
    '24h': uptime24.data,
    '7d': uptime7.data,
    '30d': uptime30.data,
  };
  const uptimeLoading: Record<MonitorWindow, boolean> = {
    '24h': uptime24.isPending && monitorQuery.isSuccess,
    '7d': uptime7.isPending && monitorQuery.isSuccess,
    '30d': uptime30.isPending && monitorQuery.isSuccess,
  };

  // --- LIVE 24h append: chart handle + recent-checks prepend ---------------
  const chartHandleRef = useRef<ChartHandle | null>(null);
  const live = useLiveBoard((s) => s.monitors[monitorId]);
  const pulseToken = useLiveBoard((s) => s.pulseToken[monitorId] ?? 0);
  const lastAppliedToken = useRef(0);
  const [liveChecks, setLiveChecks] = useState<RecentCheck[]>([]);

  // The latest pulse token kept in a ref so the checks-refetch effect can
  // re-sync the baseline to it WITHOUT depending on `pulseToken` (which would
  // wrongly clear the live rows on every fresh result).
  const pulseTokenRef = useRef(pulseToken);
  pulseTokenRef.current = pulseToken;

  // Reset the live-prepended rows when the window or the underlying checks
  // refetch (the windowed fetch becomes authoritative again). We intentionally
  // re-sync the token baseline on a fresh checks fetch so a result already in
  // the fetched list is not double-counted as "live".
  const checksData = checksQuery.data?.checks;
  useEffect(() => {
    setLiveChecks([]);
    lastAppliedToken.current = pulseTokenRef.current;
  }, [checksData]);

  useEffect(() => {
    if (pulseToken === lastAppliedToken.current) return;
    lastAppliedToken.current = pulseToken;
    if (live?.lastCheckedAt == null) return;

    // Append to the 24h chart imperatively (no React re-render of uPlot).
    if (window === '24h') {
      chartHandleRef.current?.appendLive({
        tSec: Math.floor(live.lastCheckedAt / 1000),
        value: live.lastResponseTimeMs,
      });
    }

    // Prepend a synthetic recent-check row so the activity list moves live.
    const row: RecentCheck = {
      id: `live-${String(live.lastCheckedAt)}`,
      checkedAt: new Date(live.lastCheckedAt).toISOString(),
      status: live.status === 'unknown' ? 'up' : live.status,
      statusCode: live.lastStatusCode,
      responseTimeMs: live.lastResponseTimeMs,
      error: null,
    };
    setLiveChecks((prev) => [row, ...prev].slice(0, 50));
  }, [pulseToken, live, window]);

  // Merge the live-prepended rows above the fetched ones (de-dup by timestamp).
  const mergedChecks = useMemo<RecentCheck[] | undefined>(() => {
    if (!checksData) return undefined;
    const seen = new Set(checksData.map((c) => c.checkedAt));
    const fresh = liveChecks.filter((c) => !seen.has(c.checkedAt));
    return [...fresh, ...checksData].slice(0, 50);
  }, [checksData, liveChecks]);

  if (monitorQuery.isError) {
    const notFound =
      monitorQuery.error instanceof MonitorApiError &&
      monitorQuery.error.status === 404;
    return <DetailError notFound={notFound} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Monitors
      </Link>

      {monitorQuery.data ? (
        <DetailHeader monitor={monitorQuery.data} />
      ) : (
        <div className="h-16 animate-pulse rounded-lg bg-surface" />
      )}

      {/* Uptime cards — one per window, always populated. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ALL_WINDOWS.map((w) => (
          <UptimeCard
            key={w}
            window={w}
            uptime={uptimeByWindow[w]}
            loading={uptimeLoading[w]}
            active={w === window}
          />
        ))}
      </div>

      {/* Response-time chart with the window selector. */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-foreground">
              Response time
            </h2>
            <p className="text-xs text-fg-subtle">
              {window === '24h'
                ? 'Live — each probe appends in real time'
                : 'Hourly average and p95'}
            </p>
          </div>
          <WindowSelector value={window} onChange={setWindow} />
        </div>

        {seriesQuery.isPending ? (
          <div className="h-[240px] w-full animate-pulse rounded-md bg-surface" />
        ) : seriesQuery.data ? (
          <>
            <ResponseTimeChart
              series={seriesQuery.data}
              onReady={(handle) => {
                chartHandleRef.current = handle;
              }}
            />
            <ChartLegend resolution={seriesQuery.data.resolution} />
          </>
        ) : (
          <p className="py-12 text-center text-sm text-fg-subtle">
            No response-time data for this window yet.
          </p>
        )}
      </section>

      {/* Uptime history strip. */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">
          Uptime history
        </h2>
        <HistoryBar
          history={historyQuery.data}
          window={window}
          loading={historyQuery.isPending}
        />
      </section>

      {/* Incident history for this monitor. */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">Incidents</h2>
        {monitorQuery.data ? (
          <IncidentHistory
            monitorId={monitorId}
            monitorName={monitorQuery.data.name}
          />
        ) : (
          <div className="h-14 animate-pulse rounded bg-surface" />
        )}
      </section>

      {/* Recent checks. */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">Recent checks</h2>
        <RecentChecks checks={mergedChecks} loading={checksQuery.isPending} />
      </section>
    </div>
  );
}

/** A small query hook for one window's uptime (the three summary cards). */
function useUptimeFor(
  monitorId: string,
  window: MonitorWindow,
  enabled: boolean,
) {
  return useQuery({
    queryKey: monitorDetailKeys.uptime(monitorId, window),
    queryFn: () => getUptime(monitorId, window),
    enabled,
  });
}

function ChartLegend({
  resolution,
}: {
  resolution: 'raw' | 'hourly';
}): ReactNode {
  if (resolution === 'raw') {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <span className="inline-block h-0.5 w-4 rounded-full bg-brand" />
        Response time (ms)
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 text-xs text-fg-subtle">
      <span className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-4 rounded-full bg-brand" />
        Average
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-4 rounded-full bg-fg-muted [background-image:repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_6px)]" />
        p95
      </span>
    </div>
  );
}

function DetailError({ notFound }: { notFound: boolean }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-foreground">
          {notFound ? 'Monitor not found' : 'Could not load this monitor'}
        </p>
        <p className="max-w-sm text-sm text-fg-subtle">
          {notFound
            ? 'It may have been deleted, or the link is wrong.'
            : 'The API could not be reached. Try again in a moment.'}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard">Back to monitors</Link>
      </Button>
    </div>
  );
}
