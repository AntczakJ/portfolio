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
 *
 * **Deferred connect (perf — Task 5.4).** Opening the socket, decoding
 * the snapshot frame through msgpackr, and seeding the store all run
 * main-thread work. Doing that DURING the initial load → interactive
 * window inflates Lighthouse Total Blocking Time for no UX benefit — the
 * chart has nothing to paint before the first frame arrives anyway. So
 * the connect is deferred behind `requestIdleCallback` (with a short
 * `setTimeout` fallback for browsers without it, and a hard cap via the
 * RIC `timeout` option). This moves the stream's main-thread cost just
 * past the interactive window while still bringing the chart alive within
 * ~1 s of load — the wow moment is preserved, it is NOT gated behind a
 * user gesture. Reduced-motion has no bearing here; this is pure work
 * scheduling, not animation.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { env } from '@/lib/env';
import { useStreamStore } from '@/lib/stores/stream-store';
import { WSStreamClient } from '@/lib/ws/client';

/**
 * Run `cb` once the browser is idle after first paint, capped so the
 * chart never waits more than ~1 s to come alive. Returns a canceller.
 * Uses `requestIdleCallback` when available (Chrome / Firefox) and falls
 * back to a `setTimeout` on Safari, which has not shipped RIC.
 */
const CONNECT_IDLE_TIMEOUT_MS = 800;
const CONNECT_FALLBACK_MS = 400;

interface IdleCapableWindow {
  requestIdleCallback?: (
    cb: () => void,
    opts?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function deferToIdle(cb: () => void): () => void {
  const w = window as Window & IdleCapableWindow;
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(cb, {
      timeout: CONNECT_IDLE_TIMEOUT_MS,
    });
    return () => {
      w.cancelIdleCallback?.(handle);
    };
  }
  const timer = window.setTimeout(cb, CONNECT_FALLBACK_MS);
  return () => {
    window.clearTimeout(timer);
  };
}

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

    // Defer the actual socket open past the interactive window. The
    // client is constructed synchronously (so unmount during the idle
    // wait still has a handle to close), but `connect()` — and the
    // msgpackr decode work it triggers on the first snapshot — waits for
    // idle. See the module docblock.
    const cancelIdle = deferToIdle(() => {
      client.connect();
    });

    return () => {
      cancelIdle();
      client.close('unmount');
      clientRef.current = null;
    };
  }, [url]);

  return children ?? null;
}
