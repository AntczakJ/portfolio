'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { loadGsap, type GsapHandles } from './register';

/**
 * Run a GSAP setup callback AFTER hydration, on idle, with automatic
 * scoped cleanup (Home-Perf pass 2026-06-03).
 *
 * Why not `useGSAP` directly? `@gsap/react`'s `useGSAP` runs its callback in
 * a `useLayoutEffect` and depends on the GSAP library being statically
 * imported — both put GSAP on the critical render/parse path (it parses +
 * runs before paint and before the route is interactive, inflating TBT and
 * main-thread time on the home route). Since the hero/sections are already
 * fully rendered server-side (the no-JS floor, the LCP surface, the
 * reduced-motion resting state are all markup/CSS), the scrub does not need
 * to exist before paint. This hook defers it:
 *
 *   1. it runs in a plain `useEffect` (after paint, not a layout effect);
 *   2. it `requestIdleCallback`-schedules the actual work so it yields to
 *      any pending interaction first;
 *   3. it `loadGsap()`s the code-split GSAP chunk on demand.
 *
 * The callback receives the registered GSAP handles + a `gsap.context()`
 * scoped to `scope.current`, so selector text is scoped and every animation
 * + ScrollTrigger it creates is reverted automatically on unmount / dep
 * change (the same cleanup guarantee `useGSAP` gives). `matchMedia` contexts
 * created inside the callback are reverted with the context.
 *
 * The static markup is never gated on this — if JS never runs (or runs
 * late), the composed final frame already shows. GSAP only enhances it.
 */
export function useGsapEffect(
  scope: RefObject<HTMLElement | null>,
  setup: (handles: GsapHandles) => void,
  deps: readonly unknown[] = [],
  options?: {
    /**
     * Defer the GSAP load + setup to `requestIdleCallback` so it yields to
     * any pending interaction first. Use this for the hero scrub, whose
     * initial state is invisible at scroll = 0 (it matches the composed
     * resting frame), so deferring it cannot flash.
     *
     * Leave `false` (the default) for scroll-reveals that hide their items
     * (`opacity: 0`) as an initial state: those still code-split GSAP out of
     * the initial bundle and load post-paint, but they run as soon as the
     * chunk resolves so an item that is already in view does not flash
     * visible-then-hidden under a long idle gap.
     */
    idle?: boolean;
  },
): void {
  const idle = options?.idle ?? false;

  // The `setup` callback is typically an inline arrow (a new identity every
  // render), and `idle` is derived per render; but the GSAP setup must only
  // re-run when the caller's `deps` change — not on every render. Hold both in
  // refs so the effect reads them fresh without depending on their identity,
  // leaving the caller's `deps` as the effect's sole dependency (no
  // `exhaustive-deps` disable needed — the effect closes over only stable
  // refs).
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
      });
    };

    if (
      idleRef.current &&
      typeof window !== 'undefined' &&
      'requestIdleCallback' in window
    ) {
      idleHandle = window.requestIdleCallback(run, { timeout: 400 });
    } else {
      // Post-paint (this is a passive effect, not a layout effect), but
      // without the idle gap.
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
    // (the GSAP setup is keyed to them), reading `setup` / `idle` fresh via
    // refs so neither is a dependency. `scope` is a stable ref object.
  }, deps);
}
