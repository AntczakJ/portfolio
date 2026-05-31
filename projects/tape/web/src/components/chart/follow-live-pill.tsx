'use client';

/**
 * <FollowLivePill /> — clickable pill that snaps the chart's scroll
 * back to the live right edge when the user has scrolled away from
 * `scrollX === 0` (Phase 3.2).
 *
 * Behaviour:
 *   - Subscribes to the engine's scroll channel via
 *     `useFootprintScroll()`. Visible only when the chart is NOT at
 *     the right edge (i.e., the user has scrolled into history).
 *   - On click: calls `engine.setScrollTarget(0)`. The engine's
 *     existing smoothing animates the snap; `prefers-reduced-motion`
 *     collapses it to an instant jump (engine-side handling).
 *   - Mounted as a DOM sibling of the canvas, NOT painted inside the
 *     canvas — it's interactive chrome.
 *   - Motion-driven fade in / out at 180 ms via `AnimatePresence`;
 *     `useReducedMotion()` collapses the transition. The fade is
 *     opacity-only; no translate — keeps the compositor cost trivial.
 *
 * Accessibility:
 *   - `<button>` element with accessible name "Follow live".
 *   - Focus ring inherited from the shadcn Button outline variant.
 *   - Pill positioning uses `pointer-events-none` on the wrapper +
 *     `pointer-events-auto` on the button so the wrapper does not
 *     steal hover/scroll events when the pill is invisible.
 */
import { Radio } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useFootprintEngine } from '@/lib/chart/engine-context';
import { useFootprintScroll } from '@/lib/chart/use-footprint-scroll';

export function FollowLivePill(): ReactNode {
  const engine = useFootprintEngine();
  const scroll = useFootprintScroll();
  const reduceMotion = useReducedMotion();

  const handleClick = useCallback(() => {
    if (engine === null) return;
    engine.setScrollTarget(0);
  }, [engine]);

  // Visible when we have a known scroll state AND the user has
  // scrolled away from the right edge. Treating "no state yet" as
  // hidden is correct: before the first paint there is no live edge
  // to follow.
  const visible = scroll !== null && scroll.atRightEdge === false;
  const transition = reduceMotion === true ? { duration: 0 } : { duration: 0.18 };

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-20">
      <AnimatePresence>
        {visible ? (
          <motion.div
            key="follow-live"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="pointer-events-auto"
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleClick}
              aria-label="Follow live"
              className="rounded-full"
            >
              <Radio aria-hidden="true" className="size-3" />
              <span>Follow live</span>
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
