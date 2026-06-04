'use client';

import type { ReactNode } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { MonitorWindow, UptimeResponse } from 'pulse-server';

interface UptimeCardProps {
  window: MonitorWindow;
  uptime: UptimeResponse | undefined;
  loading: boolean;
  /** Highlight this card as the one matching the active window. */
  active?: boolean;
}

const WINDOW_LABEL: Record<MonitorWindow, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/**
 * An uptime card — the % for one window with a breakdown bar (up / degraded /
 * down / unknown) behind it. The headline % uses the mono / tabular-nums idiom
 * so it reads as a precise metric.
 *
 * The breakdown bar is a stacked, token-colored proportion of the observed
 * seconds; a tooltip and an accessible table summarise the split (never
 * color-only — the tooltip carries the durations as text). `unknown` time is
 * shown as a hatched/neutral remainder so a partial window reads honestly.
 */
export function UptimeCard({
  window,
  uptime,
  loading,
  active,
}: UptimeCardProps): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors',
        active ? 'border-brand/50 ring-1 ring-brand/20' : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-fg-subtle">
          {WINDOW_LABEL[window]}
        </span>
        {uptime?.source ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle/70">
            {uptime.source}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-1">
        <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
          {loading || !uptime
            ? '—'
            : uptime.uptimePercent == null
              ? 'n/a'
              : formatPercent(uptime.uptimePercent)}
        </span>
        {!loading && uptime?.uptimePercent != null ? (
          <span className="text-sm text-fg-subtle">%</span>
        ) : null}
      </div>

      {uptime ? (
        <BreakdownBar uptime={uptime} />
      ) : (
        <div className="h-1.5 w-full animate-pulse rounded-full bg-surface" />
      )}
    </div>
  );
}

function formatPercent(p: number): string {
  // Three significant decimals for high-uptime numbers (99.987), one for low.
  return p >= 99 ? p.toFixed(3) : p.toFixed(2);
}

function BreakdownBar({ uptime }: { uptime: UptimeResponse }): ReactNode {
  const { upSeconds, degradedSeconds, downSeconds, unknownSeconds } =
    uptime.breakdown;
  const total = upSeconds + degradedSeconds + downSeconds + unknownSeconds;

  if (total <= 0) {
    return (
      <p className="text-xs text-fg-subtle">No data observed in this window.</p>
    );
  }

  const segments = [
    { key: 'up', label: 'Operational', seconds: upSeconds, fill: 'bg-status-up' },
    {
      key: 'degraded',
      label: 'Degraded',
      seconds: degradedSeconds,
      fill: 'bg-status-degraded',
    },
    { key: 'down', label: 'Down', seconds: downSeconds, fill: 'bg-status-down' },
    {
      key: 'unknown',
      label: 'No data',
      seconds: unknownSeconds,
      fill: 'bg-status-unknown',
    },
  ].filter((s) => s.seconds > 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface"
          // The accessible summary lives in the tooltip content + the sr-only
          // list below; the bar itself is a graphical reinforcement.
          role="img"
          aria-label={ariaSummary(segments, total)}
        >
          {segments.map((s) => (
            <span
              key={s.key}
              className={cn('h-full', s.fill)}
              style={{ width: `${String((s.seconds / total) * 100)}%` }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="flex flex-col gap-0.5">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <span>{s.label}</span>
              <span className="font-mono tabular-nums">
                {formatDuration(s.seconds)}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function ariaSummary(
  segments: readonly { label: string; seconds: number }[],
  total: number,
): string {
  return segments
    .map(
      (s) =>
        `${s.label} ${String(Math.round((s.seconds / total) * 100))} percent (${formatDuration(s.seconds)})`,
    )
    .join(', ');
}

/** Compact duration: 45s, 12m, 3.2h, 5.1d. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${String(Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
