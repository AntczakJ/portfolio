import type { ReactNode } from 'react';

import { BladeSweepDivider } from '@/components/chrome/blade-sweep-divider';
import { BladeHero } from '@/components/hero/blade-hero';
import { BarbersSection } from '@/components/sections/barbers-section';
import { GallerySection } from '@/components/sections/gallery-section';
import { IntroSection } from '@/components/sections/intro-section';
import { ServicesSection } from '@/components/sections/services-section';
import { TestimonialsSection } from '@/components/sections/testimonials-section';
import { VisitSection } from '@/components/sections/visit-section';

/**
 * Landing page (Phase 4a) — the cinematic blade-sweep hero (the wow moment,
 * ADR-004) followed by the long-form marketing sections it hands off into.
 *
 * Order down the page (PLAN.md § Site sections):
 *   hero → intro/positioning → services → gallery → barbers →
 *   testimonials → visit → (footer, in the layout).
 *
 * The recurring blade-sweep divider sits between sections as connective
 * tissue echoing the hero motif. Every section is dark-luxe with generous
 * negative space, a GSAP scroll-reveal (transform/opacity-only, reduced-
 * motion degraded via matchMedia), and consumes the seeded mock layer.
 *
 * Server Component — the section bodies are server-rendered real DOM (SEO /
 * SR / the no-JS floor); the only client boundaries are the animated leaves
 * (the hero, the dividers, the gallery strip, and the thin reveal wrappers).
 * The hero releases its pin into `#intro` so the cut IS the transition into
 * the site (the scroll never stalls on a finished animation).
 */
export default function HomePage(): ReactNode {
  return (
    <main id="main">
      <BladeHero />

      <IntroSection />

      <SectionDivider />
      <ServicesSection />

      <SectionDivider />
      <GallerySection />

      <SectionDivider />
      <BarbersSection />

      <SectionDivider />
      <TestimonialsSection />

      <SectionDivider />
      <VisitSection />
    </main>
  );
}

/** The recurring blade-sweep divider, with consistent page gutters. */
function SectionDivider(): ReactNode {
  return (
    <BladeSweepDivider className="mx-auto max-w-[80rem] px-5 py-2 sm:px-8" />
  );
}
