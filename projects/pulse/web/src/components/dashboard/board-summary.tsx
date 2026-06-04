'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { statusToken, type DisplayStatus } from '@/lib/status/status-tokens';

export interface StatusCounts {
  total: number;
  up: number;
  degraded: number;
  down: number;
  unknown: number;
}

interface BoardSummaryProps {
  counts: StatusCounts;
  /** Count of monitors with a live OPEN incident (from the SSE store). An open
   * incident drives the "Outage detected" headline even if the live status has
   * not yet flipped, so the summary reflects the incident the moment it opens. */
  openIncidents?: number;
  className?: string;
}

/**
 * The board summary bar — the at-a-glance health header (Vercel
 * project-overview register: dense data, no busyness). Shows the total
 * monitor count and a per-status tally; each tally pairs the status dot
 * with its AA label so the breakdown is never color-alone.
 *
 * The "all systems operational" / "outage" headline reads from the worst
 * status present, so a recruiter gets the one-line verdict before scanning
 * the grid.
 */
export function BoardSummary({
  counts,
  openIncidents = 0,
  className,
}: BoardSummaryProps): ReactNode {
  const headline = deriveHeadline(counts, openIncidents);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border px-4 py-3 sm:px-5',
        // M-5 — an outage/degraded summary carries WEIGHT: a tinted surface +
        // a left accent rule (the ActiveIncidentBanner register), so a problem
        // reads heavier than "operational" instead of the same flat card.
        headline.surface,
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn('inline-block size-2.5 rounded-full', headline.dot)}
          aria-hidden="true"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">
            {headline.title}
          </span>
          <span className="text-xs text-fg-subtle">
            {openIncidents > 0 ? (
              <span className="font-medium text-status-down-text">
                {openIncidents} open{' '}
                {openIncidents === 1 ? 'incident' : 'incidents'}
                <span aria-hidden="true"> · </span>
              </span>
            ) : null}
            {counts.total} {counts.total === 1 ? 'monitor' : 'monitors'}{' '}
            tracked
          </span>
        </div>
      </div>

      <dl className="flex items-center gap-4 sm:gap-5">
        <Tally status="up" value={counts.up} />
        <Tally status="degraded" value={counts.degraded} />
        <Tally status="down" value={counts.down} />
        {counts.unknown > 0 ? (
          <Tally status="unknown" value={counts.unknown} />
        ) : null}
      </dl>
    </div>
  );
}

function Tally({
  status,
  value,
}: {
  status: DisplayStatus;
  value: number;
}): ReactNode {
  const token = statusToken(status);
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn('inline-block size-2 rounded-full', token.dot)}
        aria-hidden="true"
      />
      <dt className="sr-only">{token.label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-xs text-fg-subtle">{token.label}</span>
      </dd>
    </div>
  );
}

function deriveHeadline(
  counts: StatusCounts,
  openIncidents: number,
): {
  title: string;
  dot: string;
  /** The container surface — outage/degraded states carry weight (M-5). */
  surface: string;
} {
  const NEUTRAL = 'border-border bg-surface';
  if (counts.total === 0) {
    return { title: 'No monitors yet', dot: 'bg-status-unknown', surface: NEUTRAL };
  }
  if (counts.down > 0 || openIncidents > 0) {
    return {
      title: 'Outage detected',
      dot: 'bg-status-down',
      surface:
        'border-status-down/35 border-l-2 border-l-status-down bg-status-down-surface/60',
    };
  }
  if (counts.degraded > 0) {
    return {
      title: 'Degraded performance',
      dot: 'bg-status-degraded',
      surface:
        'border-status-degraded/35 border-l-2 border-l-status-degraded bg-status-degraded-surface/50',
    };
  }
  if (counts.up > 0 && counts.unknown === 0) {
    return {
      title: 'All systems operational',
      dot: 'bg-status-up',
      surface: NEUTRAL,
    };
  }
  return {
    title: 'Awaiting first checks',
    dot: 'bg-status-unknown',
    surface: NEUTRAL,
  };
}
