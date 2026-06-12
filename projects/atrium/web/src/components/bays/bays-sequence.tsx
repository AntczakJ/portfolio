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
       *
       * D-16: the resolve VARIES per bay (`i`) so the tour reads as authored, not
       * the same beat six times. The clip-wipe direction alternates (odd bays wipe
       * from the right), the supporting reveal direction alternates (odd bays rise,
       * even bays drift in from the side), and the stagger amount alternates — all
       * derived deterministically from the bay's ordinal (no randomness).
       */
      const buildBayTimeline = (bay: HTMLElement, i: number, scrub: boolean) => {
        const ghost = bay.querySelector<HTMLElement>('[data-bay-title-ghost]');
        const final = bay.querySelector<HTMLElement>('[data-bay-title-final]');
        const edge = bay.querySelector<HTMLElement>('[data-bay-title-edge]');
        const reveals = gsap.utils.toArray<HTMLElement>(
          '[data-bay-reveal]',
          bay,
        );
        const wash = bay.querySelector<HTMLElement>('[data-bay-wash]');

        // Per-bay reveal variation (D-16) — deterministic off the ordinal.
        const fromLeft = i % 2 === 0; // even bays wipe L→R, odd bays R→L
        const revealAxis: 'y' | 'x' = i % 2 === 0 ? 'y' : 'x';
        const revealFrom = i % 2 === 0 ? 18 : i % 4 === 1 ? 28 : -28;
        const stagger = 0.06 + (i % 3) * 0.03;

        // D-15: the title's compositional layout drives the wipe AXIS so the
        // gesture reads with the room, not against it. The centred-specimen bays
        // (razors-edge/atlas, ordinal cycle index 2) wipe VERTICALLY (a curtain
        // rising); the left/right wall bays wipe HORIZONTALLY in their reveal
        // direction. Deterministic off the same ordinal the layout selector uses.
        const cycle = i % 3; // 0 left · 1 right · 2 centre
        const wipeAxis: 'x' | 'y' = cycle === 2 ? 'y' : 'x';
        // The clip-path the FINAL title starts fully clipped at, and the matching
        // start/end edge positions for the travelling wipe band, per axis +
        // direction. Horizontal wall bays reveal in their `fromLeft` direction; the
        // centred curtain always rises (bottom → top).
        const clipHidden =
          wipeAxis === 'y'
            ? 'inset(0% 0% 100% 0%)' // hidden = clipped from the bottom (rises up)
            : fromLeft
              ? 'inset(0% 100% 0% 0%)' // hidden = clipped from the right (reveals L→R)
              : 'inset(0% 0% 0% 100%)'; // hidden = clipped from the left (reveals R→L)
        const clipOpen = 'inset(0% 0% 0% 0%)';

        // Arm the bay so the ghost starts lit (CSS `[data-bay-armed]`), then set
        // the unresolved START state. Transform/opacity + clip-path + the variable
        // font axis only — no layout property animates (CLS-safe).
        bay.setAttribute('data-bay-armed', '');

        const moving: HTMLElement[] = [];
        if (ghost) moving.push(ghost);
        if (final) moving.push(final);
        if (edge) moving.push(edge);
        moving.push(...reveals);
        if (wash) moving.push(wash);
        gsap.set(moving, { willChange: 'transform, opacity, clip-path' });

        if (ghost) {
          // D-15: the hue ghost is the title in its signature colour, fully shown
          // and UN-clipped at the unresolved start. It is wiped away along the SAME
          // axis the final reveals along, so the eye reads ONE continuous clip wipe
          // (hue swept off → legible title swept in) rather than two competing
          // crossfades. (Was: ghost wiped on `fromLeft` only, decoupled from the
          // final's clip — which read as a tint swap, not a gesture.)
          gsap.set(ghost, {
            clipPath: clipOpen,
            autoAlpha: 1,
          });
        }
        if (final) {
          // D-15: the final title starts THIN (light axis, narrow opsz) and FULLY
          // CLIPPED along the wipe axis, then the clip travels fully open while the
          // weight settles up to the BOLD resting axis — a committed clip WIPE
          // (the leading edge sweeps the whole word) layered with the 320 → 600
          // weight/opsz settle, so each bay resolves with an unmistakable gesture
          // (Aristide Benoist kinetic type), not a near-invisible tint settle.
          gsap.set(final, {
            clipPath: clipHidden,
            fontVariationSettings:
              "'opsz' 100, 'wght' var(--display-wght-light), 'SOFT' 0",
          });
        }
        if (edge) {
          // The travelling WIPE EDGE — a thin bright hue band that rides the clip
          // front across the word as it resolves, so the wipe is legible as MOTION
          // even at display scale (the gesture the eye locks onto). It starts at
          // the leading edge (clip front) and sweeps to the trailing edge, fading
          // out as the title finishes. Same axis/direction as the title clip.
          gsap.set(edge, {
            clipPath: clipHidden,
            autoAlpha: 0,
          });
        }
        gsap.set(reveals, {
          autoAlpha: 0,
          ...(revealAxis === 'y' ? { y: revealFrom } : { x: revealFrom }),
        });
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
        // D-15 — the committed clip WIPE. The hue ghost is swept OFF along the wipe
        // axis (its clip closing to the trailing edge — the inverse of the final's
        // opening clip) so the hue retreats exactly as the legible title arrives,
        // reading as one wipe front travelling across the word, not two crossfades.
        if (ghost) {
          // The ghost's "off" clip is the COMPLEMENT of the final's hidden clip:
          // wherever the final is still clipped, the ghost still shows (the hue),
          // and the moving boundary is shared — one front.
          const ghostOff =
            wipeAxis === 'y'
              ? 'inset(100% 0% 0% 0%)' // swept up off the top
              : fromLeft
                ? 'inset(0% 0% 0% 100%)' // swept off to the right (L→R front)
                : 'inset(0% 100% 0% 0%)'; // swept off to the left (R→L front)
          tl.to(
            ghost,
            {
              clipPath: ghostOff,
              ease: 'power2.inOut',
              duration: 0.58,
            },
            0.05,
          );
        }
        if (final) {
          // Settle the clip fully OPEN (the wipe front sweeps the whole word) AND
          // the weight up to the BOLD resting axis — the clip wipe layered with the
          // 320 → 600 weight/opsz settle (D-15). Matches the no-JS resting weight so
          // the cinema and the floor agree on the resolved frame.
          tl.to(
            final,
            {
              clipPath: clipOpen,
              fontVariationSettings:
                "'opsz' 144, 'wght' var(--display-wght-bold), 'SOFT' 0",
              ease: 'expo.out',
              duration: 0.62,
            },
            0.05,
          );
        }
        // The travelling WIPE EDGE band rides the shared front: it appears at the
        // leading edge, sweeps fully across as the title resolves, and fades out as
        // it reaches the trailing edge — the bright hue line the eye reads as the
        // gesture. Slightly faster than the title clip so it leads the front.
        if (edge) {
          tl.to(edge, { autoAlpha: 1, ease: 'power1.out', duration: 0.14 }, 0.05);
          tl.to(
            edge,
            { clipPath: clipOpen, ease: 'expo.out', duration: 0.56 },
            0.05,
          );
          tl.to(
            edge,
            { autoAlpha: 0, ease: 'power1.in', duration: 0.16 },
            0.5,
          );
        }
        // The supporting content reveals in a per-bay stagger + direction (D-16)
        // after the title — `y` rise on even bays, `x` drift on odd bays.
        tl.to(
          reveals,
          {
            autoAlpha: 1,
            ...(revealAxis === 'y' ? { y: 0 } : { x: 0 }),
            ease: 'power2.out',
            duration: 0.5,
            stagger,
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
          bays.forEach((bay, i) => {
            buildBayTimeline(bay, i, true);
          });
          buildThresholdParallax();
        },
      );

      // Tier 1 — mobile: NO pin (the clean vertical stack the PLAN mandates). Each
      // bay reveals on enter; the threshold parallax is dropped (cheap on phones).
      mm.add(
        '(prefers-reduced-motion: no-preference) and (max-width: 767px)',
        () => {
          bays.forEach((bay, i) => {
            buildBayTimeline(bay, i, false);
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
