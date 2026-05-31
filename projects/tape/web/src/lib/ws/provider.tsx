'use client';

/**
 * WSStreamProvider — singleton lifecycle for the WS client.
 *
 * Constructs one `WSStreamClient` on mount, wires its callbacks to the
 * `useStreamStore` actions, calls `connect()` from a `useEffect` (so
 * SSR never touches `window`), and calls `close('unmount')` on
 * unmount.
 *
 * **Mount location.** This component is dynamically-imported from the
 * dashboard route (`app/page.tsx`) rather than statically-imported in
 * `app/layout.tsx`. Reason per ADR-006 § Negative: `msgpackr` is a
 * ~14 KB runtime dep that the v1 landing chunk should not pay for. By
 * deferring the provider's module graph behind `next/dynamic`, Next's
 * code-splitter lands `msgpackr` + the client + the store in a
 * separate chunk that loads only when the dashboard page renders.
 *
 * No SSR. The `next/dynamic` call site sets `ssr: false`, which means
 * the provider's tree never runs on the server. The status bar
 * (rendered server-side initially) reads the store via the same
 * Zustand instance — `useSyncExternalStore` returns the default
 * snapshot on first paint until the provider hydrates the live state.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { env } from '@/lib/env';
import { useStreamStore } from '@/lib/stores/stream-store';
import { WSStreamClient } from '@/lib/ws/client';

interface WSStreamProviderProps {
  children?: ReactNode;
  /** Override the URL for tests. Defaults to `env.wsUrl + '/ws/stream'`. */
  url?: string;
}

export function WSStreamProvider({
  children,
  url,
}: WSStreamProviderProps): ReactNode {
  // Stash the client in a ref so React strict-mode double-mount in dev
  // does not spin up two sockets.
  const clientRef = useRef<WSStreamClient | null>(null);

  useEffect(() => {
    // SSR guard belt-and-braces. The provider is dynamically-imported
    // with ssr: false in app/page.tsx, but this useEffect also bails
    // gracefully if for some reason the global is missing.
    if (typeof window === 'undefined') return;
    if (clientRef.current !== null) return;

    const target = url ?? `${env.wsUrl}/ws/stream`;
    const store = useStreamStore.getState();
    store.resetSession();

    const client = new WSStreamClient({
      url: target,
      onFrame: (frame) => {
        useStreamStore.getState().ingestFrame(frame);
      },
      onSnapshot: (snapshot) => {
        useStreamStore.getState().ingestSnapshot(snapshot);
      },
      onStateChange: (state) => {
        useStreamStore.getState().setConnectionState(state);
      },
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.close('unmount');
      clientRef.current = null;
    };
  }, [url]);

  return children ?? null;
}
