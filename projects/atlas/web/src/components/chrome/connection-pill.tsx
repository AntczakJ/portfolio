'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useConnectionStore, type ConnectionStatus } from '@/lib/store/connection-store';

/**
 * Connection status pill (Task 4.2) — wired to the REAL WebSocket lifecycle.
 *
 * The telemetry client (useLiveTelemetry) drives the connection store; this pill
 * reflects it: connecting / live / reconnecting / offline. It is the discreet
 * "reconnecting" indicator the wow-fallback requires (on a socket drop the
 * markers freeze at their last authoritative position and this flips to
 * RECONNECTING). The status text is announced politely for screen readers.
 *
 * Mounted-gated so the dot animation does not cause a hydration mismatch.
 */

interface PillStyle {
  label: string;
  dotClass: string;
  pulse: boolean;
  title: string;
}

const STYLES: Record<ConnectionStatus, PillStyle> = {
  connecting: {
    label: 'Connecting',
    dotClass: 'bg-status-idle',
    pulse: true,
    title: 'Opening the live telemetry stream',
  },
  live: {
    label: 'Live',
    dotClass: 'bg-status-enroute',
    pulse: true,
    title: 'Live telemetry stream — one WebSocket, pushed in real time',
  },
  reconnecting: {
    label: 'Reconnecting',
    dotClass: 'bg-accent',
    pulse: true,
    title: 'Connection dropped — markers frozen at their last position, reconnecting',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-status-alert',
    pulse: false,
    title: 'Telemetry stream offline',
  },
};

export function ConnectionPill(): ReactNode {
  const [mounted, setMounted] = useState(false);
  const status = useConnectionStore((s) => s.status);
  const serverTick = useConnectionStore((s) => s.serverTick);

  useEffect(() => {
    setMounted(true);
  }, []);

  const style = STYLES[status];
  // P2-1: when live, the pill adopts the signal-amber language (amber backing +
  // ring + label) so the brand accent carries a deliberate "live" moment in the
  // top bar, not just the status dot.
  const isLive = mounted && status === 'live';

  return (
    <span
      className={
        isLive
          ? 'bg-accent-soft text-accent-ink ring-accent/40 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1'
          : 'border-border bg-surface-2 text-fg-muted inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs'
      }
      title={style.title}
    >
      <span
        className={`relative inline-flex size-1.5 rounded-full ${style.dotClass}`}
        aria-hidden="true"
        style={mounted ? undefined : { opacity: 0 }}
      >
        {mounted && style.pulse ? (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${style.dotClass}`}
          />
        ) : null}
      </span>
      <span className="font-mono tracking-wide uppercase" aria-live="polite">
        {style.label}
      </span>
      {isLive && serverTick !== null ? (
        <span className="hidden font-mono tabular-nums opacity-70 sm:inline" aria-hidden="true">
          t{serverTick.toLocaleString()}
        </span>
      ) : null}
    </span>
  );
}
