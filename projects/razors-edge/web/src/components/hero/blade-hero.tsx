'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useRef, type ReactNode } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';
import { HERO_DESKTOP, HERO_MOBILE } from '@/mocks';

import { Blade } from './blade';
import { HeroWordmark } from './hero-wordmark';

/**
 * The blade-sweep hero — the wow moment (ADR-004, Task 3.2 + 3.3).
 *
 * Layer model (back → front), all inside one pinned client component under
 * the low 'use client' boundary (ADR-002):
 *   1. Background field — themed CSS gradient (in the section bg).
 *   2. Portrait — next/image AVIF, `priority` (the LCP element), revealed
 *      in the gap as the wordmark halves part; a slow Ken-Burns scale push.
 *   3. Wordmark upper + lower halves — two real-DOM clip-path copies.
 *   4. Blade — inline SVG razor swept diagonally across the wordmark.
 *   5. Brass edge-glow — tracks the blade's leading point.
 *   6. Grain — the global GrainOverlay (mounted in the layout).
 *
 * Three-tier degradation (ADR-004) via `gsap.matchMedia` + a real-DOM floor:
 *   - Tier 1 (full): the pinned, scrubbed sweep → split → reveal → hand-off.
 *   - Tier 2 (reduced motion): NO pin/scrub/parallax — a static composed
 *     frame with the portrait already revealed; static brass highlight.
 *   - Tier 3 (no-JS / pre-hydration): the markup renders as a legible,
 *     composed final frame (wordmark over portrait), so SSR/SEO and no-JS
 *     users get a complete hero. GSAP only sets the *animated* initial
 *     state once it runs — it never gates the content.
 *
 * Performance contract: transform/opacity only; rAF-driven scrub; transient
 * `will-change` on the moving layers; portrait `priority` AVIF sized to its
 * box with a blur placeholder; CLS-safe transform pin (the section reserves
 * 100svh and the pin uses transforms, no layout shift).
 */
export function BladeHero(): ReactNode {
  const scope = useRef<HTMLElement>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const q = gsap.utils.selector(root);
      const upper = q('[data-hero-half="upper"]')[0] as HTMLElement | undefined;
      const lower = q('[data-hero-half="lower"]')[0] as HTMLElement | undefined;
      const portrait = q('[data-hero-portrait]')[0] as HTMLElement | undefined;
      const blade = q('[data-hero-blade]')[0] as HTMLElement | undefined;
      const glow = q('[data-hero-glow]')[0] as HTMLElement | undefined;
      const edge = q('[data-hero-edge]')[0] as HTMLElement | undefined;
      const cue = q('[data-hero-cue]')[0] as HTMLElement | undefined;
      const copy = q('[data-hero-copy]')[0] as HTMLElement | undefined;
      if (!upper || !lower || !portrait) return;

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

          // ---- Tier 2: reduced motion — static composed reveal -----------
          if (reduced) {
            // Part the halves to their resting revealed positions and show
            // the portrait; no pin, no scrub, no parallax. The shifts are
            // EQUAL-AND-OPPOSITE (top up, bottom down, same magnitude) in
            // glyph-box %: each glyph half is ~50% tall, so ~64% clears it
            // fully and opens a symmetric portrait gap on the cut line.
            gsap.set(portrait, { opacity: 1, scale: 1.03, filter: 'saturate(1)' });
            gsap.set(upper, { yPercent: -64 });
            gsap.set(lower, { yPercent: 64 });
            if (edge) gsap.set(edge, { opacity: 0.55 });
            if (blade) gsap.set(blade, { opacity: 0 });
            if (cue) gsap.set(cue, { opacity: 0.7 });
            return;
          }

          // ---- Tier 1: full scrubbed cinema ------------------------------
          // Part amount (in glyph-box %): EQUAL-AND-OPPOSITE — the upper half
          // slides up by `partShift`, the lower down by the SAME magnitude,
          // with zero horizontal component, so the two half-letters stay
          // mirror-aligned across the gap at every scrub progress (D-01 seam
          // integrity). A touch wider on desktop than mobile. Each glyph half
          // is ~50% tall, so these clear it fully and open a symmetric gap.
          const partShift = desktop ? 86 : 76;
          const bladeTravel = desktop ? 128 : 116; // vw-ish, in %.

          // Initial (joined) state — this is what the composed frame looks
          // like the instant before scroll: full wordmark, portrait dim,
          // blade staged off to the left.
          gsap.set(portrait, { opacity: 0.16, scale: 1.16, filter: 'saturate(0.7)' });
          gsap.set(upper, { yPercent: 0 });
          gsap.set(lower, { yPercent: 0 });
          if (blade) {
            // Stage the razor off to the left; the honed edge sits on the
            // wordmark's (now horizontal) cut line. No rotation — the cut is
            // a clean horizontal incision.
            gsap.set(blade, { xPercent: -bladeTravel, yPercent: -4, opacity: 0 });
          }
          if (glow) gsap.set(glow, { opacity: 0, xPercent: -60 });
          if (edge) gsap.set(edge, { opacity: 0.5 });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: root,
              start: 'top top',
              end: `+=${String(desktop ? 190 : 150)}%`,
              pin: true,
              pinSpacing: true,
              scrub: 1,
              anticipatePin: 1,
            },
            defaults: { ease: 'none' },
          });

          // Phase 1 — Sweep (0 → 0.45): blade crosses the wordmark; brass
          // glow tracks its leading point; the cue + copy fade out early.
          if (cue) tl.to(cue, { opacity: 0, duration: 0.06 }, 0);
          if (copy) tl.to(copy, { opacity: 0, y: -16, duration: 0.12 }, 0);
          if (blade) {
            tl.to(blade, { opacity: 1, duration: 0.05 }, 0.02).to(
              blade,
              { xPercent: bladeTravel, duration: 0.43, ease: 'power1.inOut' },
              0.02,
            );
          }
          if (glow) {
            tl.to(glow, { opacity: 1, duration: 0.05 }, 0.02).to(
              glow,
              { xPercent: 60, duration: 0.43, ease: 'power1.inOut' },
              0.02,
            );
          }
          if (edge) {
            tl.to(edge, { opacity: 1, duration: 0.2 }, 0.05);
          }

          // Phase 2 — Cut / split (0.45 → 0.5): the brass edge flares at the
          // crossing instant; the halves begin to part.
          if (edge) {
            tl.to(edge, { opacity: 1, scaleX: 1.04, duration: 0.05 }, 0.45);
          }

          // Phase 3 — Part + reveal (0.5 → 0.85): halves translate apart at
          // different rates; portrait reveals + Ken-Burns push; blade glides
          // off and fades.
          tl.to(
            upper,
            { yPercent: -partShift, duration: 0.4, ease: 'power2.out' },
            0.46,
          )
            .to(
              lower,
              { yPercent: partShift, duration: 0.4, ease: 'power2.out' },
              0.46,
            )
            .to(
              portrait,
              {
                opacity: 1,
                scale: 1.0,
                filter: 'saturate(1)',
                duration: 0.42,
                ease: 'power2.out',
              },
              0.46,
            );
          if (blade) {
            tl.to(blade, { opacity: 0, duration: 0.12 }, 0.5);
          }
          if (glow) {
            tl.to(glow, { opacity: 0, duration: 0.16 }, 0.55);
          }
          if (edge) {
            tl.to(edge, { opacity: 0.45, duration: 0.2 }, 0.6);
          }

          // Phase 4 — Hand-off (0.85 → 1): the composed frame settles; the
          // pin releases into the positioning section (the cut IS the
          // transition). A faint settle on the portrait.
          tl.to(portrait, { scale: 1.04, duration: 0.15, ease: 'power1.out' }, 0.85);

          return () => {
            tl.scrollTrigger?.kill();
            tl.kill();
          };
        },
      );

      // No isolated `ScrollTrigger.refresh()` here: `useGsapEffect` requests a
      // single coordinated global refresh once the last section has loaded.
      // Because the hero is `idle`-deferred it often loads AFTER downstream
      // sections; the coordinated refresh recomputes every downstream pin
      // (the gallery) against this hero pin once it finally exists.
    },
    [],
    { idle: true },
  );

  return (
    <section
      ref={scope}
      aria-label="Razor's Edge"
      className="relative isolate flex h-[100svh] w-full items-center justify-center overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 90% at 50% 18%, var(--hero-field-bottom), var(--hero-field-top) 72%)',
      }}
    >
      {/* Layer 2 — portrait (LCP). Art-directed: desktop landscape, mobile
          tall crop, via two <Image> elements toggled by CSS (sizes/hidden).
          `priority` so it is the LCP paint. */}
      <div
        data-hero-portrait
        className="pointer-events-none absolute inset-0 -z-[1] will-change-transform"
      >
        {/* Desktop / tablet crop. */}
        <Image
          src={HERO_DESKTOP.src}
          alt={HERO_DESKTOP.alt}
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          placeholder="blur"
          blurDataURL={HERO_DESKTOP.blurDataURL}
          className="hidden object-cover object-center sm:block"
        />
        {/* Mobile tall crop. NOT `priority` (D-15 / Home-Perf): the desktop
            crop owns the LCP preload; preloading BOTH crops wasted a preload
            on every viewport. On phones this crop is still above the fold so
            the browser fetches it eagerly, just without a duplicate
            `<link rel=preload>`. */}
        <Image
          src={HERO_MOBILE.src}
          alt={HERO_MOBILE.alt}
          fill
          sizes="100vw"
          placeholder="blur"
          blurDataURL={HERO_MOBILE.blurDataURL}
          className="block object-cover object-center sm:hidden"
        />
        {/* Vignette toward the ground so the wordmark reads over the photo. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 80% at 50% 42%, transparent 30%, var(--hero-vignette) 100%)',
          }}
        />
      </div>

      {/* Layers 3+4+5 — wordmark halves, blade, glow — composed centre. */}
      <div className="relative z-10 flex w-full flex-col items-center px-4">
        <HeroWordmark className="w-full max-w-[min(92vw,1100px)]" />

        {/* Blade + tracking brass glow share a track over the wordmark. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="relative h-full w-full max-w-[min(92vw,1100px)]">
            <div
              data-hero-blade
              className="absolute top-1/2 left-0 w-[52%] -translate-y-1/2 opacity-0 will-change-transform sm:w-[46%]"
            >
              <Blade />
            </div>
            {/* Brass edge-glow that tracks the blade's leading point. */}
            <div
              data-hero-glow
              className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 opacity-0 will-change-transform"
              style={{
                background:
                  'radial-gradient(circle, var(--color-edge-glow), transparent 65%)',
                filter: 'blur(14px)',
              }}
            />
          </div>
        </div>

        {/* Supporting copy + scroll cue — fade out as the sweep begins. */}
        <p
          data-hero-copy
          className="text-fg-muted relative z-10 mt-8 max-w-sm text-balance text-center text-[length:var(--text-body)] leading-relaxed sm:mt-10"
        >
          An upscale grooming studio. Cuts, shaves, and beard work, by
          appointment.
        </p>
      </div>

      {/* Scroll cue. */}
      <div
        data-hero-cue
        aria-hidden="true"
        className="text-fg-subtle absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5"
      >
        <span className="text-[length:var(--text-caption)] tracking-[0.18em] uppercase">
          Scroll
        </span>
        <ChevronDown className="size-4 animate-bounce" />
      </div>
    </section>
  );
}
