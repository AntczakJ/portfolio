'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useLiveBoard, type LiveIncident } from '@/lib/store/live-store';
import { formatDuration, incidentDurationMs } from '@/lib/time/duration';
import { statusToken } from '@/lib/status/status-tokens';
import { useNow } from '@/lib/time/use-now';

/**
 * The detail-page active-incident banner (Task 5.5). When this monitor has an
 * open incident (the live store overlay), a banner appears under the header
 * naming the severity, the cause, and the duration ticking upward. It clears
 * (animated out) on recovery. Reads the live store directly — no fetch needed,
 * the SSE event drives it.
 */
export function ActiveIncidentBanner({
  monitorId,
}: {
  monitorId: string;
}): ReactNode {
  const now = useNow();
  const reduceMotion = useReducedMotion();
  const incidents = useLiveBoard((s) => s.incidents);

  const open = useMemo<LiveIncident | null>(() => {
    const matches = Object.values(incidents).filter(
      (i) => i.monitorId === monitorId && i.status === 'open',
    );
    matches.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return matches[0] ?? null;
  }, [incidents, monitorId]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key={open.incidentId}
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <Banner incident={open} now={now} reduceMotion={reduceMotion ?? false} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Banner({
  incident,
  now,
  reduceMotion,
}: {
  incident: LiveIncident;
  now: number;
  reduceMotion: boolean;
}): ReactNode {
  const token = statusToken(incident.severity);
  const duration = incidentDurationMs(
    incident.startedAt,
    incident.resolvedAt,
    incident.durationMs,
    now,
  );

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-status-down/45 bg-status-down-surface/60 px-4 py-3"
    >
      <span className="flex items-center gap-2.5">
        <span className="relative inline-flex size-2.5">
          {!reduceMotion ? (
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
        <span className="text-sm font-semibold text-status-down-text">
          Active incident
        </span>
      </span>

      <span className="text-sm text-fg-muted">
        {incident.cause ?? 'Outage detected'}
      </span>

      <span className="ml-auto flex items-center gap-1.5 text-sm">
        <span className="text-xs text-fg-subtle">Ongoing</span>
        <span
          className={cn('font-mono tabular-nums', token.text)}
          data-numeric
        >
          {formatDuration(duration)}
        </span>
      </span>
    </div>
  );
}
