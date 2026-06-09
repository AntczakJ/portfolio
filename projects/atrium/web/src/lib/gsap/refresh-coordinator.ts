'use client';

import { loadGsap } from './register';

/**
 * Coordinated, order-independent `ScrollTrigger.refresh()` (re-authored from the
 * razors-edge Gallery-early-pin fix). LOAD-BEARING for atrium: the scroll spine
 * is a hero pin PLUS six bay pins (seven pins total — ADR-002), so the
 * sort-before-refresh ordering matters here even more than it did in razors-edge
 * (one hero pin + one gallery pin).
 *
 * THE PROBLEM this solves. Every animated section sets up its GSAP via
 * `useGsapEffect`, which loads the code-split GSAP chunk and runs the section's
 * setup ASYNCHRONOUSLY and INDEPENDENTLY (`loadGsap().then(...)`). If each
 * section called `ScrollTrigger.refresh()` at the end of its OWN setup, in
 * isolation, the refresh would recompute every EXISTING trigger in document
 * order — but only for the triggers that exist at the moment it runs.
 *
 * Because the sections initialise in a non-deterministic order (the hero scrub
 * is `requestIdleCallback`-deferred via `{ idle: true }`, so it loads LATE; the
 * bays load as soon as their chunk resolves post-paint), a DOWNSTREAM pinned bay
 * could be created and refreshed BEFORE the UPSTREAM hero pin (~1 viewport-plus
 * of pin-spacer) existed. The bay then measures its `start: 'top top'` against a
 * document missing the hero's pin-spacer, putting its pin too early — and with
 * six sequential bays the error compounds bay-to-bay.
 *
 * THE FIX. No section refreshes in isolation. Each setup calls
 * `requestGlobalRefresh()` on completion. This debounces all those calls into a
 * SINGLE `ScrollTrigger.refresh()` that fires once on the next frame after the
 * LAST section to load has registered its triggers — so the refresh always sees
 * every trigger (hero pin + all six bay pins) and recomputes them in document
 * order with the pins accounted for. It is order-independent: whichever section
 * loads last triggers the final refresh, and that refresh fixes everyone.
 *
 * We also refresh once on `window` `load` (fonts/images settled) and on a
 * debounced `resize`, so a late layout shift (a font swap, a preview-still
 * decode) re-measures the pins.
 *
 * Idempotent + SSR-safe: the global listeners are attached once, lazily, and
 * only in the browser. The debounce coalesces bursts (the typical case: 7+
 * sections all finishing their setup within a few frames of each other).
 */

let scheduled = false;
let listenersAttached = false;

function runRefresh(): void {
  // `loadGsap()` is memoised — by the time any section calls this, GSAP is
  // already loaded (the caller just used it), so this resolves on the microtask
  // queue without a second import.
  void loadGsap().then(({ ScrollTrigger }) => {
    // `sort()` BEFORE `refresh()` is the crux of the order-independence.
    //
    // `ScrollTrigger.refresh()` recomputes every trigger's start/end IN THE
    // ORDER the triggers sit in ScrollTrigger's internal list, and a PINNED
    // trigger's pin-spacing only shifts the triggers that refresh AFTER it. By
    // default that list order is creation order — and our sections create their
    // triggers in a NON-DETERMINISTIC async order (the hero pin is
    // `requestIdleCallback`-deferred, so it is frequently created LAST, after
    // the downstream bay pins). When a bay refreshes before the hero pin's
    // spacer is accounted for, the bay's `start: 'top top'` lands a full hero
    // pin-length too early.
    //
    // `ScrollTrigger.sort()` reorders the internal list by `refreshPriority`
    // then by document position (a pinned trigger sorts by where its pin
    // begins). After sorting, every upstream pin precedes the bays that follow
    // it, so the subsequent `refresh()` applies each upstream pin-spacer BEFORE
    // measuring the downstream bay — independent of which GSAP chunk resolved
    // first.
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  });
}

/**
 * Request a single coordinated `ScrollTrigger.refresh()`. Safe to call from
 * every section's setup; calls within the same frame burst collapse to one
 * refresh on the next animation frame (after the last caller has registered its
 * triggers).
 */
export function requestGlobalRefresh(): void {
  if (typeof window === 'undefined') return;

  attachGlobalListeners();

  if (scheduled) return;
  scheduled = true;
  // Defer to the next frame so all sections that finished their setup in this
  // tick (and any that finish in the same frame) have registered their triggers
  // before the single refresh measures them.
  requestAnimationFrame(() => {
    scheduled = false;
    runRefresh();
  });
}

let resizeTimer: number | undefined;

function attachGlobalListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  // Once images/fonts have settled, re-measure: a late font swap or a preview
  // still decode can change a pinned section's footprint after its trigger was
  // first created.
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

  // Debounced resize refresh. ScrollTrigger has its own resize handling, but a
  // coordinated refresh keeps the pin distances correct across breakpoint
  // changes (where the `matchMedia` mobile branch swaps the bay choreography).
  window.addEventListener('resize', () => {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      requestGlobalRefresh();
    }, 200);
  });
}
