'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { requestGlobalRefresh } from './refresh-coordinator';
import { loadGsap, type GsapHandles } from './register';

/**
 * Run a GSAP setup callback AFTER hydration, on idle, with automatic scoped
 * cleanup (inherited pattern from razors-edge; apex's own module).
 *
 * Why not `useGSAP` directly? `@gsap/react`'s `useGSAP` runs its callback in
 * a `useLayoutEffect` and depends on GSAP being statically imported — both
 * put GSAP on the critical render/parse path. Since the hero/sections are
 * already fully rendered server-side (the no-JS floor, the LCP surface, the
 * reduced-motion resting state are all markup/CSS), the scrub does not need
 * to exist before paint. This hook defers it:
 *
 *   1. it runs in a plain `useEffect` (after paint, not a layout effect);
 *   2. it `requestIdleCallback`-schedules the actual work so it yields to any
 *      pending interaction first (when `{ idle: true }`);
 *   3. it `loadGsap()`s the code-split GSAP chunk on demand.
 *
 * The callback receives the registered GSAP handles + a `gsap.context()`
 * scoped to `scope.current`, so selector text is scoped and every animation
 * + ScrollTrigger it creates is reverted automatically on unmount / dep
 * change. `matchMedia` contexts created inside the callback are reverted with
 * the context. The static markup is never gated on this — if JS never runs
 * (or runs late), the composed final frame already shows. GSAP only enhances.
 */
export function useGsapEffect(
  scope: RefObject<HTMLElement | null>,
  setup: (handles: GsapHandles) => void,
  deps: readonly unknown[] = [],
  options?: {
    /**
     * Defer the GSAP load + setup to `requestIdleCallback` so it yields to
     * any pending interaction first. Use for a hero scrub whose initial state
     * is invisible at scroll = 0 (it matches the composed resting frame), so
     * deferring it cannot flash. Leave `false` (default) for scroll-reveals
     * that hide their items as an initial state, so an item already in view
     * does not flash under a long idle gap.
     */
    idle?: boolean;
  },
): void {
  const idle = options?.idle ?? false;

  // `setup` is typically an inline arrow (new identity each render) and `idle`
  // is derived per render; the GSAP setup must only re-run when the caller's
  // `deps` change. Hold both in refs so the effect reads them fresh without
  // depending on their identity, leaving the caller's `deps` as the effect's
  // sole dependency.
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
        // Coordinated, order-independent refresh (see refresh-coordinator):
        // request a single debounced global refresh that fires once after the
        // last section has registered its triggers.
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
    // The effect re-runs only when the caller's `deps` change (the GSAP setup
    // is keyed to them), reading `setup` / `idle` fresh via refs so neither is
    // a dependency. `scope` is a stable ref object.
  }, deps);
}
