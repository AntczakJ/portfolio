'use client';

/**
 * Client-side wrapper that dynamically imports the WS provider.
 *
 * The page (`app/page.tsx`) is a Server Component; `next/dynamic` with
 * `ssr: false` only works inside a Client Component. This thin wrapper
 * holds the dynamic import so the page stays a Server Component and
 * the WS module graph (msgpackr + the client + the provider) lands in
 * its own chunk.
 *
 * Why dynamic at all: msgpackr is ~14 KB minified+gzipped runtime dep
 * per ADR-006 § Negative. Splitting it out keeps the route chunk for
 * any future non-dashboard page free of the WS / codec cost.
 */
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

const WSStreamProvider = dynamic(
  () => import('@/lib/ws/provider').then((m) => m.WSStreamProvider),
  { ssr: false },
);

export function WSProviderMount(): ReactNode {
  return <WSStreamProvider />;
}
