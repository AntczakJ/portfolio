'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Gauge, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { useUiStore } from '@/lib/stores/ui-store';

/**
 * `<ConnectionBanner />` — Phase 3.4 / ADR-009 offline notice.
 *
 *   - Mount point: the top of the canvas region inside
 *     `<BoardCanvasHost />`, above the shape canvas. Sits absolutely
 *     positioned at the top edge of the host's container so it
 *     overlays the canvas without forcing a layout shift; z-index
 *     above the toolbar (`z-30` vs the toolbar's default stack) so
 *     it survives any future side-rail or dialog.
 *   - Copy verbatim per ADR-009 (offline):
 *         "Offline — your edits will sync when you reconnect"
 *     and per ADR-010 (server `4290` overrun / rate-limit close):
 *         "Slow down — reconnecting in a moment…"
 *     The overrun copy reuses this exact banner surface rather than a
 *     new toast (ADR-010 U1: no `sonner` dependency); an overrun is a
 *     recoverable, temporary throttle — the same "your edits are safe,
 *     reconnecting" meaning the offline banner already carries.
 *   - Icon: lucide `WifiOff` (offline) / `Gauge` (overrun) at 16 px on
 *     the left.
 *   - Motion: slide-down from `y: -32` to `y: 0` over 240 ms `easeOutCubic`
 *     on entry, slide-up exit over 200 ms. Reduced-motion short-
 *     circuits both to `duration: 0` per the ADR + `docs/conventions.md`
 *     § 1 + CLAUDE.md § 4.
 *   - Accessibility: `role="status"` + `aria-live="polite"` on the
 *     banner element itself. Screen readers announce the copy when the
 *     element appears. A SEPARATE `<OfflineAriaLiveRegion />` carries
 *     the assertive copy variant per ADR-009 (the polite banner copy
 *     is reinforcement, the assertive sr-only region is the canonical
 *     announcement). Both stay because the banner element disappears
 *     on reconnect and an aria-live region that LOSES its content does
 *     not announce — so the assertive sr-only region carries the
 *     "Connection restored" transition.
 *
 * Subscribed only to the ui-store `connectionState` slot via a
 * selector — re-renders only on connection-state transitions, never
 * on awareness ticks or shape edits.
 */

const OFFLINE_COPY = 'Offline — your edits will sync when you reconnect';
const OVERRUN_COPY = 'Slow down — reconnecting in a moment…';

export function ConnectionBanner(): ReactNode {
  const connectionState = useUiStore((s) => s.connectionState);
  const reduceMotion = useReducedMotion();

  const isOffline = connectionState === 'offline';
  const isOverrun = connectionState === 'overrun';
  // Both degraded states share the banner surface; the icon + copy
  // differ. The banner is visible whenever EITHER fires.
  const isVisible = isOffline || isOverrun;
  const copy = isOverrun ? OVERRUN_COPY : OFFLINE_COPY;

  // Easing: easeOutCubic on entry. Picked to match the slide-in feel of
  // the theme-toggle microinteraction (`[0.33, 1, 0.68, 1]` from Task
  // 2.3) so the banner feels like part of the same chrome vocabulary,
  // not a foreign component. The element only renders while visible, so
  // `transition` always resolves to the enter config — Motion applies it
  // to both the animate-in and the AnimatePresence exit.
  const enterTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: [0.33, 1, 0.68, 1] as const };

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="connection-banner"
          // Banner element IS the aria-live region for the appearance
          // path. The assertive sr-only region in
          // <OfflineAriaLiveRegion /> handles the assertive +
          // restored-transition copy.
          role="status"
          aria-live="polite"
          data-testid="connection-banner"
          initial={reduceMotion ? { y: 0, opacity: 1 } : { y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { y: 0, opacity: 0 } : { y: -32, opacity: 0 }}
          transition={enterTransition}
          // Position: absolute pin to the top of the canvas region's
          // bounding box. The host already has `position: relative` on
          // its scroll-clipping div, so absolute positioning is
          // bounded by that container. z-index sits above the canvas
          // (z-0), the dev conflict-viz panel (un-z'd, defaults to
          // auto), and the toolbar (z-20-ish in BoardToolbar) but
          // below any future dialog (z-50).
          className="absolute inset-x-0 top-0 z-30 flex h-8 items-center justify-center gap-2 border-b border-(--color-warning-border) bg-(--color-warning-surface) px-4 text-xs font-medium text-(--color-warning-foreground)"
        >
          {isOverrun ? (
            <Gauge
              className="size-4 shrink-0"
              aria-hidden="true"
              strokeWidth={2.25}
            />
          ) : (
            <WifiOff
              className="size-4 shrink-0"
              aria-hidden="true"
              strokeWidth={2.25}
            />
          )}
          <span>{copy}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
