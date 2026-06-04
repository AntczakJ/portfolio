'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { ConnectionState } from '@/lib/sse/use-live-board';

interface ConnectionIndicatorProps {
  state: ConnectionState;
  className?: string;
}

/**
 * The "one EventSource is connected" tell — the calm, premium liveness cue
 * (Linear / Vercel register). It mirrors the success criterion: the board is
 * genuinely PUSHED over a single SSE connection, and this indicator is its
 * visible proof for a viewer who is not in DevTools.
 *
 * `live`: a steady green dot with a soft pulsing halo ("it's alive").
 * `connecting` / `reconnecting`: an amber dot, surfaced calmly — no alarm,
 * EventSource auto-recovers. Status is never color-alone: each state ships a
 * text label and an accessible name.
 */
export function ConnectionIndicator({
  state,
  className,
}: ConnectionIndicatorProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const meta = STATE_META[state];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
        meta.surface,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex size-2">
        {state === 'live' && !reduceMotion ? (
          <motion.span
            aria-hidden="true"
            className={cn('absolute inset-0 rounded-full', meta.dot)}
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 2.2 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
        ) : null}
        <span
          className={cn('relative inline-block size-2 rounded-full', meta.dot)}
        />
      </span>
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}

const STATE_META: Record<
  ConnectionState,
  { label: string; dot: string; text: string; surface: string }
> = {
  live: {
    label: 'Live',
    dot: 'bg-status-up',
    text: 'text-status-up-text',
    surface: 'border-status-up/30 bg-status-up-surface',
  },
  connecting: {
    label: 'Connecting',
    dot: 'bg-status-degraded',
    text: 'text-status-degraded-text',
    surface: 'border-status-degraded/30 bg-status-degraded-surface',
  },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-status-degraded',
    text: 'text-status-degraded-text',
    surface: 'border-status-degraded/30 bg-status-degraded-surface',
  },
};
