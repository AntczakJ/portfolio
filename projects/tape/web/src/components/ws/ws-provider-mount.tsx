'use client';

/**
 * ModeProviderMount — mounts EITHER the live WS provider or the replay
 * provider depending on `useUiStore.replayMode` (Task 3.6).
 *
 * The two data sources must never run at once — both feed the single
 * `useStreamStore`, so a live WS frame and a replay-bar frame fighting
 * the store would corrupt the chart. Mounting is exclusive: in `'live'`
 * the WS provider connects + streams; in `'replay'` it unmounts
 * (closing the socket) and the replay provider takes over. Crossing the
 * boundary either way resets the store — the WS provider resets +
 * reconnects for a fresh snapshot on its mount; the replay provider
 * resets + enters the historic session on its mount. The store's
 * `resetSession` is the shared reset path.
 *
 * Both providers are dynamically imported with `ssr: false`. The page
 * (`app/page.tsx`) is a Server Component; `next/dynamic` with
 * `ssr: false` only works inside a Client Component, which this is.
 * Splitting keeps the ~14 KB `msgpackr` runtime dep (WS path) and the
 * replay engine graph in route chunks that load only when the dashboard
 * renders, not in the root layout chunk (ADR-006 § Negative).
 */
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { useUiStore } from '@/lib/stores/ui-store';

const WSStreamProvider = dynamic(
  () => import('@/lib/ws/provider').then((m) => m.WSStreamProvider),
  { ssr: false },
);

const ReplayProvider = dynamic(
  () => import('@/lib/replay/provider').then((m) => m.ReplayProvider),
  { ssr: false },
);

export function WSProviderMount(): ReactNode {
  const replayMode = useUiStore((s) => s.replayMode);
  // Keying on the mode forces a full unmount→mount of the active provider
  // when the mode flips, so each provider's mount-time reset + connect /
  // enter logic runs cleanly with no stale subscriptions.
  return replayMode === 'replay' ? (
    <ReplayProvider key="replay" />
  ) : (
    <WSStreamProvider key="live" />
  );
}
