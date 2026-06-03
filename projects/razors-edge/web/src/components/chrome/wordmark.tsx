import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface LogomarkProps {
  className?: string;
}

/**
 * Logomark — the blade/edge motif as a compact glyph (Task 3.1, D-10
 * rework).
 *
 * The SAME straight / cut-throat razor silhouette as the hero `Blade`
 * (D-03), reduced to a 24px lockup so the motif reads as one intentional
 * prop everywhere it recurs (header, footer, favicon): an open razor on a
 * gentle diagonal — handle/scale (lower-left), brass pivot, then the blade
 * with a thick spine and a lit honed edge (the brass `--color-edge-glow`
 * the whole brand is built on). Inline SVG so it is sharp at any size and
 * themes via `currentColor` + the edge-glow token. Decorative — the
 * accessible name comes from the wordmark text beside it.
 */
export function Logomark({ className }: LogomarkProps): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('h-6 w-6', className)}
    >
      {/* Handle / scale (trailing, lower-left). */}
      <rect
        x="2.4"
        y="16.1"
        width="8.2"
        height="2.9"
        rx="1.45"
        transform="rotate(-26 2.4 16.1)"
        fill="currentColor"
        opacity="0.42"
      />
      {/* Brass pivot pin. */}
      <circle cx="10.4" cy="13.3" r="1.35" fill="var(--color-edge-glow)" />
      {/* Blade body — opens up-right from the pivot. */}
      <path
        d="M11.6 12.4 L20.4 5.2 C21 4.7 21.7 5.3 21.3 6 L16.7 13.7 C16.4 14.2 15.8 14.4 15.3 14.1 L12 12.6 C11.6 12.4 11.5 12.5 11.6 12.4 Z"
        fill="currentColor"
        opacity="0.3"
      />
      {/* Thick spine (top line of the blade). */}
      <path
        d="M12 12.2 L20.6 5.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* Honed lit edge — the brass highlight along the cutting line. */}
      <path
        d="M11.8 12.7 L16.4 13.9"
        stroke="var(--color-edge-glow)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface WordmarkProps {
  className?: string;
  /** Render as the page's primary heading vs an inline brand mark. */
  as?: 'span' | 'div';
}

/**
 * Brand wordmark for the chrome (header / footer) — "RAZOR'S EDGE" in the
 * Fraunces display face with the logomark. Distinct from the giant
 * scroll-split hero wordmark (that is its own component); this is the
 * compact, legible lockup that lives in the header and footer.
 */
export function Wordmark({ className, as = 'span' }: WordmarkProps): ReactNode {
  const Tag = as;
  return (
    <Tag className={cn('inline-flex items-center gap-2', className)}>
      <Logomark className="h-5 w-5 text-fg" />
      <span className="font-display text-fg text-[1.05rem] leading-none tracking-[0.01em] [font-variation-settings:'opsz'_40,'wght'_540,'SOFT'_0]">
        Razor&rsquo;s Edge
      </span>
    </Tag>
  );
}
