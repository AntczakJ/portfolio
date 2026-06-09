import type { ReactNode } from 'react';

import { About } from '@/components/about/about';
import { Bays } from '@/components/bays/bays';
import { Directory } from '@/components/directory/directory';
import { HeroContent } from '@/components/hero/hero-content';
import { HeroDescent } from '@/components/hero/hero-descent';
import { HERO_SENTINEL_ID } from '@/components/chrome/site-header';

/**
 * Home route — the single long-form scrolling lobby (ADR-003 scroll
 * architecture): hero descent → six bays → directory → about, resolving into the
 * designed footer (rendered in the layout shell).
 *
 * SERVER component. The `'use client'` boundary is kept low (ADR-002 / § 3): only
 * the hero's descent WRAPPER (`HeroDescent`) and the header are client; everything
 * else — the hero CONTENT (the LCP wordmark + copy + cue), the six bays, the
 * directory, the about, the footer — is real server-rendered DOM. GSAP only
 * ENHANCES the hero; if it never loads (no-JS, failed hydration) the page is the
 * complete directory floor top-to-bottom (Tier 3). Under reduced motion the
 * descent's `matchMedia` `reduced` branch creates no pin/scrub, so the page lands
 * on the composed resting frame and scrolls normally (Tier 2). Both tiers land on
 * clean composed frames — nothing frozen mid-transition (ADR-003).
 */
export default function HomePage(): ReactNode {
  return (
    <main id="main">
      {/* THE WOW — the pinned hero descent. The content passed as children is
          real DOM (the LCP / reduced-motion / no-JS floor). */}
      <HeroDescent>
        <HeroContent />
      </HeroDescent>

      {/* Hero-base sentinel (in document flow, zero height) — the header's reveal
          observer watches this to slide the chrome in once the hero scrolls past.
          aria-hidden, no layout footprint (no CLS). */}
      <div id={HERO_SENTINEL_ID} aria-hidden className="h-0 w-full" />

      {/* The six pinned, kinetically-titled gallery bays — the spine of the tour.
          Real server DOM (the no-JS / reduced-motion floor) enhanced by GSAP; the
          hero descent hands off into bay 1. */}
      <Bays />

      {/* The directory floor — the no-cinema / reduced-motion / no-JS reachable
          index of all six projects and all twelve outward links. */}
      <Directory />

      {/* About / author + contact. */}
      <About />
    </main>
  );
}
