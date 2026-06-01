import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Brand wordmark "Meld" rendered in the left slot of the top bar.
 *
 * Pair: a 14 px square logomark + a 14 px wordmark at -0.014em tracking.
 * The logomark is two overlapping rounded squares — the canonical CRDT-
 * merge metaphor (two boards melding) and a visual preview of the
 * rectangle primitive that lives behind the canvas. Filled in the brand
 * accent so the mark IS the violet identity at first paint.
 *
 * The 18 px Inter-semibold wordmark previously here was the Tailwind
 * default heading — zero identity. Phase 4.1 designer-critic D-01.
 * Linear's wordmark sits at 14 px with `letterSpacing: -0.011em`;
 * Vercel's chevron lives at the same height as the wordmark. The
 * `-0.014em` track is denser than display copy without crossing into
 * Inter's `tracking-tight` (-0.025em) which over-condenses at small
 * sizes.
 *
 * Wrapped in a `<Link href="/">` so the brand is the home affordance
 * (previously a plain `<span>`; Phase 2.5 deferred the link until the
 * board route existed — it does now). `aria-label="Meld home"` carries
 * the destination for screen readers; the inline SVG is `aria-hidden`
 * because the wordmark already names the brand.
 */
export function BrandMark(): ReactNode {
  return (
    <Link
      href="/"
      aria-label="Meld home"
      data-testid="brand-mark"
      className="inline-flex items-center gap-1.5 rounded-(--radius-sm) text-(--color-fg) outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="shrink-0"
      >
        {/* Two overlapping rounded squares: back square at full accent,
            front square inset 4 px and stroked through to show the
            "meld" overlap. Drawn as one filled path with the front
            square punched out via even-odd fill so the silhouette
            reads as layered boards in a single brand-accent fill. */}
        <path
          d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 12 3.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 10.5v-7Zm3 3A1.5 1.5 0 0 1 6.5 5h7A1.5 1.5 0 0 1 15 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 13.5v-7Z"
          fill="var(--color-accent)"
          fillRule="evenodd"
        />
      </svg>
      <span
        className="select-none text-[14px] font-medium tracking-[-0.014em]"
        style={{ fontFeatureSettings: "'cv11', 'ss01'" }}
      >
        Meld
      </span>
    </Link>
  );
}
