'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { requestGlobalRefresh } from './refresh-coordinator';
import { loadGsap, type GsapHandles } from './register';

/**
 * Run a GSAP setup callback AFTER hydration, on idle, with automatic scoped
 * cleanup (ADR-002, re-authored from the razors-edge Home-Perf shape).
 *
 * Why not `useGSAP` directly? `@gsap/react`'s `useGSAP` runs its callback in a
 * `useLayoutEffect` and depends on GSAP being statically imported — both put
 * GSAP on the critical render/parse path (it parses + runs before paint and
 * before the route is interactive, inflating TBT and main-thread time on the
 * home route). Since the hero/bays/directory are already fully rendered
 * server-side (the no-JS floor, the LCP wordmark, the reduced-motion resting
 * state are all markup/CSS), the scrub does not need to exist before paint. This
 * hook defers it:
 *
 *   1. it runs in a plain `useEffect` (after paint, not a layout effect);
 *   2. it `requestIdleCallback`-schedules the actual work (when `idle`) so it
 *      yields to any pending interaction first;
 *   3. it `loadGsap()`s the code-split GSAP chunk on demand.
 *
 * The callback receives the registered GSAP handles + a `gsap.context()` scoped
 * to `scope.current`, so selector text is scoped and every animation +
 * ScrollTrigger it creates is reverted automatically on unmount / dep change
 * (the same cleanup guarantee `useGSAP` gives, StrictMode-double-invoke-safe by
 * construction). `matchMedia` contexts created inside the callback are reverted
 * with the context — this is the single mechanism for both the three-tier
 * reduced-motion degradation AND the mobile-simplified bay choreography
 * (ADR-002 / ADR-003).
 *
 * The static markup is never gated on this — if JS never runs (or runs late),
 * the composed final frame already shows. GSAP only enhances it.
 */
export function useGsapEffect(
  scope: RefObject<HTMLElement | null>,
  setup: (handles: GsapHandles) => void,
  deps: readonly unknown[] = [],
  options?: {
    /**
     * Defer the GSAP load + setup to `requestIdleCallback` so it yields to any
     * pending interaction first. Use this for the hero scrub, whose initial
     * state at scroll = 0 equals the composed resting frame, so deferring it
     * cannot flash.
     *
     * Leave `false` (the default) for scroll-reveals that hide their items
     * (`opacity: 0`) as an initial state: those still code-split GSAP out of the
     * initial bundle and load post-paint, but they run as soon as the chunk
     * resolves so an item already in view does not flash visible-then-hidden
     * under a long idle gap.
     */
    idle?: boolean;
  },
): void {
  const idle = options?.idle ?? false;

  // The `setup` callback is typically an inline arrow (a new identity every
  // render), and `idle` is derived per render; but the GSAP setup must only
  // re-run when the caller's `deps` change — not on every render. Hold both in
  // refs so the effect reads them fresh without depending on their identity,
  // leaving the caller's `deps` as the effect's sole dependency.
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const idleRef = useRef(idle);
  idleRef.current = idle;

  useEffect(() => {
    let cancelled = false;
    let context: ReturnType<GsapHandles['gsap']['context']> | undefined;
    let idleHandle: number | undefined;

    const run = () => {
      void loadGsap().then((handles) => {
        if (cancelled || !scope.current) return;
        context = handles.gsap.context(() => {
          setupRef.current(handles);
        }, scope.current);
        // Coordinated, order-independent refresh: instead of this section
        // refreshing in isolation (which races upstream pins that may not exist
        // yet — the bay-early-pin bug), request a single debounced global
        // `ScrollTrigger.refresh()` that fires once after the LAST section has
        // registered its triggers, recomputing every trigger in document order
        // with all pins (the idle-deferred hero included) accounted for. See
        // `refresh-coordinator.ts`.
        requestGlobalRefresh();
      });
    };

    if (
      idleRef.current &&
      typeof window !== 'undefined' &&
      'requestIdleCallback' in window
    ) {
      idleHandle = window.requestIdleCallback(run, { timeout: 400 });
    } else {
      // Post-paint (this is a passive effect, not a layout effect), but without
      // the idle gap.
      run();
    }

    return () => {
      cancelled = true;
      if (
        idleHandle !== undefined &&
        typeof window !== 'undefined' &&
        'cancelIdleCallback' in window
      ) {
        window.cancelIdleCallback(idleHandle);
      }
      context?.revert();
    };
    // The effect intentionally re-runs only when the caller's `deps` change
    // (the GSAP setup is keyed to them), reading `setup` / `idle` fresh via refs
    // so neither is a dependency. `scope` is a stable ref object.
  }, deps);
}
