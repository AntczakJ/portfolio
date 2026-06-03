import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The giant scroll-split hero wordmark — "RAZOR'S EDGE" rendered as TWO
 * real-DOM copies, each `clip-path`-clipped to ONE side of a single clean
 * cut line (ADR-004 technique W1, no Club GSAP plugin). Both copies hold
 * the full real text, so the wordmark is sharp at any width, theme-correct,
 * and SEO/SR/no-JS complete — GSAP only translates the two clipped halves
 * apart along the vertical axis; it never creates the text.
 *
 * ── The split geometry (D-01 third rework — seam integrity first) ──────
 * The two clipped-copies technique kept mismatching at the seam under the
 * diagonal cut + different parallax rates. The approach is now changed to
 * prioritise SEAM INTEGRITY over parallax drama:
 *
 *   1. The cut is a CLEAN HORIZONTAL line through the cap-height midline
 *      (50% of the glyph box). No diagonal — a horizontal cut can never
 *      bisect a glyph into a "garbled" shape, only a clean top/bottom half.
 *   2. Both halves are the IDENTICAL wordmark at the IDENTICAL horizontal
 *      position, clipped to exactly-complementary regions (upper = the band
 *      ABOVE the cut, lower = the band BELOW it). At rest they compose
 *      pixel-identical to a single sharp wordmark — the same frame the no-JS
 *      static copy renders.
 *   3. The hero parts them with EQUAL-AND-OPPOSITE vertical translation —
 *      top up, bottom down, SAME magnitude, zero horizontal component. There
 *      is no rate desync, so the two half-letters always stay mirror-aligned
 *      across the gap. The drama comes from the blade, the amber glow, and
 *      the portrait Ken-Burns behind the gap — NOT from desyncing the halves.
 *
 * CRITICAL: the clip-path is applied to a fixed-size inner box whose height
 * equals the glyph box (`leading-none`), and the cut is expressed as a % of
 * THAT box. The clip travels with its half as the half translates, so the
 * letters never re-reveal more of themselves — each half always shows only
 * its own slice. This is the fix for the previous "two full wordmarks"
 * doubling defect: there, the cut percentages sat in a tall flex wrapper so
 * each clip kept (almost) the whole glyph.
 *
 * This component is presentational; the hero client component drives the
 * GSAP transforms on the `[data-hero-half]` elements.
 */

const WORDMARK_TEXT = 'RAZOR’S EDGE';

// The cut as two complementary clip rectangles over the glyph box, sharing
// ONE clean horizontal edge at the cap-height midline (50%). Over-extended
// to ±40% beyond the box on the far side so a translated half never reveals
// a clipped far edge. Because both edges are at exactly 50% and perfectly
// horizontal, the two halves seam into one whole, sharp wordmark at rest and
// part into clean top/bottom letter-halves under any vertical translation.
const UPPER_CLIP = 'polygon(0% -40%, 100% -40%, 100% 50%, 0% 50%)';
const LOWER_CLIP = 'polygon(0% 50%, 100% 50%, 100% 140%, 0% 140%)';

interface HeroWordmarkProps {
  className?: string;
}

export function HeroWordmark({ className }: HeroWordmarkProps): ReactNode {
  return (
    <div
      className={cn(
        'pointer-events-none relative flex items-center justify-center',
        className,
      )}
    >
      {/* Accessible heading — the real H1, visually carried by the two
          clipped copies below. */}
      <h1 className="sr-only">Razor&rsquo;s Edge</h1>

      {/* The wordmark box: its height is the glyph box (leading-none), so the
          cut percentages land on the true cap-height midline. The two halves
          are absolutely stacked over it; a sizing copy gives the box its
          intrinsic dimensions without itself painting. */}
      <div aria-hidden="true" className="relative w-full select-none">
        {/* Invisible sizer — establishes the box the absolute halves fill. */}
        <WordmarkGlyph className="invisible" />

        {/* Upper half — keeps everything above the cut. */}
        <WordmarkHalf dataHalf="upper" clipPath={UPPER_CLIP} />
        {/* Lower half — the complementary region below the cut, so the two
            compose into one whole, sharp wordmark at rest. */}
        <WordmarkHalf dataHalf="lower" clipPath={LOWER_CLIP} />

        {/* The lit brass edge along the cut line (the honed-blade seam, NOT a
            strikethrough — D-04). At rest it is a FINE, restrained lit seam
            where the two halves meet on the cap-height midline; it only
            flares bright as the blade crosses (GSAP scales/brightens it in
            the cut phase). An idle shimmer travels it (disabled under reduced
            motion). Kept thin + lower-opacity so it never reads as crossed-
            out text. */}
        <span
          data-hero-edge
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,var(--color-edge-glow)_22%,#fff5e6_50%,var(--color-edge-glow)_78%,transparent)] bg-[length:200%_100%] opacity-65 [animation:edge-shimmer_6s_ease-in-out_infinite]"
          style={{ filter: 'blur(0.3px)' }}
        />
      </div>
    </div>
  );
}

interface WordmarkHalfProps {
  dataHalf: 'upper' | 'lower';
  clipPath: string;
}

function WordmarkHalf({ dataHalf, clipPath }: WordmarkHalfProps): ReactNode {
  const style: CSSProperties = { clipPath, WebkitClipPath: clipPath };
  return (
    <div
      data-hero-half={dataHalf}
      style={style}
      className="absolute inset-0 will-change-transform"
    >
      <WordmarkGlyph className="text-fg" />
    </div>
  );
}

/** One copy of the wordmark glyph — shared by the sizer and both halves so
 * the three are pixel-identical (same variable-font settings, same metrics),
 * which is what keeps the seam invisible at rest. */
function WordmarkGlyph({ className }: { className?: string }): ReactNode {
  return (
    <span
      className={cn(
        "font-display block text-center leading-none tracking-[-0.02em] whitespace-nowrap text-[clamp(2rem,11.2vw,8.75rem)] [font-variation-settings:'opsz'_144,'wght'_var(--hero-wght,460),'SOFT'_0]",
        className,
      )}
    >
      {WORDMARK_TEXT}
    </span>
  );
}
