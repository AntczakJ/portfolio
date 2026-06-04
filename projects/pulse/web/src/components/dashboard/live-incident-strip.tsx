'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangleIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { MonitorRow } from '@/lib/api/monitors';
import { cn } from '@/lib/cn';
import { useLiveBoard, type LiveIncident } from '@/lib/store/live-store';
import { formatDuration, incidentDurationMs } from '@/lib/time/duration';
import { statusToken } from '@/lib/status/status-tokens';

interface LiveIncidentStripProps {
  monitors: readonly MonitorRow[] | undefined;
  now: number;
}

/**
 * Task 5.3 / 5.5 — the live open-incident strip at the top of the board.
 *
 * When an incident opens (the SSE `incident.open` event), a row materialises
 * here at the top of the board (the dramatic beat of the wow moment), counts
 * its duration upward, and settles out on recovery (`incident.close`). It reads
 * directly off the live store's incident overlay, so it needs no fetch — the
 * SSE event IS the trigger. `AnimatePresence` animates the enter / exit
 * (reduced-motion safe).
 *
 * It surfaces only OPEN incidents (the resolved history lives in the incidents
 * view). The monitor name comes from the board's REST list; until the list
 * carries an id we just opened, a short id placeholder is shown.
 */
export function LiveIncidentStrip({
  monitors,
  now,
}: LiveIncidentStripProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const incidents = useLiveBoard((s) => s.incidents);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of monitors ?? []) map.set(m.id, m.name);
    return map;
  }, [monitors]);

  // Only surface incidents for monitors currently on the board. A live-overlay
  // incident whose monitor is not in the REST list (e.g. an `incident.open`
  // replayed from the SSE ring buffer for a since-deleted monitor) must NOT
  // render here — the strip is a board affordance and follows the board's
  // monitors. Once the monitor list has loaded, we filter by it; before it
  // loads we show nothing (the board itself is still resolving).
  const open = useMemo(() => {
    if (!monitors) return [];
    const known = new Set(monitors.map((m) => m.id));
    return Object.values(incidents)
      .filter((i) => i.status === 'open' && known.has(i.monitorId))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }, [incidents, monitors]);

  return (
    <AnimatePresence initial={false}>
      {open.length > 0 ? (
        <motion.div
          key="incident-strip"
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-2 rounded-lg border border-status-down/45 bg-status-down-surface/60 p-3 sm:p-4">
            <div className="flex items-center gap-2 px-1">
              <AlertTriangleIcon
                className="size-4 text-status-down-text"
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold text-status-down-text">
                {open.length === 1
                  ? '1 active incident'
                  : `${String(open.length)} active incidents`}
              </h2>
            </div>
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {open.map((incident) => (
                  <ActiveIncidentRow
                    key={incident.incidentId}
                    incident={incident}
                    name={
                      nameById.get(incident.monitorId) ??
                      `Monitor ${incident.monitorId.slice(0, 8)}`
                    }
                    now={now}
                    reduceMotion={reduceMotion ?? false}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ActiveIncidentRow({
  incident,
  name,
  now,
  reduceMotion,
}: {
  incident: LiveIncident;
  name: string;
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
    <motion.li
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-3 rounded-md bg-card/70 px-3 py-2"
    >
      <span className="relative inline-flex size-2.5 shrink-0">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/dashboard/monitors/${incident.monitorId}`}
          className="truncate text-sm font-medium text-foreground underline-offset-2 hover:text-brand hover:underline focus-visible:text-brand focus-visible:underline focus-visible:outline-none"
        >
          {name}
        </Link>
        {incident.cause ? (
          <span className="truncate text-xs text-fg-subtle">
            {incident.cause}
          </span>
        ) : null}
      </div>

      <span
        className={cn(
          'shrink-0 font-mono text-sm tabular-nums',
          token.text,
        )}
        data-numeric
        title="Ongoing"
      >
        {formatDuration(duration)}
      </span>

      <Button
        asChild
        variant="ghost"
        size="xs"
        className="shrink-0 text-status-down-text hover:bg-status-down/15"
      >
        <Link href="/dashboard/incidents">View</Link>
      </Button>
    </motion.li>
  );
}
