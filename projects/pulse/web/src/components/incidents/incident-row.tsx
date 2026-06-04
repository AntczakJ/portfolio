'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/time/duration';
import { formatRelativeTime } from '@/lib/time/relative-time';
import { statusToken } from '@/lib/status/status-tokens';

/**
 * One incident row — shared by the dashboard incidents view and the
 * detail-page incident history. A row reads at a glance: severity dot + label
 * (never color-alone), the monitor (a link to its detail), the status
 * (open / resolved), when it started, how long it ran (mono / tabular-nums),
 * and the cause snapshot.
 *
 * `severity` maps to the status tokens: `down` -> the down (red) token,
 * `degraded` -> the degraded (amber) token. An OPEN incident pulses its dot
 * (Motion, reduced-motion safe) so the eye catches that it is still live.
 *
 * `durationMs` is pre-resolved by the caller (the open-incident view ticks it
 * up off `now`); `linkMonitor` is false on the detail page where the monitor is
 * already known.
 */

export interface IncidentRowData {
  readonly id: string;
  readonly monitorId: string;
  readonly monitorName: string;
  readonly status: 'open' | 'resolved';
  readonly severity: 'degraded' | 'down';
  readonly startedAt: string;
  readonly durationMs: number | null;
  readonly cause: string;
}

interface IncidentRowProps {
  incident: IncidentRowData;
  /** The shared 1-second clock, for the relative "started" + ticking duration. */
  now: number;
  /** Link the monitor name to its detail (false on the detail page itself). */
  linkMonitor?: boolean;
}

export function IncidentRow({
  incident,
  now,
  linkMonitor = true,
}: IncidentRowProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const open = incident.status === 'open';
  const token = statusToken(incident.severity);

  const monitorEl = linkMonitor ? (
    <Link
      href={`/dashboard/monitors/${incident.monitorId}`}
      className="truncate font-medium text-foreground underline-offset-2 hover:text-brand hover:underline focus-visible:text-brand focus-visible:underline focus-visible:outline-none"
    >
      {incident.monitorName}
    </Link>
  ) : (
    <span className="truncate font-medium text-foreground">
      {incident.monitorName}
    </span>
  );

  const severityDot = (
    <span className="relative inline-flex size-2.5 shrink-0">
      {open && !reduceMotion ? (
        <motion.span
          aria-hidden="true"
          className={cn('absolute inset-0 rounded-full', token.dot)}
          animate={{ opacity: [0.45, 0, 0.45], scale: [1, 2, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      <span
        role="img"
        aria-label={incident.severity === 'down' ? 'Down' : 'Degraded'}
        className={cn('relative inline-block size-2.5 rounded-full', token.dot)}
      />
    </span>
  );

  const statusPill = (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
        open
          ? cn(token.surface, token.text, token.border)
          : 'border-border bg-surface text-fg-muted',
      )}
    >
      {open ? 'Open' : 'Resolved'}
    </span>
  );

  const startedAt = (
    <time
      dateTime={incident.startedAt}
      className="text-xs text-fg-subtle"
      title="Started"
    >
      {formatRelativeTime(Date.parse(incident.startedAt), now)}
    </time>
  );

  const duration = (
    <span
      className={cn(
        'font-mono text-sm tabular-nums',
        open ? token.text : 'text-fg-muted',
      )}
      data-numeric
      title={open ? 'Ongoing' : 'Total duration'}
    >
      {formatDuration(incident.durationMs)}
    </span>
  );

  return (
    <li
      className={cn(
        // H-3 — a dedicated MOBILE STACK (flex), not a leaked desktop grid.
        // Line 1: dot + title (+ cause). Line 2: badge · started · duration.
        // The desktop 5-column grid only engages at `sm`, so 390px never wraps.
        'flex flex-col gap-2 px-4 py-3',
        'sm:grid sm:grid-cols-[auto_minmax(0,1.4fr)_auto_auto_auto] sm:items-center sm:gap-x-4 sm:gap-y-0',
        open && 'bg-status-down-surface/40',
      )}
      data-incident-status={incident.status}
    >
      {/* Line 1 (mobile) — dot inline with the title; cause beneath. On `sm`
          the dot becomes the grid's first cell and the title the second. */}
      <span className="flex min-w-0 items-start gap-2.5 sm:contents">
        <span className="mt-1 sm:mt-0">{severityDot}</span>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {monitorEl}
          </div>
          <span className="truncate text-xs text-fg-subtle">
            {incident.cause}
          </span>
        </div>
      </span>

      {/* Line 2 (mobile) — badge + started + duration, tidy on one row,
          indented past the dot. On `sm` these flow into the grid columns. */}
      <div className="flex items-center gap-3 pl-[1.25rem] sm:contents sm:pl-0">
        <span className="sm:justify-self-center">{statusPill}</span>
        <span className="sm:justify-self-end">{startedAt}</span>
        <span className="ml-auto sm:ml-0 sm:justify-self-end">{duration}</span>
      </div>
    </li>
  );
}
