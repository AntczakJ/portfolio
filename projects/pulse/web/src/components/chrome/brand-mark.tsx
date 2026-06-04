import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface BrandMarkProps {
  className?: string;
  /** When true, render the wordmark next to the glyph. */
  withWordmark?: boolean;
}

/**
 * Pulse brand mark — a hand-rolled inline-SVG "pulse" waveform inside a
 * rounded tile, plus the optional wordmark. Inline SVG (not an `<img>`)
 * so it inherits the current color and stays crisp at every size, and so
 * it is CSP-clean (no external asset, covered by `img-src 'self' data:`
 * only when used as a data URI elsewhere).
 *
 * The glyph is the recurring motif: a flat baseline that spikes once —
 * the heartbeat / monitoring-blip idiom the product is named for. The
 * spike sits on the brand indigo; everything else reads as quiet chrome.
 */
export function BrandMark({
  className,
  withWordmark = true,
}: BrandMarkProps): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-brand text-on-brand shadow-xs">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
          aria-hidden="true"
        >
          <path d="M2 12h4l2.5-6 4 13 2.5-7H22" />
        </svg>
      </span>
      {withWordmark ? (
        <span className="text-base font-semibold tracking-tight text-foreground">
          Pulse
        </span>
      ) : null}
    </span>
  );
}
