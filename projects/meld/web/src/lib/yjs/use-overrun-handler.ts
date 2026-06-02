'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';

import { useUiStore } from '@/lib/stores/ui-store';

import { parseOverrunFrame } from './overrun';

/**
 * `useOverrunHandler` — ADR-010 §2 client behaviour on a server `4290`
 * (backpressure / rate-exceeded) close.
 *
 * The provider receives `control.overrun` over Stateless (ADR-011),
 * routed through `handleStatelessControlMessage` → `onUnknownControlFrame`.
 * The host wires that route to the `onUnknownControlFrame` callback this
 * hook returns. On an overrun frame the hook:
 *
 *   1. Sets the ui-store `connectionState` to `'overrun'` + stashes the
 *      server-advised `retryAfterMs` — surfaced through the EXISTING
 *      `<ConnectionBanner />` + `<OfflineAriaLiveRegion />` chrome
 *      (ADR-010 U1: no new toast dependency).
 *   2. Disconnects the provider (the server has already closed us with
 *      `4290`; calling `disconnect()` stops the provider's own
 *      immediate reconnect so we can honour the server's cool-off).
 *   3. Schedules `provider.connect()` after `retryAfterMs`. On reconnect
 *      the provider's `status` event flips back to `'connected'`; the
 *      host's connection-status mirror returns `connectionState` to
 *      `'live'` and this hook clears the overrun retry hint.
 *
 * Local edits live in the `Y.Doc` throughout and sync on reconnect (the
 * ADR-009 offline guarantee — overrun is a server-initiated variant of
 * the same temporary-disconnect story). The user loses nothing.
 *
 * Calm + recoverable: the retry hint is the server's, clamped in
 * `parseOverrunFrame`. We do NOT stack a second backoff curve on top in
 * v1 — a single board's connections hitting `4290` simultaneously is the
 * reconnect-storm risk ADR-004 flags, but with `CLIENT_OP_RATE_CEILING`
 * keeping well-behaved clients off the limit, the server-advised delay
 * (already jittered server-side per the `4290` contract) is sufficient
 * for v1. The hook is the seam where a client-side jitter multiplier
 * would land if a future load test shows a storm.
 */

export interface OverrunHandler {
  /**
   * Route a control frame into the overrun handler. The host passes
   * this as `onUnknownControlFrame` to `createBoardProvider`. Frames
   * that are not `control.overrun` are ignored (returns without acting)
   * so other reserved kinds still fall through to the provider's
   * dev-warn default — but since the provider only calls `onUnknown`
   * when the host supplies it, this handler is the single sink and
   * silently drops non-overrun kinds in v1.
   */
  onUnknownControlFrame: (raw: unknown) => void;
}

export function useOverrunHandler(
  provider: HocuspocusProvider | null,
): OverrunHandler {
  const setOverrun = useUiStore((s) => s.setOverrun);
  const clearOverrun = useUiStore((s) => s.clearOverrun);

  // The provider can change across renders (board navigation); keep a
  // live ref so the stable `onUnknownControlFrame` callback always acts
  // on the current provider without re-creating the provider config.
  const providerRef = useRef<HocuspocusProvider | null>(provider);
  providerRef.current = provider;

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const onUnknownControlFrame = useCallback(
    (raw: unknown): void => {
      const frame = parseOverrunFrame(raw);
      if (frame === null) {
        // Not an overrun frame. v1 acts only on overrun here; dev-warn
        // for visibility, prod no-op.
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[meld-overrun] ignored non-overrun control frame',
            raw,
          );
        }
        return;
      }

      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[meld-overrun] server 4290 (reason=${frame.reason}); ` +
            `disconnecting, reconnecting in ${frame.retryAfterMs.toString()}ms`,
        );
      }

      setOverrun(frame.retryAfterMs);

      const activeProvider = providerRef.current;
      if (activeProvider === null) return;

      // The server has already closed us with 4290. Disconnect to stop
      // the provider's own immediate reconnect, then schedule a
      // reconnect after the server-advised cool-off.
      activeProvider.disconnect();

      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        const p = providerRef.current;
        if (p === null) return;
        // `connect()` returns a Promise that rejects if the re-handshake
        // fails (server still saturated, transient network drop). We do
        // NOT bubble that rejection — the provider keeps its own
        // status/retry machinery, and a persistent failure surfaces
        // through the host's connection-status mirror (→ offline banner).
        // Catching here just keeps the reconnect path from producing an
        // unhandled rejection on the public demo.
        p.connect().catch((err: unknown) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[meld-overrun] reconnect after 4290 failed', err);
          }
        });
        // The host's connection-status mirror flips connectionState back
        // to 'live' once the provider re-handshakes; clear the retry
        // hint here so the banner copy reverts cleanly.
        clearOverrun();
      }, frame.retryAfterMs);
    },
    [setOverrun, clearOverrun, clearReconnectTimer],
  );

  // Teardown: cancel any pending reconnect on unmount / provider swap so
  // a torn-down provider is never reconnected.
  useEffect(() => {
    return () => {
      clearReconnectTimer();
    };
  }, [provider, clearReconnectTimer]);

  return { onUnknownControlFrame };
}
