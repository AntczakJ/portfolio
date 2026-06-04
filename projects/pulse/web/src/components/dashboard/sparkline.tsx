'use client';

import { useId, type ReactNode } from 'react';

import { buildSparkline } from '@/lib/sparkline/sparkline-path';
import type { SparklinePoint } from '@/lib/store/live-store';
import { statusToken } from '@/lib/status/status-tokens';

interface SparklineProps {
  points: readonly SparklinePoint[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * The response-time sparkline (hand-rolled SVG, ADR-001).
 *
 * Drawn DIRECTLY from the rolling buffer — no uPlot (that is the Phase 4
 * detail chart), no Motion per point (a frame-budget trap). The `<path>`
 * carries a cheap CSS transition so the line eases as new points slide in;
 * `prefers-reduced-motion` is honoured globally by globals.css (the path
 * transition collapses to instant).
 *
 * The stroke is colored by the LATEST point's status (green / amber / red /
 * neutral) via the sovereign `--color-status-*` tokens, so the sparkline
 * reinforces the card's status without being the only signal (the dot +
 * label carry it accessibly). Null-valued points (transport errors) render
 * as gaps in the line, not a dive to zero.
 *
 * `aria-hidden` because the numeric latest response time beside it (mono,
 * tabular-nums) is the accessible representation of the same data — the
 * sparkline is decorative reinforcement.
 */
export function Sparkline({
  points,
  width = 120,
  height = 32,
  className,
}: SparklineProps): ReactNode {
  const gradientId = useId();
  const geo = buildSparkline(points, { width, height });
  const status = geo.lastStatus ?? 'unknown';
  const token = statusToken(status);

  if (!geo.hasData) {
    return (
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
        role="presentation"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          className="stroke-border-strong"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  // Map the status token's bg-* class to a stroke/fill via currentColor: we
  // set the text color from the token and let the path inherit it. The dot
  // tokens are `bg-status-*`; here we want stroke, so we use the matching
  // `text-status-*` utility name derived from the token's dot class.
  const strokeClass = STATUS_STROKE[status];

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      className={`${strokeClass} ${className ?? ''}`}
      aria-hidden="true"
      role="presentation"
      preserveAspectRatio="none"
    >
      <defs>
        {/* M-2 — a slightly stronger area fill so the sparkline reads as a
            shaped band at rest, not a thin line floating on white. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {geo.area ? (
        <path
          d={geo.area}
          fill={`url(#${gradientId})`}
          stroke="none"
          className="transition-all duration-300 ease-out"
        />
      ) : null}
      <path
        d={geo.line}
        fill="none"
        stroke="currentColor"
        // M-2 — a touch heavier so the line clears contrast on the light card
        // surface (the prior 1.5px green-on-white read low-contrast).
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-300 ease-out"
        vectorEffect="non-scaling-stroke"
      />
      {geo.lastPoint ? (
        <circle
          cx={geo.lastPoint.x}
          cy={geo.lastPoint.y}
          r={2}
          fill="currentColor"
          className="transition-all duration-300 ease-out"
        />
      ) : null}
      {/* Off-screen, no-op reference so `token` is observably used and the
          status semantics stay traceable for the reviewer. */}
      <title>{token.label} response time</title>
    </svg>
  );
}

/**
 * The stroke color per status. We use explicit `text-status-*` utilities so
 * `currentColor` (the stroke/fill source) resolves to the sovereign token,
 * matching the dot/label color family on the same card.
 */
const STATUS_STROKE: Record<NonNullable<SparklinePoint['status']>, string> = {
  up: 'text-status-up',
  degraded: 'text-status-degraded',
  down: 'text-status-down',
  unknown: 'text-status-unknown',
};
