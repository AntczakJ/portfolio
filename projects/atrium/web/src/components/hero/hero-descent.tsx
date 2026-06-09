'use client';

import { useRef, type ReactNode } from 'react';

import { LightShaft } from '@/components/atmosphere/light-field';
import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';

import { Colonnade } from './colonnade';

/**
 * THE WOW MOMENT — the hero threshold + pinned descent (Task 3.2 + 3.3).
 *
 * STRUCTURE / CLS-SAFETY (ADR-002). The hero is a `min-h-[100svh]` section whose
 * resting frame — the `ATRIUM` wordmark lit in the warm shaft, the one-liner, the
 * scroll cue — is REAL SERVER DOM passed in as `children`. That resting frame is:
 *   - the LCP element (type/CSS-light, never an image — ADR-003 / CWV);
 *   - the reduced-motion Tier-2 frame (the composed resting state, nothing frozen);
 *   - the no-JS Tier-3 frame (it renders identically with GSAP never loading).
 * GSAP only ENHANCES this. The pin reserves its footprint via ScrollTrigger's
 * pin-spacer and animates transform/opacity only — no layout property animates,
 * so CLS stays < 0.1.
 *
 * THE DESCENT (full-motion tier). A single `{ idle: true }` `useGsapEffect`
 * builds one pinned, scrubbed timeline over ~1.3 viewports:
 *   - Phase A (0 → ~0.55): the wordmark SCALES UP past the camera and fades — the
 *     viewer "drops through the letterforms" — while the supporting copy + cue
 *     fade out first. Kinetic: the wordmark's `font-variation-settings` weight
 *     eases from its resting weight up to the bold axis as it grows (the
 *     no-Club-plugin variable-font technique, ADR-002), so the letters thicken as
 *     they rush past, not merely scale.
 *   - Phase B (~0.25 → 1): the atrium-of-light colonnade parallaxes UP into frame
 *     (three planes at different rates → depth) and the warm shaft widens from a
 *     single beam into the lit hall, RESOLVING into the colonnade filling the
 *     frame. The descent IS the transition: at scrub end the next section (bay 1)
 *     is already arriving beneath the unpinned hero — the scroll never stalls on a
 *     finished animation (ADR-003 hand-off).
 *
 * THREE-TIER DEGRADATION via `gsap.matchMedia()` (Task 3.3):
 *   - `reduced` — NO pin, NO scrub, NO parallax. The callback creates nothing, so
 *     the page lands on the composed resting frame and scrolls normally. The CSS
 *     idle shaft-drift + cue-bob are already disabled by the globals.css
 *     reduced-motion floor. Nothing is frozen mid-transition.
 *   - `desktop` (full descent) / `mobile` (a lighter descent — a shorter pin,
 *     gentler scale, the far colonnade plane dropped — so phones stay at 60 fps
 *     and cheap). Both land cleanly; the mobile branch is the documented "simplify
 *     on small widths" path (ADR-002/003).
 *
 * PERFORMANCE (ADR-002). Transform/opacity only; `will-change` is added at scrub
 * start and removed on completion (narrow + transient — never blanket on the big
 * gradient surfaces); the scrub is rAF-driven by ScrollTrigger (no scroll
 * listeners, no long tasks). The refresh runs through the coordinator
 * (`useGsapEffect` calls `requestGlobalRefresh()` → `sort()` before `refresh()`),
 * so the hero's pin-spacer is measured before the downstream bays (load-bearing
 * with seven pins — ADR-002).
 */

interface HeroDescentProps {
  children: ReactNode;
}

export function HeroDescent({ children }: HeroDescentProps): ReactNode {
  const scope = useRef<HTMLDivElement | null>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const mm = gsap.matchMedia();

      const buildDescent = (opts: {
        scale: number;
        pin: number; // pin length as a multiple of the viewport
        farPlane: boolean;
        camZ: number; // how far the camera travels into the hall (CSS-3D px)
        restHint: number; // multiplier on the faint resting colonnade opacity
      }) => {
        const root = scope.current;
        if (!root) return;

        // Resting frame is already composed; set transient will-change on just
        // the elements that move, cleared on completion.
        const moving = root.querySelectorAll<HTMLElement>('[data-descent-move]');
        gsap.set(moving, { willChange: 'transform, opacity' });

        // The CSS resting dim on [data-colonnade] keeps the no-JS/reduced/first
        // frame calm; under the full cinema the per-plane opacity below is the
        // source of truth, so lift the parent to full and let the planes drive it.
        gsap.set('[data-colonnade]', { opacity: 1 });
        gsap.set('[data-colonnade-stage]', { willChange: 'transform' });

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: () => `+=${String(window.innerHeight * opts.pin)}`,
            scrub: 0.6,
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onLeave: () => {
              gsap.set(moving, { willChange: 'auto' });
              gsap.set('[data-colonnade-stage]', { willChange: 'auto' });
            },
            onLeaveBack: () => {
              gsap.set(moving, { willChange: 'auto' });
              gsap.set('[data-colonnade-stage]', { willChange: 'auto' });
            },
          },
        });

        // ── D-02 re-choreography. Motion is CONTINUOUS across the WHOLE 0→1 scrub
        // — no dead frame on the back half. The spine is the CAMERA: the colonnade
        // stage travels forward in Z for the entire pin (the "falling down the
        // hall" the descent IS), so every scrub position composes. Phase A
        // (wordmark drop) overlaps the start of that travel; the floor pool bloom
        // + plane depth-stagger + shaft widen fill the middle and back so the
        // descent flows wordmark → colonnade depth → hand-off into bay 1 with no
        // stall (PLAN/ADR-003: the scroll never stalls on a finished animation).

        // The CAMERA — the colonnade stage pushes forward in Z across the FULL
        // scrub (0 → 1). This is the load-bearing continuous motion; it starts
        // immediately and never finishes early, so there is no stall.
        tl.fromTo(
          '[data-colonnade-stage]',
          { z: 0 },
          { z: opts.camZ, duration: 1 },
          0,
        );

        // Phase A (0 → ~0.4) — the supporting copy + cue clear first.
        tl.to(
          '[data-descent-aux]',
          { autoAlpha: 0, y: -24, ease: 'power1.in', duration: 0.28 },
          0,
        );

        // Phase A — the wordmark scales up past the camera + thickens (kinetic
        // weight) + fades: "dropping through the letterforms". Completes ~0.4 but
        // the camera keeps travelling, so the frame keeps composing past it.
        tl.to(
          '[data-descent-wordmark]',
          {
            scale: opts.scale,
            autoAlpha: 0,
            ease: 'power2.in',
            duration: 0.42,
            fontVariationSettings: "'opsz' 144, 'wght' 600, 'SOFT' 0",
          },
          0,
        );

        // Phase B — the colonnade rows reveal STAGGERED BY DEPTH (far leads, near
        // trails — fixes the "all planes arrive together so they read flat" timing
        // note). The far plane comes up first as the camera starts moving; the near
        // columns arrive last as the camera reaches them. OPACITY ONLY here — the
        // columns own a CSS-3D `transform` (their translateZ placement), so the
        // descent must NOT animate their transform (that would clobber the depth
        // placement); the camera Z-travel above provides all the column motion.
        // The `from` is a faint resting hint (not 0), so the hero FIRST frame
        // already implies a colonnade behind the wordmark (the atrium-specific
        // resting signal, D-14) rather than a bare shaft — then the descent
        // brings the hall fully up.
        // `hint` scales the faint resting opacity — lower on the mobile branch so
        // the columns do NOT crowd the type under ATRIUM at 320-360px (D-11).
        const h = opts.restHint;
        tl.fromTo(
          '[data-colonnade-plane="3"]',
          { autoAlpha: 0.22 * h },
          { autoAlpha: 1, ease: 'power1.out', duration: 0.45 },
          0.08,
        );
        tl.fromTo(
          '[data-colonnade-plane="2"]',
          { autoAlpha: 0.16 * h },
          { autoAlpha: 1, ease: 'power1.out', duration: 0.5 },
          0.24,
        );
        tl.fromTo(
          '[data-colonnade-plane="1"]',
          { autoAlpha: 0.12 * h },
          { autoAlpha: 1, ease: 'power1.out', duration: 0.55 },
          0.42,
        );

        // Phase B — the floor light POOL blooms up through the back half (the
        // second beat the critique asked for so the back ~40% is not dead air):
        // the warm light at the end of the hall rises as the camera approaches it.
        tl.fromTo(
          '[data-colonnade-floor]',
          { autoAlpha: 0.2 },
          { autoAlpha: 1, ease: 'power1.inOut', duration: 0.7 },
          0.35,
        );

        // Phase B — the single shaft widens into the lit hall, resolving late so
        // the final frame is the colonnade fully open as bay 1 arrives beneath.
        tl.fromTo(
          '[data-descent-shaft]',
          { scaleX: 1, autoAlpha: 0.9 },
          { scaleX: 1.7, autoAlpha: 0.4, ease: 'power1.out', duration: 0.9 },
          0.25,
        );

        if (!opts.farPlane) {
          // On the lighter mobile branch the far back-wall glow is dropped from
          // the reveal set so phones do the same stagger with fewer layers.
          gsap.set('[data-colonnade-plane="3"]', { autoAlpha: 1 });
        }
      };

      // Tier 2 — reduced motion: create NOTHING. Land on the composed resting
      // frame; scroll is normal. (No pin / scrub / parallax / frozen frame.)
      mm.add('(prefers-reduced-motion: reduce)', () => {
        // Intentionally empty: reduced motion creates no GSAP work at all.
      });

      // Tier 1 — full motion, desktop: the full descent. The pin length is
      // matched to the choreography (the camera travels for the WHOLE pin), so
      // there is no finished-animation dead frame (D-02).
      mm.add(
        '(prefers-reduced-motion: no-preference) and (min-width: 768px)',
        () => {
          buildDescent({
            scale: 3.4,
            pin: 1.2,
            farPlane: true,
            camZ: 900,
            restHint: 1,
          });
        },
      );

      // Tier 1 — full motion, mobile: lighter descent (shorter pin, gentler
      // scale, far back-wall glow dropped, less camera travel) so phones hold
      // 60 fps. Same continuous-camera spine, so no stall on mobile either.
      mm.add(
        '(prefers-reduced-motion: no-preference) and (max-width: 767px)',
        () => {
          buildDescent({
            scale: 2.4,
            pin: 0.9,
            farPlane: false,
            camZ: 620,
            restHint: 0.4,
          });
        },
      );
    },
    [],
    { idle: true },
  );

  return (
    <div ref={scope} data-hero-descent className="relative">
      <section
        id="top"
        aria-label="Atrium — the portfolio of Jan Antczak"
        className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 text-center"
      >
        {/* The colonnade — behind the wordmark, parallaxed in by the descent. At
            the resting frame it is a faint implied depth; the scrub resolves it. */}
        <Colonnade />

        {/* The directed warm shaft that lights the wordmark; the descent widens it
            into the hall. The CSS idle drift breathes it (disabled under reduced
            motion by the globals.css floor). */}
        <div
          data-descent-shaft
          data-descent-move
          className="atrium-shaft-drift pointer-events-none absolute inset-0 -z-0"
        >
          <LightShaft />
        </div>

        {/* The composed content — REAL DOM (LCP + reduced-motion + no-JS floor).
            `children` is the server-rendered wordmark + copy + cue. */}
        <div className="relative z-10 flex flex-col items-center">{children}</div>
      </section>
    </div>
  );
}
