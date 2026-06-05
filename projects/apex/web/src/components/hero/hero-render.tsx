'use client';

import Image from 'next/image';
import { useEffect, useState, type ReactNode } from 'react';

import {
  HERO_BLUR_DATA_URL,
  HERO_BLUR_DATA_URL_DARK,
} from './hero-assets';

interface HeroRenderProps {
  /** Accessible description of the configured car (the no-canvas a11y floor). */
  alt: string;
}

/**
 * The static product render (Task 4.2) — THE LCP element (ADR-002/004).
 *
 * Two `next/image` AVIF crops, art-directed via CSS (`sizes` + show/hide): a
 * desktop landscape and a mobile tall crop, so the cinematic framing holds at
 * every width. The desktop crop owns the LCP preload (`priority` +
 * `fetchPriority="high"`); the mobile crop is eager-but-not-preloaded so phones
 * do not waste a second preload (the razors-edge D-15 lesson).
 *
 * THEME-AWARE (P0-NEW-1 / D-07 / D-16): the render and its blur placeholder are
 * keyed to the live theme exactly like `configurator-stage.tsx` — the live
 * `html.dark` class is read via a MutationObserver (more reliable than
 * `useTheme().resolvedTheme`, which lags a render behind hydration). On the dark
 * "night drive" register the dark night-studio crops
 * (`hero-{desktop,mobile}-dark.avif`) + `HERO_BLUR_DATA_URL_DARK` are used, so
 * the dark hero never shows a bright studio render on the near-black page (the
 * "light car on a dark page" failure). The SSR / no-JS / pre-hydration default
 * is LIGHT (the light-canonical theme), corrected on the client after mount;
 * because the server and the first client render BOTH emit the light crops, no
 * hydration mismatch is produced — the swap is a post-mount state update.
 *
 * This image is what paints first and counts as the LCP — never the WebGL
 * canvas (the ADR-002 "LCP is never the canvas" contract). The canvas (Task
 * 4.4) mounts BEHIND this in the same reserved box and only crossfades in once
 * ready. The renders are rendered from the SHARED camera/lighting rig
 * (ADR-004 "one rig, three outputs"), so the live canvas can pose-match this
 * framing at the reveal with no positional pop.
 *
 * Provenance: studio renders produced from the real GLB rig by
 * `scripts/render-from-scene.mjs` (see CREDITS.md).
 */
export function HeroRender({ alt }: HeroRenderProps): ReactNode {
  // SSR default = light (the light-canonical theme). Corrected after mount from
  // the `html.dark` class; identical first client render => no hydration warning.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const readTheme = () =>
      { setTheme(root.classList.contains('dark') ? 'dark' : 'light'); };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); };
  }, []);

  const isDark = theme === 'dark';
  const desktopSrc = isDark
    ? '/renders/lumen-gt/hero-desktop-dark.avif'
    : '/renders/lumen-gt/hero-desktop.avif';
  const mobileSrc = isDark
    ? '/renders/lumen-gt/hero-mobile-dark.avif'
    : '/renders/lumen-gt/hero-mobile.avif';
  const blur = isDark ? HERO_BLUR_DATA_URL_DARK : HERO_BLUR_DATA_URL;

  return (
    <>
      {/* Desktop / tablet crop — the LCP at >= sm. Biased toward the lower third
          so the car reads as a grounded product shot and the upper field stays
          clear for the wordmark. Preloaded only for the desktop viewport
          (`media`-scoped via `sizes`) so a phone never wastes a preload on it.
          `key` forces a clean swap so the blur matches the theme crop on a
          theme toggle. */}
      <Image
        key={desktopSrc}
        src={desktopSrc}
        alt={alt}
        fill
        priority
        fetchPriority="high"
        sizes="(max-width: 639px) 0px, 100vw"
        placeholder="blur"
        blurDataURL={blur}
        className="hidden object-contain object-bottom sm:block"
      />
      {/* Mobile tall crop — the LCP below sm, so it MUST be preloaded too
          (otherwise mobile LCP waits for the eager-but-unhinted fetch — the
          Phase-7 mobile LCP ~4.6s regression). Preloaded only for the mobile
          viewport (`media`-scoped via `sizes`) so the two crops never both
          download on one device. */}
      <Image
        key={mobileSrc}
        src={mobileSrc}
        alt={alt}
        fill
        priority
        fetchPriority="high"
        sizes="(max-width: 639px) 100vw, 0px"
        placeholder="blur"
        blurDataURL={blur}
        className="block object-contain object-bottom sm:hidden"
      />
    </>
  );
}
