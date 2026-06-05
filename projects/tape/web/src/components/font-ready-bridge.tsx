'use client';

import { useEffect, type ReactNode } from 'react';

import { getThemeTokensBridge } from '@/lib/theme/tokens';

/**
 * FontReadyBridge — upgrade the Canvas2D footprint to JetBrains Mono once
 * the web font has actually loaded.
 *
 * WHY THIS COMPONENT EXISTS
 *   The fonts are loaded via `next/font` with `display: 'optional'`
 *   (layout.tsx) so there is NO swap reflow — which protects the Task 5.4
 *   CLS = 0 win, but means the JetBrains Mono FILE may not be ready on the
 *   very first paint. The DOM tape picks the font up automatically the
 *   moment the browser's font system finishes loading it (CSS re-layout
 *   handles that for free). The Canvas2D chart does NOT — `ctx.font` is
 *   measured/rastered once per paint and the engine only repaints when it
 *   is marked dirty. So a chart drawn before the font loaded keeps showing
 *   fallback-mono digits until something else happens to dirty it.
 *
 *   This bridge closes that gap: it awaits `document.fonts.ready` and then
 *   force-notifies the theme-tokens bridge, which re-derives the chart
 *   palette and marks the engine dirty, so the canvas re-paints with the
 *   now-loaded JetBrains Mono glyphs. No layout shift — only the canvas
 *   glyph pixels upgrade; the DOM box geometry is untouched.
 *
 * RENDERS NOTHING. It is a side-effect-only mount, placed high in the tree
 * (layout.tsx) so it runs regardless of which route is active.
 */
export function FontReadyBridge(): ReactNode {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // `document.fonts` exists in every browser we target; guard anyway so
    // a missing FontFaceSet (very old engines, some test envs) is a no-op
    // rather than a throw.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts === undefined || typeof fonts.ready?.then !== 'function') {
      return;
    }

    let cancelled = false;
    void fonts.ready.then(() => {
      if (cancelled) return;
      // Re-resolve `--font-mono` (and the rest of the palette) and push a
      // repaint into the chart engine so the canvas adopts JetBrains Mono.
      getThemeTokensBridge().forceNotify();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
