'use client';

import dynamic from 'next/dynamic';
import { Suspense, type ReactNode } from 'react';

import type { NocturneFieldProps } from './nocturne-field';

/**
 * The lazy, code-split boundary for the live GPGPU field (ADR-002 §5).
 *
 * `nocturne-field.tsx` (which imports three.js + fiber + postprocessing +
 * GPUComputationRenderer) is `next/dynamic`-imported with `ssr: false`, so it is
 * never server-rendered and three.js stays code-split OUT of the initial bundle.
 * It is requested only when the stage gates on a non-poster route, so a
 * no-WebGL / no-float client never even downloads the engine.
 */
const NocturneField = dynamic(
  () =>
    import('./nocturne-field').then((mod) => ({ default: mod.NocturneField })),
  { ssr: false },
);

export function FieldCanvas(props: NocturneFieldProps): ReactNode {
  return (
    <Suspense fallback={null}>
      <NocturneField {...props} />
    </Suspense>
  );
}
