'use client';

import { useRef, type ReactNode } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';

/**
 * The six pinned bays wired into the scroll sequence (Task 4.2 / ADR-003).
 *
 * This is the ONLY client wrapper in the bay spine — it receives the six
 * server-rendered `ProjectBay` sections (+ the interleaved `Threshold`s) as
 * `children` (real DOM, the no-JS / reduced-motion floor) and ENHANCES them with
 * GSAP. Nothing here creates content; the bays read complete without it.
 *
 * ── THE SIX-PIN SPIKE (carried from ADR-002 / AGENT_NOTES) ──────────────────
 * The concern: seven sequential `pin: true` ScrollTriggers (hero + six bays) is a
 * real correctness + performance load (the razors-edge multiplied-pin lesson).
 * This module is designed so the choreography is transform/opacity-only,
 * rAF-scrubbed, with narrow transient `will-change`, and — crucially — so the
 * "tour" reading does NOT depend on literally pinning all six. The implemented
 * choreography (validated under `next build && next start`, see AGENT_NOTES Phase
 * 4):
 *
 *   - Each bay PINS for a short scrub (~0.6 viewport) during which its kinetic
 *     title RESOLVES (the hue ghost `clip-path`-wipes away while the final title's
 *     `font-variation-settings` weight settles) and its content reveals. The pin
 *     holds the bay in frame just long enough for the resolve to land, then
 *     releases into the threshold seam to the next bay.
 *   - The threshold BETWEEN bays parallaxes (its hue wash drifts up) so the
 *     bay-to-bay transition reads as moving through a lit doorway.
 *
 * The pin is SHORT and cheap (one timeline per bay, transform/opacity only). If a
 * profile ever fails the 60 fps bar, the documented fallback is a one-line switch:
 * set `PIN_BAYS = false` below — the bays then scroll-REVEAL (same title resolve,
 * same threshold parallax) WITHOUT a pin, which removes the six pin-spacers
 * entirely while keeping the tour reading. The hero pin always stays.
 *
 * SPIKE OUTCOME (verified under `next build && next start`, headless Chromium,
 * AGENT_NOTES Phase 4): all SEVEN pins hold — 7 pin-spacers on desktop (hero + 6
 * bays), the refresh-coordinator sort ordering kept every bay from pinning early;
 * frame timing held ~60 fps through the full scroll (p95 18 ms, only 3 frames over
 * 32 ms across 160, and the single 125 ms spike is the one-off GSAP-chunk attach,
 * not a per-frame scrub cost); 0 CSP violations, 0 page errors. So `PIN_BAYS` ships
 * `true` — the full pinned tour. The fallback stays wired for future profiles.
 *
 * ── THE REFRESH-COORDINATOR (load-bearing — ADR-002) ────────────────────────
 * `useGsapEffect` calls `requestGlobalRefresh()` after this setup, which debounces
 * to ONE `ScrollTrigger.sort()`-BEFORE-`refresh()`. With the hero pin frequently
 * created LAST (it is `{ idle: true }`-deferred) and six downstream bay pins, the
 * sort guarantees every upstream pin-spacer is measured before each downstream bay
 * — so no bay pins too early (the razors-edge gallery-early-pin bug ×6).
 *
 * ── THREE-TIER DEGRADATION via `gsap.matchMedia()` ──────────────────────────
 *   - `reduced` — creates NOTHING. The bays sit at their composed resting frame
 *     (title resolved, content shown) and scroll normally. Nothing frozen.
 *   - `desktop` — the full pinned resolve per bay.
 *   - `mobile` — NO pin (phones get the clean vertical stack the PLAN mandates):
 *     a cheap reveal-on-enter title resolve as each bay scrolls in, no pin-spacers,
 *     so the bay choreography stays legible and 60 fps on a phone.
 */

/**
 * Whether the bays PIN on desktop (full cinema) or scroll-REVEAL without a pin
 * (the documented lighter fallback). Flipped by the six-pin spike outcome — see
 * the module doc + AGENT_NOTES. `true` ships the full pinned tour; `false` is the
 * one-line fallback if a profile fails the 60 fps bar.
 */
const PIN_BAYS = true;

interface BaysSequenceProps {
  children: ReactNode;
}

export function BaysSequence({ children }: BaysSequenceProps): ReactNode {
  const scope = useRef<HTMLDivElement | null>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const mm = gsap.matchMedia();

      const bays = gsap.utils.toArray<HTMLElement>('[data-bay]', root);

      /**
       * Build one bay's resolve timeline. Used by both the pinned (desktop) and
       * the unpinned reveal (mobile) branches — same composition lands either way.
       */
      const buildBayTimeline = (bay: HTMLElement, scrub: boolean) => {
        const ghost = bay.querySelector<HTMLElement>('[data-bay-title-ghost]');
        const final = bay.querySelector<HTMLElement>('[data-bay-title-final]');
        const reveals = gsap.utils.toArray<HTMLElement>(
          '[data-bay-reveal]',
          bay,
        );
        const wash = bay.querySelector<HTMLElement>('[data-bay-wash]');

        // Arm the bay so the ghost starts lit (CSS `[data-bay-armed]`), then set
        // the unresolved START state. Transform/opacity + clip-path + the variable
        // font axis only — no layout property animates (CLS-safe).
        bay.setAttribute('data-bay-armed', '');

        const moving: HTMLElement[] = [];
        if (ghost) moving.push(ghost);
        if (final) moving.push(final);
        moving.push(...reveals);
        if (wash) moving.push(wash);
        gsap.set(moving, { willChange: 'transform, opacity, clip-path' });

        if (ghost) {
          // The hue ghost starts fully revealed; the scrub wipes it left-to-right.
          gsap.set(ghost, {
            clipPath: 'inset(0% 0% 0% 0%)',
            autoAlpha: 1,
          });
        }
        if (final) {
          // The final title resolves IN from a clip on the left + a lighter weight
          // that settles up to the resting weight.
          gsap.set(final, {
            clipPath: 'inset(0% 100% 0% 0%)',
            fontVariationSettings:
              "'opsz' 144, 'wght' var(--display-wght-light), 'SOFT' 0",
          });
        }
        gsap.set(reveals, { autoAlpha: 0, y: 18 });
        if (wash) gsap.set(wash, { autoAlpha: 0 });

        const clearWillChange = () =>
          gsap.set(moving, { willChange: 'auto' });

        const pinned = scrub && PIN_BAYS;
        const scrollTrigger: ScrollTrigger.Vars = {
          trigger: bay,
          start: scrub ? 'top top' : 'top 78%',
          end: scrub ? () => `+=${String(window.innerHeight * 0.6)}` : 'top 38%',
          scrub: scrub ? 0.5 : false,
          pin: pinned,
          pinSpacing: pinned,
          anticipatePin: pinned ? 1 : 0,
          invalidateOnRefresh: true,
          onLeave: clearWillChange,
          onLeaveBack: clearWillChange,
        };
        // toggleActions only applies to the non-scrubbed (reveal-on-enter) path;
        // omitted entirely for the scrubbed path (exactOptionalPropertyTypes).
        if (!scrub) {
          scrollTrigger.toggleActions = 'play none none reverse';
        }

        const tl = gsap.timeline({ scrollTrigger });

        // The wash pools up first — the room lights.
        if (wash) {
          tl.to(wash, { autoAlpha: 1, ease: 'power1.out', duration: 0.4 }, 0);
        }
        // The hue ghost wipes away to the right as the final resolves in from the
        // left — the title "resolves from its stack-coloured signature into a
        // legible title" (PLAN / ADR-003).
        if (ghost) {
          tl.to(
            ghost,
            {
              clipPath: 'inset(0% 0% 0% 100%)',
              autoAlpha: 0,
              ease: 'power2.inOut',
              duration: 0.55,
            },
            0.05,
          );
        }
        if (final) {
          tl.to(
            final,
            {
              clipPath: 'inset(0% 0% 0% 0%)',
              fontVariationSettings:
                "'opsz' 144, 'wght' var(--display-wght), 'SOFT' 0",
              ease: 'power2.out',
              duration: 0.6,
            },
            0.05,
          );
        }
        // The supporting content reveals in a gentle stagger after the title.
        tl.to(
          reveals,
          {
            autoAlpha: 1,
            y: 0,
            ease: 'power2.out',
            duration: 0.5,
            stagger: 0.08,
          },
          0.25,
        );

        // For the non-scrub (mobile reveal) path the timeline plays once on enter
        // and is not scrubbed; clear will-change when it finishes.
        if (!scrub) {
          tl.eventCallback('onComplete', clearWillChange);
        }
      };

      // The threshold seams BETWEEN bays parallax (their hue wash drifts up) so
      // the bay-to-bay transition reads as moving through a lit doorway. Cheap —
      // a single yPercent tween per seam, transform only.
      const buildThresholdParallax = () => {
        const thresholds = gsap.utils.toArray<HTMLElement>(
          '[data-threshold]',
          root,
        );
        thresholds.forEach((seam) => {
          gsap.fromTo(
            seam,
            { yPercent: 6 },
            {
              yPercent: -6,
              ease: 'none',
              scrollTrigger: {
                trigger: seam,
                start: 'top bottom',
                end: 'bottom top',
                scrub: 0.4,
                invalidateOnRefresh: true,
              },
            },
          );
        });
      };

      // Tier 2 — reduced motion: create NOTHING. The bays sit at their composed
      // resting frame (title resolved by CSS, content shown) and scroll normally.
      mm.add('(prefers-reduced-motion: reduce)', () => {
        // Intentionally empty: reduced motion creates no GSAP work at all.
      });

      // Tier 1 — desktop: the full pinned (or reveal-fallback) resolve per bay +
      // the threshold parallax.
      mm.add(
        '(prefers-reduced-motion: no-preference) and (min-width: 768px)',
        () => {
          bays.forEach((bay) => {
            buildBayTimeline(bay, true);
          });
          buildThresholdParallax();
        },
      );

      // Tier 1 — mobile: NO pin (the clean vertical stack the PLAN mandates). Each
      // bay reveals on enter; the threshold parallax is dropped (cheap on phones).
      mm.add(
        '(prefers-reduced-motion: no-preference) and (max-width: 767px)',
        () => {
          bays.forEach((bay) => {
            buildBayTimeline(bay, false);
          });
        },
      );

      // Teardown: the enclosing `gsap.context()` (from `useGsapEffect`) reverts
      // every animation, ScrollTrigger, and `matchMedia` context this setup
      // created (StrictMode-safe). The only bay-specific state to undo is the
      // `data-bay-armed` flag we set on each bay (a DOM attribute, outside GSAP's
      // revert), so the bays return to their calm composed resting frame.
      return () => {
        bays.forEach((bay) => {
          bay.removeAttribute('data-bay-armed');
        });
      };
    },
    [],
  );

  return (
    <div ref={scope} data-bays-sequence>
      {children}
    </div>
  );
}
