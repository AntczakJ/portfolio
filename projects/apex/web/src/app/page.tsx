import type { ReactNode } from 'react';

import { ConfiguratorSection } from '@/components/configurator/configurator-section';
import { HeroSection } from '@/components/hero/hero-section';
import { FleetSection } from '@/components/sections/fleet-section';
import { GallerySection } from '@/components/sections/gallery-section';
import { HowItWorksSection } from '@/components/sections/how-it-works-section';
import { LocationsSection } from '@/components/sections/locations-section';
import { TestimonialsSection } from '@/components/sections/testimonials-section';

/**
 * Home route — the long-form marketing spine, "one car, brought closer":
 *   - the scroll-hero (Task 4.2) — static AVIF render as the LCP, the pinned
 *     GSAP intro, and the hand-off seam (it writes seam-progress as you scroll);
 *   - the live 3D configurator section (Tasks 4.3/4.4) — the R3F + drei scene,
 *     the accessible DOM swatch controls + screen-reader text alternative, the
 *     "Reserve this configuration" carry-over CTA, and the four-tier degradation;
 *   - the fleet + "how it works / why APEX" (Task 5.1) — the editorial fleet
 *     list (each "Reserve this" deep-links pre-seeded) + the value section;
 *   - the gallery / brand-story (Task 5.2) — the GSAP scroll-reveal sequence
 *     (parallax + masked-reveal on desktop; snap-scroll lazy stack on mobile);
 *   - locations + testimonials (Task 5.3) — static-map locations + trust set.
 *
 * The reservation wizard (`/reserve`, Tasks 5.4-5.6) is a separate routed pass.
 * The persistent header + footer are mounted in the root layout (Task 4.1).
 */
export default function HomePage(): ReactNode {
  return (
    <main id="main">
      <HeroSection />
      <ConfiguratorSection />
      <FleetSection />
      <HowItWorksSection />
      <GallerySection />
      <LocationsSection />
      <TestimonialsSection />
    </main>
  );
}
