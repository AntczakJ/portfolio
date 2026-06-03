import type { ReactNode, SVGProps } from 'react';

import { cn } from '@/lib/cn';

/**
 * Brand "drawn-edge" primitives — the cut-throat-razor motif reduced to a
 * handful of reusable marks so every place the brand could assert its
 * identity (the confirmation seal, list bullets/ticks, footer social tiles)
 * uses the SAME drawn edge rather than a stock check-tick or a generic thin
 * circle (designer-critic D-04 / D-11 / D-12: "every place the brand could
 * assert the cut-throat-razor identity must use the same drawn edge
 * primitive — one SVG, reused"). All are inline SVG, sharp at any size,
 * themeable via `currentColor` + the `--color-edge-glow` brass token, and
 * decorative (`aria-hidden`).
 */

/**
 * EdgeTick — the brand's "confirmed" mark: a compact open razor whose lit
 * honed edge draws a clean diagonal "tick" stroke, replacing the generic
 * lucide `Check`. Reads as the blade making the cut, not a checkbox.
 */
export function EdgeTick(props: SVGProps<SVGSVGElement>): ReactNode {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('h-4 w-4', className)}
      {...rest}
    >
      {/* Handle / scale dropping away at an open angle (lower-left). */}
      <rect
        x="2.2"
        y="16.4"
        width="7.4"
        height="2.6"
        rx="1.3"
        transform="rotate(-24 2.2 16.4)"
        fill="currentColor"
        opacity="0.42"
      />
      {/* Brass pivot. */}
      <circle cx="9.6" cy="13.9" r="1.3" fill="var(--color-edge-glow)" />
      {/* Blade spine — the thick top line, opening up-right. */}
      <path
        d="M10.8 12.9 L20.6 5.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* The lit honed edge draws the "tick" — the clean diagonal cut. */}
      <path
        d="M10.9 13.3 L20.4 5.6"
        stroke="var(--color-edge-glow)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * EdgeRule — a short lit honed-edge line used as the confirmation flourish
 * (the razor drawing the clean line under the booking reference). A thin
 * brass gradient stroke with a soft glow; horizontal by default.
 */
export function EdgeRule({
  className,
  width = 96,
}: {
  className?: string;
  width?: number;
}): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${String(width)} 8`}
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
      className={cn('h-2', className)}
      style={{ width }}
    >
      <defs>
        <linearGradient id="edge-rule-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-edge-glow)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--color-edge-glow)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-edge-glow)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        y1="4"
        x2={width}
        y2="4"
        stroke="url(#edge-rule-grad)"
        strokeWidth="1.5"
      />
      {/* The leading brass point — the razor's tip that drew the line. */}
      <circle cx={width - 4} cy="4" r="2.4" fill="var(--color-edge-glow)" />
    </svg>
  );
}
