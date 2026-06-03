'use client';

import { useRef, type RefObject } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';

/**
 * Reusable scroll-reveal for the long-form sections (Phase 4).
 *
 * Animates every element marked `[data-reveal]` inside the scope from a
 * small downward offset + fade to its resting position as the section
 * scrolls into view — kinetic but restrained (PLAN.md), transform/opacity
 * only (ADR-002 performance contract). Children stagger; the easing is the
 * Stripe/Linear register (`cubic-bezier(0.16, 1, 0.3, 1)` family, here
 * `power3.out`) so the reveal reads as designed, not merely animated.
 *
 * GSAP per ADR-002 (scroll = GSAP), authored inside `useGSAP` with a
 * `gsap.matchMedia` reduced-motion branch: under reduced motion every
 * element is simply set to its resting state (no transform, full opacity) —
 * the content always reads, the motion is additive. Cleanup is automatic
 * via the `useGSAP` scope.
 *
 * Returns the scope ref to spread on the section container; mark the
 * children to reveal with `data-reveal` (optionally `data-reveal-index` for
 * a deliberate stagger order, otherwise DOM order is used).
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(options?: {
  /** Stagger between successive items (s). */
  stagger?: number;
  /** Initial downward offset (px). */
  y?: number;
  /** ScrollTrigger start (default fires a little before the section centres). */
  start?: string;
}): RefObject<T | null> {
  const scope = useRef<T>(null);
  // ~80ms stagger (D-14): the section-header kicker / display / deck each
  // carry `data-reveal`, so SectionHeading entrances stagger in this register.
  const { stagger = 0.08, y = 26, start = 'top 82%' } = options ?? {};

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const items = gsap.utils.toArray<HTMLElement>(
        root.querySelectorAll('[data-reveal]'),
      );
      if (items.length === 0) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const reduced = ctx.conditions?.reduced ?? false;
          if (reduced) {
            gsap.set(items, { opacity: 1, y: 0, clearProps: 'willChange' });
            return;
          }

          gsap.set(items, { opacity: 0, y, willChange: 'transform, opacity' });
          gsap.to(items, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            stagger,
            scrollTrigger: {
              trigger: root,
              start,
            },
            onComplete: () => gsap.set(items, { clearProps: 'willChange' }),
          });
        },
      );
    },
    [stagger, y, start],
  );

  return scope;
}
