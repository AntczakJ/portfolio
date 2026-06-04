'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Sparkline } from '@/components/dashboard/sparkline';
import { StatusDot } from '@/components/dashboard/status-dot';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { MonitorRow } from '@/lib/api/monitors';
import {
  useLiveBoard,
  type LiveMonitorState,
} from '@/lib/store/live-store';
import { statusToken, type DisplayStatus } from '@/lib/status/status-tokens';
import { formatRelativeTime } from '@/lib/time/relative-time';

interface MonitorCardProps {
  monitor: MonitorRow;
  /** The shared 1-second clock (one timer for the whole board). */
  now: number;
}

const EMPTY_LIVE: LiveMonitorState = {
  status: 'unknown',
  lastResponseTimeMs: null,
  lastStatusCode: null,
  lastCheckedAt: null,
  sparkline: [],
  hasOpenIncident: false,
  incidentSeverity: null,
};

/**
 * A live monitor card — the atom of the wow moment.
 *
 * It reads its OWN slice of the live store (status, last result, sparkline
 * buffer, pulse token) so a fresh result on one monitor re-renders only
 * that card. Composition:
 *   - StatusDot (always with its AA label — status is never color-alone) +
 *     the monitor name and truncated target URL,
 *   - the latest response time (mono, tabular-nums) and HTTP code,
 *   - the response-time sparkline (hand-rolled SVG, grows as results stream),
 *   - the "last checked Ns ago" ticker, driven off the shared clock.
 *
 * MOTION (micro-interactions only, ADR-001 / § 15):
 *   - a brief RING PULSE on the card when a fresh `check.result` lands (the
 *     `pulseToken` bump) so the eye catches which card just updated — the
 *     Linear "it's alive" detail,
 *   - a smooth CROSSFADE of the status presentation when `status.change`
 *     flips up<->degraded<->down.
 * Both respect `prefers-reduced-motion` (collapse to instant). The sparkline
 * is NOT animated through Motion (it eases via a CSS transition on the path).
 */
export function MonitorCard({ monitor, now }: MonitorCardProps): ReactNode {
  const live = useLiveBoard((s) => s.monitors[monitor.id]) ?? EMPTY_LIVE;
  const pulseToken = useLiveBoard((s) => s.pulseToken[monitor.id] ?? 0);
  const reduceMotion = useReducedMotion();

  const status = resolveStatus(monitor, live);
  const token = statusToken(status);
  const host = safeHost(monitor.targetUrl);

  // Fire a one-shot ring pulse when the pulse token increments (a fresh
  // result). We track the previous token so the initial mount does not pulse.
  const [pulsing, setPulsing] = useState(false);
  const prevToken = useRef(pulseToken);
  useEffect(() => {
    if (pulseToken !== prevToken.current) {
      prevToken.current = pulseToken;
      if (reduceMotion) {
        return;
      }
      setPulsing(true);
      // M-1 — a LINGERING fresh-result ring (~2s decay) so the most-recently
      // probed card stays visibly "just updated" even in a still frame.
      const t = setTimeout(() => {
        setPulsing(false);
      }, 2_000);
      return () => {
        clearTimeout(t);
      };
    }
    return undefined;
  }, [pulseToken, reduceMotion]);

  return (
    <Card
      className={cn(
        'group relative gap-4 overflow-hidden transition-colors hover:border-border-strong',
        live.hasOpenIncident && 'border-status-down/50',
      )}
      data-status={status}
      data-monitor-id={monitor.id}
    >
      {/* Stretched link: the whole card navigates to the monitor detail. It is
          a real anchor (keyboard-reachable, visible focus ring) layered under
          the pulse overlay but above the static content. */}
      <Link
        href={`/dashboard/monitors/${monitor.id}`}
        className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Open ${monitor.name} detail`}
      />

      {/* Fresh-result ring pulse — an absolutely-positioned overlay so it
          never reflows the card. Driven by Motion, gated by reduced-motion. */}
      {pulsing ? (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0.55 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset',
            RING_CLASS[status] ?? RING_CLASS.unknown,
          )}
        />
      ) : null}

      <CardHeader className="gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {monitor.name}
            </span>
            {/* H-1 — long hosts (e.g. the demo ngrok hostname) truncate with an
                ellipsis; the full target is in the native title tooltip. The
                `relative z-20` lifts it above the stretched card link so the
                hover/title resolves to the host, not the navigation overlay. */}
            <span
              className="relative z-20 max-w-full cursor-help truncate font-mono text-xs text-fg-subtle"
              title={monitor.targetUrl}
            >
              {host}
            </span>
          </div>
          {/* Status crossfade on a flip: keying the inner span on `status`
              lets Motion crossfade old->new. */}
          <motion.span
            key={status}
            initial={reduceMotion ? false : { opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="shrink-0"
          >
            <StatusDot status={status} withLabel />
          </motion.span>
        </div>
      </CardHeader>

      <CardContent className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span
            className={cn('font-mono text-2xl font-semibold tabular-nums', token.text)}
          >
            {live.lastResponseTimeMs != null
              ? String(live.lastResponseTimeMs)
              : '—'}
            {/* L-1 — the unit is muted + shrunk so the number stays the hero. */}
            <span className="ml-0.5 text-xs font-normal text-fg-subtle/70">
              ms
            </span>
          </span>
          <span className="text-xs text-fg-subtle">
            {monitor.intervalSeconds >= 60
              ? `Every ${String(Math.round(monitor.intervalSeconds / 60))}m`
              : `Every ${String(monitor.intervalSeconds)}s`}
            {live.lastStatusCode != null
              ? ` · HTTP ${String(live.lastStatusCode)}`
              : ''}
          </span>
        </div>
        <Sparkline points={live.sparkline} className="mb-0.5" />
      </CardContent>

      <div className="flex items-center justify-between border-t border-border px-6 py-2.5 text-xs text-fg-subtle">
        <span>Last checked</span>
        <span className="font-mono tabular-nums text-fg-muted" data-numeric>
          {formatRelativeTime(live.lastCheckedAt, now)}
        </span>
      </div>
    </Card>
  );
}

/**
 * The card's display status: prefer the LIVE status once a result has
 * streamed in, otherwise the REST snapshot's `currentStatus`, otherwise
 * `unknown`. This keeps a freshly-created monitor reading `unknown` until
 * its first real probe lands (the wow-moment "watch it go live" beat).
 */
function resolveStatus(
  monitor: MonitorRow,
  live: LiveMonitorState,
): DisplayStatus {
  // An open incident is the strongest signal — the card shows its severity
  // immediately (C-1), even before the first live result lands for it.
  if (live.incidentSeverity != null) {
    return live.incidentSeverity;
  }
  if (live.lastCheckedAt != null) {
    return live.status;
  }
  if (
    monitor.currentStatus === 'up' ||
    monitor.currentStatus === 'degraded' ||
    monitor.currentStatus === 'down'
  ) {
    return monitor.currentStatus;
  }
  return 'unknown';
}

/** Show host + path tail, never the scheme, never credentials. */
function safeHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const tail = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${tail}`;
  } catch {
    return rawUrl;
  }
}

const RING_CLASS: Record<string, string> = {
  up: 'ring-status-up/60',
  degraded: 'ring-status-degraded/60',
  down: 'ring-status-down/60',
  unknown: 'ring-status-unknown/50',
};
