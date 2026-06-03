'use client';

import { loadGsap } from './register';

/**
 * Coordinated, order-independent `ScrollTrigger.refresh()` (Gallery-early-pin
 * fix, 2026-06-03).
 *
 * THE PROBLEM this solves. Every animated section sets up its GSAP via
 * `useGsapEffect`, which loads the code-split GSAP chunk and runs the section's
 * setup ASYNCHRONOUSLY and INDEPENDENTLY (`loadGsap().then(...)`). Each section
 * used to call `ScrollTrigger.refresh()` at the end of its OWN setup, in
 * isolation. `ScrollTrigger.refresh()` recomputes the start/end of EVERY
 * existing trigger in document order, correctly accounting for upstream pins —
 * but only for the triggers that EXIST at the moment it runs.
 *
 * Because the sections initialise in a non-deterministic order (the hero is
 * `requestIdleCallback`-deferred via `{ idle: true }`, so it loads LATE; the
 * gallery loads as soon as its chunk resolves post-paint), a DOWNSTREAM pinned
 * trigger (the gallery) could be created and refreshed BEFORE the UPSTREAM
 * pinned trigger (the hero, ~190vh of pin-spacer) existed. The gallery then
 * measured its `start: 'top top'` against a document missing the hero's
 * pin-spacer, putting its pin ~190vh too early — inside the services section.
 *
 * THE FIX. No section refreshes in isolation any more. Instead each setup calls
 * `requestGlobalRefresh()` on completion. This debounces all those calls into a
 * SINGLE `ScrollTrigger.refresh()` that fires once on the next frame after the
 * LAST section to load has registered its triggers — so the refresh always sees
 * every trigger (hero pin included) and recomputes them all in document order
 * with the pins accounted for. It is order-independent: whichever section loads
 * last triggers the final refresh, and that refresh fixes everyone.
 *
 * We also refresh once on `window` `load` (images/fonts settled) and on a
 * debounced `resize`, so a late layout shift (a hero portrait finishing decode,
 * a font swap) re-measures the pins. ScrollTrigger already wires its own
 * resize handling, but the `load` refresh closes the gap where a section
 * registered before the LCP image's intrinsic box was known.
 *
 * Idempotent + SSR-safe: the global listeners are attached once, lazily, and
 * only in the browser. The debounce coalesces bursts (the typical case: 6+
 * sections all finishing their setup within a few frames of each other).
 */

let scheduled = false;
let listenersAttached = false;

function runRefresh(): void {
  // `loadGsap()` is memoised — by the time any section calls this, GSAP is
  // already loaded (the caller just used it), so this resolves synchronously
  // on the microtask queue without a second import.
  void loadGsap().then(({ ScrollTrigger }) => {
    // `sort()` BEFORE `refresh()` is the crux of the order-independence.
    //
    // `ScrollTrigger.refresh()` recomputes every trigger's start/end IN THE
    // ORDER the triggers sit in ScrollTrigger's internal list, and a PINNED
    // trigger's pin-spacing only shifts the triggers that refresh AFTER it. By
    // default that list order is creation order — and our sections create
    // their triggers in a NON-DETERMINISTIC async order (the hero pin is
    // `requestIdleCallback`-deferred, so it is frequently created LAST, after
    // the downstream gallery pin). When the gallery refreshes before the hero
    // pin's spacer is accounted for, the gallery's `start: 'top top'` lands
    // ~190vh (the hero pin length) too early — inside the services section.
    //
    // `ScrollTrigger.sort()` reorders the internal list by `refreshPriority`
    // then by document position (a pinned trigger sorts by where its pin
    // begins). After sorting, the upstream hero pin precedes the gallery in
    // the list, so the subsequent `refresh()` applies the hero pin-spacer
    // BEFORE measuring the gallery — the gallery's start is then computed
    // against the full document and pins only when its own top reaches the
    // viewport top. This makes the result independent of which section's GSAP
    // chunk resolved first.
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  });
}

/**
 * Request a single coordinated `ScrollTrigger.refresh()`. Safe to call from
 * every section's setup; calls within the same frame burst collapse to one
 * refresh on the next animation frame (after the last caller has registered
 * its triggers).
 */
export function requestGlobalRefresh(): void {
  if (typeof window === 'undefined') return;

  attachGlobalListeners();

  if (scheduled) return;
  scheduled = true;
  // Defer to the next frame so all sections that finished their setup in this
  // tick (and any that finish in the same frame) have registered their
  // triggers before the single refresh measures them.
  requestAnimationFrame(() => {
    scheduled = false;
    runRefresh();
  });
}

let resizeTimer: number | undefined;

function attachGlobalListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  // Once images/fonts have settled, re-measure: a late LCP-image decode or a
  // font swap can change a pinned section's footprint after its trigger was
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
  // coordinated refresh keeps the pin distances (computed from `scrollWidth` /
  // `clientWidth` via `invalidateOnRefresh`) correct across breakpoint changes.
  window.addEventListener('resize', () => {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      requestGlobalRefresh();
    }, 200);
  });
}
