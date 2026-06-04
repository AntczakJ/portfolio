'use client';

import { useMutation } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2Icon, ZapIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  getDemoStatus,
  triggerDemoIncident,
} from '@/lib/api/demo';
import { MonitorApiError } from '@/lib/api/monitors';
import { cn } from '@/lib/cn';
import { pushToast } from '@/lib/store/toast-store';

/**
 * Task 5.7 — the "Trigger demo incident" button. THE wow beat on demand.
 *
 * A recruiter will not wait for an organic failure, so this button arms the
 * owned `/demo/flaky` endpoint (POST /demo/trigger). The incident then opens
 * and closes ORGANICALLY through the real probe cycle — the board reacts via
 * the SSE events it already consumes (the card flips down + gets the incident
 * ring, the summary bar shows the outage, the incidents view gets the open row,
 * the alert toast fires), then ~15 s later it recovers and closes.
 *
 * The ~30-45 s arc must read as DELIBERATE THEATRE, not lag. So while it runs
 * the button enters a guided running state that narrates the arc:
 *   - "Arming..."          (the POST is in flight)
 *   - "Watching for failures" with the fail-window countdown (the endpoint is
 *      armed; the worker is probing; the incident is about to open)
 *   - "Recovering" once the flag clears (the next probe will close the incident)
 * A subtle pulsing dot + progress hint communicate the expected timing so the
 * delay reads as designed.
 *
 * It polls `GET /demo/status` every second while running to track the arc, and
 * self-resets a few seconds after recovery so it can be fired again. The button
 * is disabled mid-arc (re-arming is safe but a single clean run reads best).
 *
 * Reduced-motion: the pulsing dot collapses to a static dot; the copy + the
 * countdown still communicate the arc.
 *
 * When the demo routes are disabled (`DEMO_TRIGGER_ENABLED=false` -> 404) the
 * button hides itself so a production deploy without the demo shows nothing
 * broken.
 */

type Phase = 'idle' | 'arming' | 'armed' | 'recovering' | 'done' | 'unavailable';

/** Total expected arc seconds shown as the timing hint (open ~30s, close ~45s). */
const ARC_HINT_SECONDS = 45;

export function DemoIncidentButton({
  className,
}: {
  className?: string;
}): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle');
  const [failWindow, setFailWindow] = useState<number | null>(null);
  const [recoversIn, setRecoversIn] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopPolling();
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [stopPolling],
  );

  const mutation = useMutation({
    mutationFn: triggerDemoIncident,
    onMutate: () => {
      setPhase('arming');
    },
    onSuccess: (res) => {
      setFailWindow(res.failWindowSeconds);
      setRecoversIn(res.failWindowSeconds);
      setPhase('armed');
      pushToast({
        tone: 'info',
        title: 'Demo incident armed',
        description: `The demo monitor will fail, open an incident, and recover in about ${String(ARC_HINT_SECONDS)}s. Watch the board.`,
        dedupeKey: 'demo-armed',
        duration: 7_000,
      });
      // Poll the demo status to drive the countdown + detect recovery.
      stopPolling();
      pollRef.current = setInterval(() => {
        void getDemoStatus()
          .then((status) => {
            if (status.failing) {
              setRecoversIn(status.recoversInSeconds);
              setPhase('armed');
            } else {
              setRecoversIn(0);
              setPhase('recovering');
              stopPolling();
              // Give the recovery probe + close a few seconds, then reset.
              resetRef.current = setTimeout(() => {
                setPhase('done');
                resetRef.current = setTimeout(() => {
                  setPhase('idle');
                }, 4_000);
              }, 12_000);
            }
          })
          .catch(() => {
            // Transient status error — keep the current phase; the SSE board
            // is the source of truth for the visible arc anyway.
          });
      }, 1_000);
    },
    onError: (error) => {
      stopPolling();
      // 404 means the demo trigger is disabled in this environment — hide.
      if (error instanceof MonitorApiError && error.status === 404) {
        setPhase('unavailable');
        return;
      }
      setPhase('idle');
      pushToast({
        tone: 'down',
        title: 'Could not start the demo',
        description: 'The demo trigger is unavailable right now.',
        dedupeKey: 'demo-error',
      });
    },
  });

  if (phase === 'unavailable') {
    return null;
  }

  const running = phase === 'arming' || phase === 'armed' || phase === 'recovering';

  return (
    <div className={cn('flex flex-col items-stretch gap-1.5', className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={running || mutation.isPending}
        onClick={() => {
          mutation.mutate();
        }}
        className={cn(
          'relative overflow-hidden border-status-down/40 text-status-down-text',
          'hover:border-status-down/60 hover:bg-status-down-surface',
          running && 'bg-status-down-surface',
        )}
        aria-live="polite"
      >
        {/* The arc progress sweep — a subtle fill that tracks the fail window,
            so the running button reads as a deliberate timed sequence. */}
        {running && failWindow ? (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 bg-status-down/12"
            initial={{ width: '0%' }}
            animate={{ width: phase === 'recovering' ? '100%' : '92%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: failWindow, ease: 'linear' }
            }
          />
        ) : null}

        <span className="relative flex items-center gap-2">
          {phase === 'arming' ? (
            <Loader2Icon className="animate-spin" />
          ) : running ? (
            <PulseDot reduceMotion={reduceMotion ?? false} />
          ) : (
            <ZapIcon />
          )}
          <span>{buttonLabel(phase, recoversIn)}</span>
        </span>
      </Button>

      {/* The timing narration line — tells the viewer this is intentional. */}
      <p
        className={cn(
          'px-0.5 text-center text-[11px] leading-tight transition-colors',
          running ? 'text-status-down-text' : 'text-fg-subtle',
        )}
      >
        {hintLine(phase, recoversIn)}
      </p>
    </div>
  );
}

function buttonLabel(phase: Phase, recoversIn: number | null): string {
  switch (phase) {
    case 'arming':
      return 'Arming demo';
    case 'armed':
      return recoversIn != null && recoversIn > 0
        ? `Incident in progress · ${String(recoversIn)}s`
        : 'Incident in progress';
    case 'recovering':
      return 'Recovering';
    case 'done':
      return 'Demo complete';
    default:
      return 'Trigger demo incident';
  }
}

function hintLine(phase: Phase, recoversIn: number | null): string {
  switch (phase) {
    case 'arming':
      return 'Arming the flaky endpoint…';
    case 'armed':
      return recoversIn != null && recoversIn > 0
        ? 'The demo monitor is failing — an incident opens after 2 checks.'
        : 'Incident open — webhook fired. Recovering shortly.';
    case 'recovering':
      return 'Endpoint healthy again — the incident is closing.';
    case 'done':
      return 'Arc complete. The incident is in the timeline.';
    default:
      return `Watch the full open → alert → recover arc (~${String(ARC_HINT_SECONDS)}s).`;
  }
}

/** A pulsing status-down dot while the arc runs; static under reduced-motion. */
function PulseDot({ reduceMotion }: { reduceMotion: boolean }): ReactNode {
  if (reduceMotion) {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-full bg-status-down"
      />
    );
  }
  return (
    <span aria-hidden="true" className="relative inline-flex size-2">
      <motion.span
        className="absolute inset-0 rounded-full bg-status-down"
        animate={{ opacity: [0.5, 0, 0.5], scale: [1, 2.2, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
      />
      <span className="relative inline-block size-2 rounded-full bg-status-down" />
    </span>
  );
}
