'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';
import { setSeamProgress } from '@/lib/r3f/seam';
import { RESERVE_HREF } from '@/lib/site-nav';
import { CONFIGURATOR_OPTIONS, DEFAULT_CONFIG, HERO_VEHICLE, SHOP } from '@/mocks';

import { HeroRender } from './hero-render';

/**
 * Scroll-hero (Task 4.2 — the wow, part 1) per ADR-004.
 *
 * LAYER MODEL (one reserved box, back -> front; CLS-safe — the section reserves
 * 100svh at first paint regardless of which layer is visible):
 *   1. Studio field — a CSS radial-gradient ground (the light EV stage).
 *   2. The static AVIF product render (`HeroRender`) — THE LCP element
 *      (`priority`), the surface the seam hands off FROM.
 *   3. The SEAM MOUNT slot — a clearly-marked, reserved placeholder box where
 *      Task 4.4 wires the live R3F canvas. It mounts NOTHING here (ADR-002: the
 *      canvas is lazy + capability-gated; Task 4.2 does not mount R3F) — it only
 *      reserves the layout and carries the seam-progress writer.
 *   4. The brand DOM — eyebrow + APEX wordmark + one-line positioning + the
 *      Reserve CTA + a scroll cue. ALL real server-rendered DOM (the Tier-4
 *      no-JS / SEO / a11y floor): the hero reads completely without JS or WebGL.
 *
 * CHOREOGRAPHY (Tier 1, GSAP): a pinned, scrubbed `ScrollTrigger` timeline
 * (inherited `useGsapEffect` + `gsap.matchMedia` + transform/opacity-only +
 * CLS-safe transform pin) introduces the car in the apex art direction —
 * RESTRAINED, premium-modern, NOT razors-edge's blade: the render settles from
 * a slightly-pushed-in framing toward its hero pose, the brand block lifts and
 * recedes, the track-line draws, and the section writes a normalised
 * seam-progress value (the ONE sanctioned GSAP->R3F coupling, ADR-004 G1) that
 * the live canvas (Task 4.4) will read to pose-match the camera at the reveal.
 *
 * FALLBACKS (built now):
 *   - Tier 2 `prefers-reduced-motion`: NO pin / scrub / parallax — a static,
 *     composed final frame (render at its hero pose, brand block resting,
 *     track-line full). seam-progress is pinned to 1 so a reduced-motion reveal
 *     (Task 4.4) is a simple crossfade, not a scrubbed intro.
 *   - Tier 4 no-JS / pre-hydration: the markup IS the composed final frame
 *     (render + wordmark + copy + Reserve link), so SSR/crawlers/no-JS users get
 *     a complete, legible hero. GSAP only sets the *animated* initial state once
 *     it runs; it never gates the content.
 */
export function HeroSection(): ReactNode {
  const scope = useRef<HTMLElement>(null);

  // The configured-car description: the a11y text alternative + the LCP alt.
  const color = CONFIGURATOR_OPTIONS.colors.find(
    (c) => c.id === DEFAULT_CONFIG.colorId,
  );
  const wheel = CONFIGURATOR_OPTIONS.wheels.find(
    (w) => w.id === DEFAULT_CONFIG.wheelId,
  );
  const carAlt = `${HERO_VEHICLE.name} in ${color?.name ?? 'the default finish'} on ${wheel?.name ?? 'standard'} wheels, in an APEX studio`;

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const q = gsap.utils.selector(root);
      const render = q('[data-hero-render]')[0] as HTMLElement | undefined;
      const brand = q('[data-hero-brand]')[0] as HTMLElement | undefined;
      const track = q('[data-hero-track]')[0] as HTMLElement | undefined;
      const cue = q('[data-hero-cue]')[0] as HTMLElement | undefined;
      if (!render || !brand) return;

      const mm = gsap.matchMedia();

      mm.add(
        {
          full: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
          desktop: '(min-width: 768px)',
        },
        (ctx) => {
          const reduced = ctx.conditions?.reduced ?? false;
          const desktop = ctx.conditions?.desktop ?? false;

          // ---- Tier 2: reduced motion — static composed resting frame ------
          if (reduced) {
            gsap.set(render, { scale: 1, yPercent: 0, opacity: 1 });
            gsap.set(brand, { opacity: 1, y: 0 });
            if (track) gsap.set(track, { scaleX: 1, opacity: 1 });
            if (cue) gsap.set(cue, { opacity: 0 });
            // Hand the seam its terminal value so the reveal (Task 4.4) is a
            // crossfade, not a scrubbed intro.
            setSeamProgress(1);
            return;
          }

          // ---- Tier 1: full scrubbed, RESTRAINED intro ---------------------
          // Initial (joined) state — the composed frame the instant before
          // scroll: render slightly pushed in + lowered, brand block present,
          // track-line closed.
          gsap.set(render, {
            scale: 1.08,
            yPercent: 4,
            opacity: 1,
            willChange: 'transform',
          });
          gsap.set(brand, { opacity: 1, y: 0 });
          if (track) gsap.set(track, { scaleX: 0, transformOrigin: 'center' });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: root,
              start: 'top top',
              end: `+=${String(desktop ? 130 : 110)}%`,
              pin: true,
              pinSpacing: true,
              scrub: 1,
              anticipatePin: 1,
              // Write the normalised seam-progress on every scrub tick — the
              // ONE-DIRECTIONAL GSAP->R3F value pass (ADR-004 G1). Task 4.4's
              // canvas reads it inside its own frame loop.
              onUpdate: (self) => {
                setSeamProgress(self.progress);
              },
            },
            defaults: { ease: 'none' },
          });

          // Phase 1 (0 -> 0.5): the brand block lifts and fades as the eye
          // moves to the car; the render settles toward its hero pose.
          tl.to(brand, { opacity: 0, y: -32, duration: 0.4 }, 0);
          if (cue) tl.to(cue, { opacity: 0, duration: 0.12 }, 0);
          tl.to(
            render,
            { scale: 1, yPercent: 0, duration: 0.6, ease: 'power2.out' },
            0,
          );

          // Phase 2 (0.45 -> 0.8): the track-line draws under the car — the
          // signal that the car is "landing" on the studio floor, the hand-off
          // cue into the configurator below.
          if (track) {
            tl.to(track, { scaleX: 1, duration: 0.3, ease: 'power2.out' }, 0.45);
          }

          // Phase 3 (0.8 -> 1): a faint settle — the pin releases into the
          // configurator section. (The actual canvas reveal is Task 4.4, gated
          // on seam-progress reaching ~1 AND the canvas reporting ready.)
          tl.to(render, { scale: 1.01, duration: 0.2, ease: 'power1.out' }, 0.8);

          return () => {
            tl.scrollTrigger?.kill();
            tl.kill();
            gsap.set(render, { clearProps: 'willChange' });
          };
        },
      );
    },
    [],
    { idle: true },
  );

  return (
    <section
      ref={scope}
      id="hero"
      aria-label={`${SHOP.name} — ${SHOP.tagline}`}
      className="relative isolate flex h-[100svh] w-full items-start justify-center overflow-hidden"
      style={{
        background:
          'radial-gradient(125% 95% at 50% 22%, var(--color-surface), var(--color-background) 70%)',
      }}
    >
      {/* Layer 2 + 3 — the render + the reserved SEAM MOUNT slot, stacked in one
          box so the live canvas (Task 4.4) lands exactly where the render is. */}
      <div
        data-hero-render
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-[1] flex h-[72%] items-end justify-center sm:h-[76%]"
      >
        <div className="relative h-full w-full max-w-[min(92vw,1440px)]">
          <HeroRender alt={carAlt} />

          {/* ===== SEAM BOUNDARY (ADR-004) =====================================
              The reserved mount point for the live R3F configurator canvas.
              Task 4.4 mounts the lazy, capability-gated <ConfiguratorCanvas />
              HERE, behind the static render, and crossfades it in on
              reveal-when-ready. Task 4.2 intentionally mounts NOTHING (no R3F)
              — it only reserves the identical box + carries the seam-progress
              writer (see the GSAP onUpdate above). Do not remove this slot.
              ================================================================= */}
          <div
            data-hero-seam-mount
            data-seam-status="placeholder"
            aria-hidden="true"
            className="absolute inset-0"
          />
        </div>
      </div>

      {/* Soft legibility scrim behind the brand block so the wordmark + copy
          always read over the render — biased to the upper field where the brand
          block sits, and pulled taller so the sub-copy + CTAs (which land toward
          the car's roofline) keep their contrast without overlapping the subject
          (PASS-B sub-copy fix). Subtle (premium-modern restraint), theme-aware. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{
          background:
            'linear-gradient(180deg, var(--color-background) 0%, var(--color-background) 22%, transparent 52%)',
          opacity: 0.85,
        }}
      />

      {/* Layer 4 — the brand DOM (the no-JS / SEO / a11y floor). Top-anchored in
          the clear upper field so the eyebrow/wordmark/sub-copy/CTAs sit ABOVE
          the grounded car rather than over its body (PASS-B sub-copy fix). The
          car owns the lower two-thirds; the brand owns the top. */}
      <div
        data-hero-brand
        className="relative z-10 mt-[max(7rem,16vh)] flex w-full flex-col items-center px-[var(--space-gutter,1.25rem)] text-center"
      >
        <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
          Electric. By the day.
        </p>

        <h1 className="font-display text-foreground mt-4 text-[length:var(--text-5xl)] leading-[var(--leading-tight)] font-bold tracking-[var(--tracking-tight)]">
          {SHOP.name}
        </h1>

        <p className="text-fg-muted mt-5 max-w-md text-[length:var(--text-lg)] text-balance">
          {SHOP.tagline} Configure your car, then reserve it in minutes.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#configurator"
            className="border-border text-foreground hover:border-border-strong hover:bg-surface focus-visible:ring-ring inline-flex h-11 items-center rounded-md border px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Configure the {HERO_VEHICLE.name}
          </a>
          <Link
            href={RESERVE_HREF}
            className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-11 items-center rounded-md px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Reserve a car
          </Link>
        </div>
      </div>

      {/* The track-line under the car (the brand spine landing on the floor). */}
      <div
        data-hero-track
        aria-hidden="true"
        className="absolute bottom-[18%] left-1/2 z-0 h-px w-[min(70vw,900px)] -translate-x-1/2"
        style={{ background: 'var(--gradient-track)' }}
      />

      {/* Scroll cue (D-19 / P1-NEW-2) — the track-line motif as a vertical
          thread with an accent charge descending it (the "track" the eye follows
          down into the configurator, tying into the art-directed section
          transition, D-08). The scroll is earned with MOTION, NOT a visible
          label: the prior "Scroll to configure" <span> read low-contrast over
          the car on mobile/no-JS, so it is removed from the visible affordance
          and kept only as an `sr-only` instruction for assistive tech.
          Reduced-motion: the descending charge is replaced by a static accent
          tick, and the global reduced-motion floor stills the keyframes. */}
      <div
        data-hero-cue
        className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center"
      >
        <span className="sr-only">Scroll down to configure your car</span>
        <span
          aria-hidden="true"
          className="relative block h-9 w-px overflow-hidden bg-[var(--color-track)]"
        >
          {/* The descending accent charge — travels the thread on a loop under
              motion; under reduced motion it rests as a static accent tick at the
              top of the thread. */}
          <span className="apex-scroll-charge bg-accent absolute inset-x-0 top-0 h-3 motion-reduce:h-1.5" />
        </span>
      </div>
    </section>
  );
}
