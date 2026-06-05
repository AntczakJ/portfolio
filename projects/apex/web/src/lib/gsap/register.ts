'use client';

import type { useGSAP as UseGSAPType } from '@gsap/react';
import type { gsap as GsapType } from 'gsap';
import type { ScrollTrigger as ScrollTriggerType } from 'gsap/ScrollTrigger';

/**
 * Lazy GSAP loader (ADR-002 — inherited pattern from razors-edge ADR-002,
 * apex's own module).
 *
 * GSAP core + ScrollTrigger + `@gsap/react` together are ~110 kB of parsed
 * JS whose only job is to ENHANCE a hero/sections layer that is already
 * fully rendered as real DOM server-side (the no-JS floor + the LCP surface
 * + the reduced-motion resting state are all CSS/markup, not GSAP). So GSAP
 * does not belong on the home route's critical render/parse path: it does
 * not need to run before first paint or before interactivity.
 *
 * This module therefore does NOT statically re-export `gsap` (which would
 * pull the whole library into the home route's initial bundle). Instead it
 * exposes an async `loadGsap()` that dynamically `import()`s the three
 * modules, registers the plugins exactly once, and resolves the handles — so
 * the GSAP chunk is code-split out of the initial bundle and fetched AFTER
 * hydration / on idle (see `useGsapEffect`). The static markup is untouched
 * and remains the floor; GSAP only attaches on top.
 *
 * Registration is idempotent (a module-level promise memoises the load), so
 * every animated component awaiting `loadGsap()` shares one import + one
 * `registerPlugin` call. ScrollTrigger is never imported into a Server
 * Component — these are dynamic imports inside client-only code paths.
 *
 * CSP (ADR-002 §5): GSAP core + ScrollTrigger + `@gsap/react` do NOT use
 * `eval` / `new Function`, so this runs clean under `script-src 'self'` with
 * no `'unsafe-eval'`. GSAP writes inline `style` transforms during scrubs,
 * which `style-src 'unsafe-inline'` covers. Verified under
 * `next build && next start`.
 */

export interface GsapHandles {
  gsap: typeof GsapType;
  ScrollTrigger: typeof ScrollTriggerType;
  useGSAP: typeof UseGSAPType;
}

let cache: Promise<GsapHandles> | null = null;

/**
 * Dynamically import + register GSAP, ScrollTrigger and `useGSAP`. Memoised:
 * the import and the `registerPlugin` call happen once across the whole app.
 */
export function loadGsap(): Promise<GsapHandles> {
  cache ??= (async () => {
    const [{ gsap }, { ScrollTrigger }, { useGSAP }] = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
      import('@gsap/react'),
    ]);
    gsap.registerPlugin(ScrollTrigger, useGSAP);
    return { gsap, ScrollTrigger, useGSAP };
  })();
  return cache;
}
