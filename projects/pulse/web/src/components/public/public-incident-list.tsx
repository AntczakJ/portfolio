import { CheckCircle2Icon } from 'lucide-react';
import { type ReactNode } from 'react';

import { StatusDot } from '@/components/dashboard/status-dot';
import { cn } from '@/lib/cn';
import { formatDuration, incidentDurationMs } from '@/lib/time/duration';
import { formatRelativeTime } from '@/lib/time/relative-time';
import type { PublicIncident } from 'pulse-server';

/**
 * The recent-incident timeline for the public status page (Task 6.6).
 *
 * Shows the page's recent public incidents (newest first), each with its
 * severity (degraded vs outage — never color-alone, via the StatusDot), the
 * affected service, an Open/Resolved pill, a relative "started" stamp, and the
 * duration (a resolved incident's fixed span, or an open one's elapsed time as
 * of `now`). The `cause` snapshot is safe public text (e.g. "down after 3
 * consecutive down checks").
 *
 * When there are no recent incidents the section reads calmly as a positive
 * signal ("No incidents in the recent window") rather than an empty void —
 * the Statuspage register.
 */
export function PublicIncidentList({
  incidents,
  now,
}: {
  incidents: readonly PublicIncident[];
  now: number;
}): ReactNode {
  return (
    <section aria-label="Recent incidents" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-fg-muted">Recent incidents</h2>

      {incidents.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-5 text-sm text-fg-muted">
          <CheckCircle2Icon
            className="size-4 shrink-0 text-status-up-text"
            aria-hidden="true"
          />
          No incidents in the recent window.
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <IncidentRow incident={incident} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentRow({
  incident,
  now,
}: {
  incident: PublicIncident;
  now: number;
}): ReactNode {
  const isOpen = incident.status === 'open';
  // severity is `degraded | down`; map to the StatusDot vocabulary.
  const dotStatus = incident.severity === 'down' ? 'down' : 'degraded';
  const duration = incidentDurationMs(
    incident.startedAt,
    incident.resolvedAt,
    incident.durationMs,
    now,
  );
  const startedMs = Date.parse(incident.startedAt);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusDot status={dotStatus} />
        <span className="text-sm font-medium text-foreground">
          {incident.monitorName}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            isOpen
              ? 'bg-status-down-surface text-status-down-text'
              : 'bg-status-up-surface text-status-up-text',
          )}
        >
          {isOpen ? 'Investigating' : 'Resolved'}
        </span>
        {/*
          An OPEN incident's duration ticks up from `now - startedAt`, so it
          diverges between the SSR `now` and the hydrating client `now`. A
          CLOSED incident's duration is the fixed server-computed span (matches).
          suppressHydrationWarning is harmless for the closed case and silences
          the expected open-case divergence — keeping the public page clean.
        */}
        <span
          className="ml-auto font-mono text-xs tabular-nums text-fg-subtle"
          suppressHydrationWarning
        >
          {formatDuration(duration)}
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        {incident.cause}
        {' · '}
        {/* Relative "started Ns ago" — same time-dependent divergence as the
            footer; exempt this node only (see public-status-view.tsx). */}
        <span className="tabular-nums" suppressHydrationWarning>
          {Number.isNaN(startedMs)
            ? 'recently'
            : formatRelativeTime(startedMs, now)}
        </span>
      </p>
    </div>
  );
}
