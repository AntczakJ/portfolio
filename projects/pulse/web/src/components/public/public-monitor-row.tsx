import { type ReactNode } from 'react';

import { StatusDot } from '@/components/dashboard/status-dot';
import {
  formatUptime,
  monitorDisplayStatus,
} from '@/lib/public-status/public-status-view';
import type { PublicMonitor } from 'pulse-server';

/**
 * One public monitor row (Task 6.6) — name + status dot/label + 30d uptime %.
 *
 * Deliberately minimal: the redacted public payload carries no response time or
 * target host, so the row shows exactly what the owner chose to expose. Status
 * is never color-alone — the `StatusDot` carries its label. The uptime % is
 * mono/tabular-nums so it does not jitter on a live refresh.
 *
 * Pure presentational (no `'use client'`): it renders from props the parent
 * (the live view) feeds it, so it works under SSR and re-renders cheaply on a
 * live refetch.
 */
export function PublicMonitorRow({
  monitor,
}: {
  monitor: PublicMonitor;
}): ReactNode {
  const status = monitorDisplayStatus(monitor);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <StatusDot status={status} withLabel />
        <span className="truncate text-sm font-medium text-foreground">
          {monitor.name}
        </span>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-fg-muted">
        {formatUptime(monitor.uptimePercent)}
      </span>
    </div>
  );
}
