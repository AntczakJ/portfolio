'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { loadGsap } from '@/lib/gsap/register';

/**
 * GSAP step-enter transition for the wizard panel (Task 5.4 / ADR-002).
 *
 * ADR-002 bans Motion by default: wizard step transitions use GSAP/CSS, not
 * `AnimatePresence`. Rather than an exit-before-unmount (which is what Motion
 * buys and what CSS+GSAP cannot do cleanly without orchestration), apex uses a
 * simpler, robust model that reads as designed: the panel content swaps
 * instantly on a step change (React unmount/mount), and the INCOMING panel
 * plays a short directional enter (slide + fade). This is the Linear register —
 * a quick, confident settle, not a heavy cross-dissolve — and it never leaves a
 * step half-unmounted.
 *
 * - Transform/opacity only; `will-change` set transiently then cleared.
 * - Direction-aware: forward steps enter from the right, back from the left.
 * - Reduced-motion: NO travel and NO fade — the content is simply present
 *   (the `gsap.matchMedia` reduced branch does nothing), honouring the floor.
 * - Deferred GSAP load (the panel is already real DOM); if JS never runs the
 *   content is fully visible.
 *
 * `stepKey` changes on every step change; `direction` is +1 forward / -1 back.
 */
export function useStepTransition(
  scope: RefObject<HTMLElement | null>,
  stepKey: string,
  direction: number,
): void {
  const dirRef = useRef(direction);
  dirRef.current = direction;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void loadGsap().then(({ gsap }) => {
      if (cancelled || !scope.current) return;
      const el = scope.current;
      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          // Reduced motion: leave the content exactly as rendered (no flash).
          if (ctx.conditions?.reduced) return;
          const fromX = dirRef.current >= 0 ? 24 : -24;
          gsap.fromTo(
            el,
            { opacity: 0, x: fromX, willChange: 'transform, opacity' },
            {
              opacity: 1,
              x: 0,
              duration: 0.42,
              ease: 'power3.out',
              clearProps: 'willChange',
            },
          );
        },
      );
      cleanup = () => { mm.revert(); };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Re-run only on a step change (the panel content has already swapped).
  }, [scope, stepKey]);
}
