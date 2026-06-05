'use client';

import type { ReactNode } from 'react';

import { useApiHealth } from '@/lib/hooks/use-api-health';
import { useConnectionState } from '@/lib/stores/stream-store';
import { cn } from '@/lib/cn';

/**
 * Minimal API health indicator. When the Elysia backend is not running
 * we render a calm offline dot rather than a red alarm — the landing
 * page is read by visitors who may not be the operator.
 *
 * **Single source of truth (Phase 4.1 P0-4).** A live WebSocket stream
 * IS proof the API is up. The `/health` HTTP poll and the WS connection
 * are two signals that must never contradict — a header reading "API
 * offline" while ticks stream in the footer reads as a state bug and
 * torpedoes the real-time credibility for a recruiter watching frames
 * arrive in DevTools. So we only show "offline" when BOTH the HTTP poll
 * is failing AND the WS stream is not connected. While the stream is
 * connected the header reports "online" regardless of the HTTP probe
 * (the probe can transiently fail under a cold serverless health route
 * even as the long-lived socket keeps streaming).
 *
 * Latency surfaces in the bottom status bar (`@/components/chrome/
 * status-bar`) — both consumers share the `useApiHealth` query via
 * TanStack Query deduplication, so there is exactly one poll on the
 * `/health` endpoint regardless of how many places in the tree render
 * a derived value.
 */
export function ApiStatus(): ReactNode {
  const { status } = useApiHealth();
  const wsState = useConnectionState();
  const wsConnected = wsState === 'connected';

  // Reconcile the two signals. A connected stream pins "online".
  const effective: 'online' | 'pending' | 'offline' = wsConnected
    ? 'online'
    : status;

  const label =
    effective === 'online'
      ? 'API online'
      : effective === 'pending'
        ? 'Checking API'
        : 'API offline';

  return (
    <div
      className="inline-flex items-center gap-2 font-mono text-xs text-(--color-fg-muted)"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          effective === 'online' && 'bg-(--color-success)',
          effective === 'pending' && 'bg-(--color-fg-subtle)',
          effective === 'offline' && 'bg-(--color-fg-subtle)',
        )}
      />
      {/* Fixed min-width so the label swap (Checking API → API online /
          API offline) does not reflow the top-bar cluster after the
          health probe resolves — a post-paint width change here would
          register as layout shift (CLS). The widest label is
          "Checking API"; 5.5rem covers it at the mono 12px size. */}
      <span className="inline-block min-w-[5.5rem]">{label}</span>
    </div>
  );
}
