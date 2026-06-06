'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

/**
 * MapRegion — the client boundary that DYNAMICALLY imports the MapLibre canvas.
 *
 * MapLibre GL JS is heavy and strictly browser-only (WebGL, Web Worker), so it
 * is `ssr: false` dynamic-imported behind this client boundary: it never enters
 * the server bundle, and the rest of the page (top bar, panels, the SSR floor
 * in later phases) renders + hydrates without waiting on the map chunk. The
 * fallback is the styled control-room grid so the region is never blank.
 */
const MapCanvas = dynamic(
  () => import('@/components/map/map-canvas').then((m) => m.MapCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="live-grid text-fg-subtle flex h-full w-full items-center justify-center"
        aria-hidden="true"
      >
        <span className="font-mono text-sm tracking-wider uppercase">
          Loading map
        </span>
      </div>
    ),
  },
);

export function MapRegion(): ReactNode {
  return (
    <div className="border-border h-full w-full overflow-hidden rounded-lg border">
      <MapCanvas />
    </div>
  );
}
