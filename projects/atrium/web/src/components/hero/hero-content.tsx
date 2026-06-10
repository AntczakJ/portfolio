import type { ReactNode } from 'react';

import { ScrollCue } from './scroll-cue';

/**
 * The hero's composed resting frame, as REAL SERVER DOM (Task 3.2).
 *
 * This is the content the descent enhances and the floor every degraded tier
 * lands on:
 *   - the `ATRIUM` wordmark as a real `<h1>` — the LCP element (type/CSS-light,
 *     never an image — ADR-003 / CWV) and the SEO/SR/no-JS heading;
 *   - one line of supporting copy (the portfolio one-liner from the README
 *     philosophy);
 *   - the quiet scroll cue.
 *
 * The `data-descent-*` attributes are the hooks the GSAP descent scrubs
 * (`data-descent-wordmark` scales/thickens; `data-descent-aux` clears first).
 * They are inert without JS — the resting frame is fully composed and legible on
 * its own.
 *
 * The wordmark binds its display-face variation axes inline so the descent can
 * ease the `wght` axis from this resting weight up to bold as the letters rush
 * past (the no-Club-plugin kinetic technique — ADR-002). It is set as a SPECIMEN
 * (Stripe / Klim), not a logo.
 */
export function HeroContent(): ReactNode {
  return (
    <>
      <p
        data-descent-aux
        className="text-fg-subtle mb-6 text-xs tracking-[0.22em] uppercase sm:mb-8 sm:text-sm"
      >
        The portfolio of Jan Antczak
      </p>

      <h1
        data-descent-wordmark
        className="font-display text-display text-fg leading-none tracking-tight will-change-transform"
        style={{
          fontVariationSettings:
            "'opsz' var(--display-opsz), 'wght' var(--display-wght), 'SOFT' var(--display-soft)",
          // D-20 — the wordmark stands IN the shaft: a layered warm glow that reads
          // as the light catching the letterforms (a tight inner catch + a broad
          // halo), so the desktop hero is lit, not a flat title card. Kept warm and
          // soft so the type stays sharp.
          textShadow:
            '0 0 28px color-mix(in oklab, var(--color-light) 50%, transparent), 0 0 90px color-mix(in oklab, var(--color-light) 28%, transparent)',
        }}
      >
        ATRIUM
      </h1>

      <p
        data-descent-aux
        className="text-fg-muted mt-7 max-w-xl text-base text-balance sm:mt-9 sm:text-lg"
      >
        Six showcases, four backends, one quality bar.
      </p>

      <div data-descent-aux className="mt-12 sm:mt-16">
        <ScrollCue />
      </div>
    </>
  );
}
