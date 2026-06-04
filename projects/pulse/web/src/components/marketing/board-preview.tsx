import { AlertTriangleIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusDot } from '@/components/dashboard/status-dot';
import { cn } from '@/lib/cn';
import { statusToken, type DisplayStatus } from '@/lib/status/status-tokens';

/**
 * H-5 — the above-the-fold board preview on the landing.
 *
 * The landing must SHOW the product, not just describe it: a faithful, static
 * snapshot of the live board (the actual card layout + a pulsing "Live" pill +
 * a summary bar + one card in a DOWN / incident state), so a viewer sees the
 * wow in the first frame and is routed into the real, live demo to trigger it.
 *
 * This is a SERVER component with no data dependency (the Lighthouse posture
 * holds): the cards are a fixed, representative sample, the "Live" pulse is a
 * pure CSS animation (no Motion / client JS), and `prefers-reduced-motion` is
 * honoured globally by `globals.css`. It is decorative reinforcement of the
 * copy, so the whole figure is `aria-hidden` — the hero heading + CTA carry the
 * accessible message, and the real board is one click away.
 */

interface PreviewCard {
  readonly name: string;
  readonly host: string;
  readonly status: DisplayStatus;
  readonly ms: string;
  readonly code: string;
  readonly incident?: boolean;
}

const CARDS: readonly PreviewCard[] = [
  { name: 'API gateway', host: 'api.acme.io', status: 'up', ms: '142', code: '200' },
  { name: 'Web app', host: 'app.acme.io', status: 'up', ms: '88', code: '200' },
  {
    name: 'Checkout service',
    host: 'pay.acme.io/health',
    status: 'down',
    ms: '—',
    code: '503',
    incident: true,
  },
  { name: 'Docs', host: 'docs.acme.io', status: 'up', ms: '64', code: '200' },
  {
    name: 'Search',
    host: 'search.acme.io',
    status: 'degraded',
    ms: '1284',
    code: '200',
  },
  { name: 'CDN edge', host: 'cdn.acme.io', status: 'up', ms: '21', code: '200' },
];

export function BoardPreview(): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="relative w-full select-none rounded-2xl border border-border bg-surface/70 p-3 shadow-xl shadow-black/5 backdrop-blur-sm sm:p-4 dark:shadow-black/40"
    >
      {/* Window chrome + the Live pill */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-status-down/40" />
          <span className="size-2.5 rounded-full bg-status-degraded/40" />
          <span className="size-2.5 rounded-full bg-status-up/40" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-fg-muted">
          <span className="relative inline-flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-status-up opacity-75 motion-reduce:hidden" />
            <span className="relative inline-block size-1.5 rounded-full bg-status-up" />
          </span>
          Live
        </span>
      </div>

      {/* Summary bar — reads the outage, weighted (M-5 register). */}
      <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-status-down/35 border-l-2 border-l-status-down bg-status-down-surface/60 px-3 py-2">
        <AlertTriangleIcon className="size-4 shrink-0 text-status-down-text" />
        <span className="text-xs font-semibold text-status-down-text">
          Outage detected
        </span>
        <span className="text-[11px] text-fg-subtle">· 1 open incident</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-status-up" />4
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-status-degraded" />1
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-status-down" />1
          </span>
        </div>
      </div>

      {/* The live incident strip (the dramatic beat, frozen) */}
      <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-status-down/40 bg-status-down-surface/50 px-3 py-2">
        <span className="relative inline-flex size-2 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-status-down opacity-75 motion-reduce:hidden" />
          <span className="relative inline-block size-2 rounded-full bg-status-down" />
        </span>
        <span className="text-xs font-medium text-foreground">
          Checkout service
        </span>
        <span className="truncate text-[11px] text-fg-subtle">
          down after 3 consecutive checks
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums text-status-down-text">
          0:42
        </span>
      </div>

      {/* The card grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {CARDS.map((card) => (
          <PreviewMonitorCard key={card.name} card={card} />
        ))}
      </div>
    </div>
  );
}

function PreviewMonitorCard({ card }: { card: PreviewCard }): ReactNode {
  const token = statusToken(card.status);
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-3',
        card.incident ? 'border-status-down/50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-semibold text-foreground">
            {card.name}
          </span>
          <span className="truncate font-mono text-[10px] text-fg-subtle">
            {card.host}
          </span>
        </div>
        <StatusDot status={card.status} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={cn('font-mono text-lg font-semibold tabular-nums', token.text)}>
          {card.ms}
          <span className="ml-0.5 text-[10px] font-normal text-fg-subtle">
            ms
          </span>
        </span>
        <Spark status={card.status} />
      </div>
    </div>
  );
}

/** A tiny static sparkline glyph per status (decorative). */
function Spark({ status }: { status: DisplayStatus }): ReactNode {
  const stroke =
    status === 'down'
      ? 'text-status-down'
      : status === 'degraded'
        ? 'text-status-degraded'
        : 'text-status-up';
  const d =
    status === 'down'
      ? 'M0 8 L10 7 L20 9 L30 6 L40 18 L50 20'
      : status === 'degraded'
        ? 'M0 12 L10 8 L20 14 L30 7 L40 13 L50 9'
        : 'M0 14 L10 11 L20 13 L30 9 L40 12 L50 8';
  return (
    <svg
      viewBox="0 0 50 22"
      width={50}
      height={22}
      className={cn('shrink-0', stroke)}
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
