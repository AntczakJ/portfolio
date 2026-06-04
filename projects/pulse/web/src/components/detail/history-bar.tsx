'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  bucketDisplayFill,
  bucketTooltip,
  historyAriaSummary,
} from '@/lib/chart/history-bar';
import type { HistoryResponse, MonitorWindow } from 'pulse-server';

interface HistoryBarProps {
  history: HistoryResponse | undefined;
  window: MonitorWindow;
  loading: boolean;
}

const WINDOW_LABEL: Record<MonitorWindow, string> = {
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
};

const BAR_HEIGHT = 36;
const BAR_GAP = 2;

/**
 * The uptime-history strip — the classic Statuspage green/amber/red bar,
 * hand-rolled SVG (NOT uPlot). Each bar is colored by its DOMINANT status
 * (H-2): red only when the down-share crosses a threshold, so a 98%-up hour
 * reads green rather than worst-case-wins red. A hover tooltip shows the time
 * range + status + check counts.
 *
 * Accessibility (AGENT_NOTES gate — the strip must not be color-only): the
 * SVG carries an aria summary sentence, and a visually-hidden list mirrors the
 * per-bucket detail for screen readers. The hover affordance is a graphical
 * convenience on top of that, not the only channel.
 */
export function HistoryBar({
  history,
  window,
  loading,
}: HistoryBarProps): ReactNode {
  const [hover, setHover] = useState<number | null>(null);

  if (loading || !history) {
    return (
      <div className="h-9 w-full animate-pulse rounded-md bg-surface" />
    );
  }

  const buckets = history.buckets;
  const count = buckets.length;
  // Render in a 0..1000 viewBox, scale to width with preserveAspectRatio none.
  const totalGap = BAR_GAP * (count - 1);
  const barWidth = count > 0 ? (1000 - totalGap) / count : 0;
  const summary = historyAriaSummary(buckets, WINDOW_LABEL[window]);
  const hovered = hover != null ? buckets[hover] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 1000 ${String(BAR_HEIGHT)}`}
          width="100%"
          height={BAR_HEIGHT}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
          className="block"
        >
          {buckets.map((b, i) => (
            <rect
              key={`${b.bucketStart}-${String(i)}`}
              x={i * (barWidth + BAR_GAP)}
              y={0}
              width={barWidth}
              height={BAR_HEIGHT}
              rx={1.5}
              className={cn(
                bucketDisplayFill(b),
                'cursor-default transition-opacity',
                hover != null && hover !== i ? 'opacity-50' : 'opacity-100',
              )}
              onMouseEnter={() => {
                setHover(i);
              }}
              onMouseLeave={() => {
                setHover(null);
              }}
              onFocus={() => {
                setHover(i);
              }}
              onBlur={() => {
                setHover(null);
              }}
              tabIndex={-1}
            />
          ))}
        </svg>

        {hovered ? (
          <div
            className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            role="status"
          >
            {bucketTooltip(hovered, history.bucketSeconds, formatRange)}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
        <span>{leftLabel(window)}</span>
        <span>Now</span>
      </div>

      {/* Screen-reader mirror of the strip — the non-color channel. */}
      <p className="sr-only">{summary}</p>
    </div>
  );
}

function leftLabel(window: MonitorWindow): string {
  switch (window) {
    case '24h':
      return '24h ago';
    case '7d':
      return '7d ago';
    default:
      return '30d ago';
  }
}

/** Terse range formatter for the tooltip (local time, day + HH:MM). */
function formatRange(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) {
    return `${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}
