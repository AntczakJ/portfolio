'use client';

import dynamic from 'next/dynamic';
import { Suspense, type ReactNode } from 'react';

/**
 * The lazy, code-split boundary for the live R3F configurator (ADR-002 P1).
 *
 * `configurator-scene.tsx` (which imports three.js + drei + the procedural
 * model) is `next/dynamic`-imported with `ssr: false`, so:
 *   - it is NEVER server-rendered (no WebGL on the server);
 *   - three.js stays code-split OUT of the initial bundle — verified by the
 *     bundle inspection (Task 4.3/4.4): three.js chunks must be absent from the
 *     home route's initial manifest.
 *
 * The dynamic chunk is requested only when this component is rendered, which the
 * section gates on `detectWebglTier() === 'tier-1'` (and not on Tier 3) — so the
 * heavy scene does not even download on mid-tier mobile / no-WebGL clients.
 *
 * No visible loading affordance is needed here: the static AVIF render stays the
 * visible surface behind/over the canvas until the scene reports
 * reveal-when-ready (ADR-004 seam), so the user never sees an empty canvas.
 */

const ConfiguratorScene = dynamic(
  () =>
    import('./configurator-scene').then((mod) => ({
      default: mod.ConfiguratorScene,
    })),
  { ssr: false },
);

interface ConfiguratorCanvasProps {
  reveal: boolean;
  autoRotate: boolean;
  onDemote: () => void;
  theme: 'light' | 'dark';
}

export function ConfiguratorCanvas({
  reveal,
  autoRotate,
  onDemote,
  theme,
}: ConfiguratorCanvasProps): ReactNode {
  return (
    <Suspense fallback={null}>
      <ConfiguratorScene
        reveal={reveal}
        autoRotate={autoRotate}
        onDemote={onDemote}
        theme={theme}
      />
    </Suspense>
  );
}
