'use client';

import { Move3d } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  HERO_BLUR_DATA_URL,
  HERO_BLUR_DATA_URL_DARK,
} from '@/components/hero/hero-assets';
import { detectWebglTier, type WebglTier } from '@/lib/r3f/detect-webgl-tier';
import { setSeamReady, subscribeSeam } from '@/lib/r3f/seam';
import { useConfiguratorStore } from '@/lib/store/configurator-store';
import {
  CONFIGURATOR_OPTIONS,
  getThemedRenderStill,
  HERO_VEHICLE,
} from '@/mocks';

import { ConfiguratorCanvas } from './configurator-canvas';

/**
 * The configurator display stage — the four-tier degradation gate (ADR-004) and
 * the reveal-when-ready crossfade, mounted INSIDE the reserved `[data-
 * configurator-stage]` box (CLS-safe; the box is reserved server-side by the
 * section).
 *
 * DEFERRED MOUNT (the performance contract, ADR-002 §3 — the canvas, three.js,
 * and the ~1.5 MB GLB are NOT on the home INITIAL load):
 *   The live `<Canvas>` (and therefore the three.js chunks + the GLB download)
 *   does NOT mount on first paint. The stage is "armed" only when EITHER:
 *     - an IntersectionObserver fires as the configurator section approaches the
 *       viewport (a generous `rootMargin` so the scene is ready by the time the
 *       user arrives), OR
 *     - the user shows intent (pointer over / focus / pointer-down on the stage).
 *   Until armed, the static pre-baked still is the only surface — exactly the
 *   Tier-3 surface — so the hero static render stays the unchallenged LCP and the
 *   heavy scene is off the home critical path Lighthouse measures. The
 *   `detectWebglTier()` gate still decides Tier-1-live vs Tier-3-stills, but only
 *   AFTER arming (the change is WHEN the canvas mounts, not WHETHER). The
 *   reveal-when-ready crossfade still runs once the canvas mounts on approach.
 *
 *   - Tier 1 (armed, gate passes, motion OK): the live R3F canvas mounts behind
 *     the pre-baked still; the still stays visible until the scene reports
 *     reveal-when-ready, then a short opacity crossfade swaps the still out.
 *     Idle auto-orbit on; the seam intro camera honours scroll progress.
 *   - Tier 2 (armed, reduced motion, gate still allows the live scene): the live
 *     canvas mounts; NO scrubbed intro, NO auto-orbit; the reveal is a plain
 *     crossfade once ready. Drag-to-orbit + swatches stay interactive.
 *   - Tier 3 (no-WebGL / mid-mobile / data-saver, OR a runtime
 *     PerformanceMonitor demotion): NO three.js loads at all — the stage shows
 *     the pre-baked AVIF still for the current `{ colorId, wheelId }`; tapping a
 *     swatch swaps the still (instant, no GPU). This is the mobile Lighthouse
 *     path AND the pre-arm path on every tier.
 *   - Tier 4 (no-JS / pre-hydration): handled by the SERVER-rendered default
 *     still in `configurator-section.tsx`; this client component only renders
 *     after hydration, so the no-JS floor never depends on it.
 *
 * `prefers-reduced-motion` is read here (orthogonal to the device tier per
 * ADR-002 §4) to choose Tier-1-with-reveal vs Tier-2-crossfade.
 */
export function ConfiguratorStage(): ReactNode {
  const colorId = useConfiguratorStore((s) => s.colorId);
  const wheelId = useConfiguratorStore((s) => s.wheelId);

  const stageRef = useRef<HTMLDivElement>(null);

  // Armed = the canvas is allowed to mount (intersection-on-approach OR user
  // intent). Until then the static still is the only surface and three.js / the
  // GLB are NOT requested — keeping them off the home initial load.
  const [armed, setArmed] = useState(false);
  const [tier, setTier] = useState<WebglTier>('unknown');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [demoted, setDemoted] = useState(false);
  // Whether the live scene has reported ready -> crossfade the still out.
  const [revealed, setRevealed] = useState(false);
  // First drag/touch on the live stage -> fade the "Drag to orbit" hint out
  // (D-14): once the user has discovered the affordance, the pill is noise.
  const [interacted, setInteracted] = useState(false);
  // The live theme, read from the `html.dark` class set by next-themes (more
  // reliable than `useTheme().resolvedTheme`, which can lag a render behind
  // hydration). A MutationObserver keeps it in sync with the theme toggle so the
  // dark-stage stills (the night-drive re-key) swap when the theme changes.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Reduced-motion + theme, after mount (SSR-safe). The tier probe is deferred
  // to arming (below) so nothing about the live scene is decided on first paint.
  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    const root = document.documentElement;
    const readTheme = () =>
      { setTheme(root.classList.contains('dark') ? 'dark' : 'light'); };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); };
  }, []);

  // Arm on approach (IntersectionObserver, generous rootMargin so the scene is
  // ready by the time the user arrives) OR on user intent (pointer / focus).
  // Once armed we run the capability probe ONCE and never disarm — the heavy
  // scene only loads here, never on the home initial load.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let done = false;
    const arm = () => {
      if (done) return;
      done = true;
      setArmed(true);
      // Decide the tier only now (after arming), so the dynamic three.js import
      // + GLB fetch are gated on a real approach/intent, not first paint.
      setTier(detectWebglTier());
      cleanup();
    };

    const onIntent = () => { arm(); };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) arm();
      },
      // A SMALL head start (10% of the viewport) — enough that the still→live
      // crossfade is ready a touch before the section is fully in view, but NOT
      // so generous that the configurator (which sits directly below the full-
      // height hero) arms at scrollY=0 and pulls three.js + the GLB onto the home
      // initial load Lighthouse measures. The reveal-when-ready crossfade keeps
      // the still visible until the live scene paints, so a modest margin is
      // imperceptible. User intent (pointer/focus) arms immediately regardless.
      { rootMargin: '10% 0px', threshold: 0 },
    );
    observer.observe(el);

    el.addEventListener('pointerenter', onIntent, { once: true });
    el.addEventListener('pointerdown', onIntent, { once: true });
    el.addEventListener('focusin', onIntent, { once: true });

    function cleanup() {
      observer.disconnect();
      el?.removeEventListener('pointerenter', onIntent);
      el?.removeEventListener('pointerdown', onIntent);
      el?.removeEventListener('focusin', onIntent);
    }
    return cleanup;
  }, []);

  // React to the live scene's readiness (the reveal-when-ready swap, ADR-004).
  useEffect(() => {
    const unsubscribe = subscribeSeam((state) => {
      if (state.ready === 'ready') setRevealed(true);
      if (state.ready === 'failed') setRevealed(false);
    });
    return unsubscribe;
  }, []);

  const liveEligible = armed && tier === 'tier-1' && !demoted;
  const stillSrc =
    getThemedRenderStill(colorId, wheelId, theme) ??
    HERO_VEHICLE.heroRenderSrc;
  const color = CONFIGURATOR_OPTIONS.colors.find((c) => c.id === colorId);
  const wheel = CONFIGURATOR_OPTIONS.wheels.find((w) => w.id === wheelId);
  const stillAlt = `${HERO_VEHICLE.name}, ${color?.name ?? 'default finish'}, ${
    wheel?.name ?? 'standard wheels'
  } — APEX studio render`;

  // When live-eligible, fade the still out once the scene is revealed; when
  // not (pre-arm / Tier 3 / demoted), the still is the surface and stays at full
  // opacity.
  const stillVisible = !liveEligible || !revealed;

  // If we demote away from a live scene, make sure the seam ready flag is reset
  // so a re-promotion would re-trigger the reveal cleanly.
  const prevLiveRef = useRef(liveEligible);
  useEffect(() => {
    if (prevLiveRef.current && !liveEligible) {
      setSeamReady('idle');
      setRevealed(false);
    }
    prevLiveRef.current = liveEligible;
  }, [liveEligible]);

  return (
    <div
      ref={stageRef}
      className="absolute inset-0"
      onPointerDown={
        liveEligible && revealed && !interacted
          ? () => { setInteracted(true); }
          : undefined
      }
    >
      {/* The live canvas (Tier 1/2). Mounted behind the still; crossfades in on
          reveal-when-ready. Not mounted at all before arming (on-approach /
          on-intent) or on Tier 3 — so three.js + the GLB never reach the home
          initial load. */}
      {liveEligible && (
        <div
          className="absolute inset-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ opacity: revealed ? 1 : 0 }}
        >
          <ConfiguratorCanvas
            reveal={!reducedMotion}
            autoRotate={!reducedMotion}
            onDemote={() => { setDemoted(true); }}
            theme={theme}
          />
        </div>
      )}

      {/* The pre-baked still — the LCP-consistent surface (Tier 3/4 + pre-arm)
          AND the reveal-from surface (Tier 1/2). next/image AVIF, blur
          placeholder, lazy (below the fold; never competes with the hero LCP). */}
      <div
        aria-hidden={liveEligible && revealed ? 'true' : undefined}
        className="absolute inset-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ opacity: stillVisible ? 1 : 0 }}
      >
        <Image
          key={stillSrc}
          src={stillSrc}
          alt={stillAlt}
          fill
          loading="lazy"
          sizes="(min-width: 1024px) 80vw, 100vw"
          placeholder="blur"
          blurDataURL={
            theme === 'dark' ? HERO_BLUR_DATA_URL_DARK : HERO_BLUR_DATA_URL
          }
          className="object-cover object-center sm:object-contain"
        />
      </div>

      {/* Live-interaction hint (Tier 1/2 only, once revealed). Decorative.
          Edge-anchored to the bottom-right corner so it never sits over the
          subject, with a stronger surface + border so it reads in dark, and it
          fades out on the first drag/touch (D-14). */}
      {liveEligible && revealed && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-4 bottom-4 flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
            'bg-surface/85 border-border text-fg-muted border shadow-[var(--shadow-card)] backdrop-blur-md',
            interacted ? 'opacity-0' : 'opacity-100',
          )}
        >
          <Move3d className="size-3.5" aria-hidden="true" />
          <span className="text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-wide)]">
            Drag to orbit
          </span>
        </div>
      )}
    </div>
  );
}
