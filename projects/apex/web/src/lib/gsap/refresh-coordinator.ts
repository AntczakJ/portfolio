'use client';

import { loadGsap } from './register';

/**
 * Coordinated, order-independent `ScrollTrigger.refresh()` (inherited pattern
 * from razors-edge; apex's own module).
 *
 * THE PROBLEM. Every animated section sets up its GSAP via `useGsapEffect`,
 * which loads the code-split GSAP chunk and runs the section's setup
 * ASYNCHRONOUSLY and INDEPENDENTLY. `ScrollTrigger.refresh()` recomputes the
 * start/end of every EXISTING trigger in document order, accounting for
 * upstream pins — but only for the triggers that exist at the moment it runs.
 * Because sections initialise in a non-deterministic order (an idle-deferred
 * hero loads late; a downstream pinned section may register before the
 * upstream pin's spacer exists), a downstream pin can be measured against a
 * document missing an upstream pin's spacer.
 *
 * THE FIX. No section refreshes in isolation. Each setup calls
 * `requestGlobalRefresh()` on completion; those calls debounce into a SINGLE
 * `ScrollTrigger.sort()` + `refresh()` on the next frame after the last
 * section registered its triggers — so the refresh sees every trigger and
 * recomputes them all in document order with pins accounted for. We also
 * refresh on `window` `load` (images/fonts settled) and on a debounced
 * `resize`.
 *
 * Idempotent + SSR-safe: the global listeners attach once, lazily, in the
 * browser only.
 */

let scheduled = false;
let listenersAttached = false;

function runRefresh(): void {
  // `loadGsap()` is memoised — by the time any section calls this, GSAP is
  // already loaded, so this resolves on the microtask queue without a second
  // import.
  void loadGsap().then(({ ScrollTrigger }) => {
    // `sort()` BEFORE `refresh()` is the crux of order-independence:
    // ScrollTrigger.sort() reorders the internal list by `refreshPriority`
    // then document position (a pinned trigger sorts by where its pin begins),
    // so the subsequent refresh applies upstream pin-spacers before measuring
    // downstream triggers — independent of which chunk resolved first.
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  });
}

/**
 * Request a single coordinated `ScrollTrigger.refresh()`. Safe to call from
 * every section's setup; calls within the same frame burst collapse to one
 * refresh on the next animation frame.
 */
export function requestGlobalRefresh(): void {
  if (typeof window === 'undefined') return;

  attachGlobalListeners();

  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    runRefresh();
  });
}

let resizeTimer: number | undefined;

function attachGlobalListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  if (document.readyState === 'complete') {
    requestGlobalRefresh();
  } else {
    window.addEventListener(
      'load',
      () => {
        requestGlobalRefresh();
      },
      { once: true },
    );
  }

  window.addEventListener('resize', () => {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      requestGlobalRefresh();
    }, 200);
  });
}
