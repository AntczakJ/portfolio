'use client';

import type { ReactNode } from 'react';

import { useScrollReveal } from '@/lib/gsap/use-scroll-reveal';

/**
 * Intro / positioning section (Phase 4.1) — the hero hands off into this.
 *
 * A short editorial statement establishing the studio: craft and
 * atmosphere over information. The lead line reveals in three kinetic-but-
 * restrained phrase fragments on scroll (GSAP, via `useScrollReveal` — a
 * staggered transform/opacity rise), each fragment a `[data-reveal]` unit
 * so the statement assembles as you arrive rather than appearing at once.
 * Under reduced motion the whole statement is simply present (the reveal
 * hook degrades to the resting state).
 *
 * The brass "lit edge" eyebrow and the hairline rule echo the blade motif
 * without running through the text (the designer-critic's brass-on-an-edge
 * rule). Generous negative space; the brass-on-near-black discipline holds.
 */
export function IntroSection(): ReactNode {
  const scope = useScrollReveal({ y: 30, stagger: 0.12 });

  return (
    <section
      ref={scope}
      id="intro"
      aria-labelledby="intro-heading"
      // D-13: bottom padding equalised to the next section's top padding
      // (py-24/32) so the light above and below the following brass divider
      // is balanced — the intro's lead no longer reads as stuck to the
      // divider. The generous top breathing room (the hero hand-off) stays.
      className="relative mx-auto max-w-[72rem] scroll-mt-24 px-5 pt-28 pb-24 sm:px-8 sm:pt-36 sm:pb-32 lg:pt-44"
    >
      <p
        data-reveal
        className="text-brass-text mb-10 flex items-center gap-3 text-[length:var(--text-caption)] tracking-[0.32em] uppercase"
      >
        <span
          aria-hidden="true"
          className="h-px w-8 bg-[var(--color-edge-glow)]"
        />
        The studio
      </p>

      <h2 id="intro-heading" className="max-w-[56rem]">
        <span className="sr-only">
          A chair, a clean edge, and an hour that is entirely yours. Razor&rsquo;s
          Edge is a grooming studio for men who treat the details as the point.
        </span>
        <span
          aria-hidden="true"
          className="font-display text-fg block text-balance text-[length:var(--text-h1)] leading-[1.08] [font-variation-settings:'opsz'_120,'wght'_420,'SOFT'_0]"
        >
          <span data-reveal className="block">
            A chair, a clean edge,
          </span>
          <span data-reveal className="block">
            and an hour that is{' '}
            <span className="text-brass-text italic [font-variation-settings:'opsz'_120,'wght'_460]">
              entirely yours.
            </span>
          </span>
        </span>
      </h2>

      <p
        data-reveal
        className="text-fg-muted mt-10 max-w-xl text-balance text-[length:var(--text-body-lg)] leading-relaxed"
      >
        Razor&rsquo;s Edge is a grooming studio for men who treat the details
        as the point. Low light, warm brass, an unhurried chair, and a barber
        who reads a head shape before the clippers ever switch on.
      </p>
    </section>
  );
}
