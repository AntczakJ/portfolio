'use client';

import type { Transition, Variants } from 'motion/react';

/**
 * Motion config for the wizard step transitions (ADR-002).
 *
 * This is the ONE place Motion earns its bundle in the project: the
 * AnimatePresence enter/exit of each step panel as the Zustand `step`
 * changes. Per the ADR-002 boundary, NO scroll work is authored in Motion
 * (`useScroll`/`useTransform` are banned) — Motion is strictly for
 * React-state component transitions, which this is.
 *
 * Reduced motion is honoured by the consumer via `useReducedMotion()`:
 * when reduced, the variants collapse to opacity-only with a ~0s duration
 * (instant, no transform), matching the global reduced-motion floor.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

export const STEP_TRANSITION: Transition = {
  duration: 0.42,
  ease: EASE_OUT,
};

/**
 * Directional step variants. `direction` is +1 advancing (new step slides
 * up from below + fades in; old slides up + out) and −1 going back (mirror).
 * A subtle vertical drift + fade reads as "the next chair settling in",
 * on-brand and quiet (Linear's micro-interaction register), never a loud
 * horizontal carousel swipe.
 */
export function makeStepVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 1 },
      initial: { opacity: 0 },
      exit: { opacity: 0 },
    };
  }
  return {
    initial: (direction: number) => ({
      opacity: 0,
      y: direction >= 0 ? 18 : -18,
      filter: 'blur(2px)',
    }),
    enter: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: STEP_TRANSITION,
    },
    exit: (direction: number) => ({
      opacity: 0,
      y: direction >= 0 ? -14 : 14,
      filter: 'blur(2px)',
      transition: { duration: 0.26, ease: EASE_IN },
    }),
  };
}
