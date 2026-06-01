'use client';

import { useEffect, useState } from 'react';

import type { HocuspocusProvider } from '@hocuspocus/provider';

import type { ConnectionState } from '@/lib/stores/ui-store';

/**
 * `useConnectionStatus` — Phase 3.4 / ADR-009 connection-state hook.
 *
 * Combines `HocuspocusProvider.status` with `navigator.onLine` per
 * ADR-009's canonical rule:
 *
 *   - `'offline'`      iff `(provider.status === 'disconnected'
 *                            AND held >= 1500 ms)
 *                           OR navigator.onLine === false`
 *   - `'reconnecting'` iff `provider.status === 'connecting'`
 *   - `'live'`         otherwise
 *
 * The 1500 ms debounce — implemented as a `setTimeout` started on
 * the `disconnected` event and cleared on the next `connected` — is
 * calibrated against measured 2026 Fly / CF / Railway edge-failover
 * windows (300–800 ms p95 documented). A WebSocket flap that resolves
 * inside the window stays invisible: the banner never appears, the
 * aria-live region never fires, the canvas never crossfades.
 *
 * `navigator.onLine === false` short-circuits the debounce because
 * the OS-level offline signal is authoritative — there is no
 * reconnection in flight to wait on.
 *
 * Null-provider handling: the hook accepts `null` (mount window
 * before `<BoardCanvasHost />` constructs the provider) and returns
 * `'reconnecting'` — semantically "not yet connected", which makes
 * the banner stay hidden during the construction race.
 *
 * Lifecycle: the hook owns its own event listeners and timer; both
 * are torn down on unmount AND on provider swap. `useEffect`'s
 * dependency array carries `provider` so a board navigation re-runs
 * the subscribe with the new instance.
 */

const DISCONNECT_DEBOUNCE_MS = 1500;

export function useConnectionStatus(
  provider: HocuspocusProvider | null,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>(() => {
    // SSR-safe initial: jsdom under Vitest exposes `navigator.onLine`
    // (default true), real browsers always do. On a node-only run the
    // typeof guard short-circuits to `true` so the initial state is
    // `'reconnecting'` for a null provider, `'live'` otherwise.
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.onLine === 'boolean' &&
      navigator.onLine === false
    ) {
      return 'offline';
    }
    if (provider === null) return 'reconnecting';
    const status = providerStatusOf(provider);
    if (status === 'connecting') return 'reconnecting';
    if (status === 'disconnected') {
      // We treat the first sample as "reconnecting" — the debounce
      // window has not yet been waited out. If it stays disconnected,
      // the timer below flips to `'offline'` on its own.
      return 'reconnecting';
    }
    return 'live';
  });

  useEffect(() => {
    // The "offline because OS says so" branch is global and does
    // not depend on the provider; track it separately so a `null`
    // provider still flips us into `'offline'` when the OS goes dark.
    let osOffline =
      typeof navigator !== 'undefined' &&
      typeof navigator.onLine === 'boolean'
        ? navigator.onLine === false
        : false;

    // Resolve the most recent provider status. We mirror it locally
    // (rather than reading provider.status every tick) so the timer
    // logic stays self-contained and unit-testable.
    let providerStatus: 'connecting' | 'connected' | 'disconnected' =
      provider === null ? 'disconnected' : providerStatusOf(provider);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const applyState = (): void => {
      // OS-offline ALWAYS wins — no debounce, no provider check. The
      // OS knows.
      if (osOffline) {
        setState('offline');
        return;
      }
      if (providerStatus === 'connecting') {
        setState('reconnecting');
        return;
      }
      if (providerStatus === 'disconnected') {
        // The timer governs the offline transition. Until it fires,
        // we stay in `'reconnecting'` so the banner does NOT flash on
        // a single dropped frame (the ADR-009 flap-suppression rule).
        setState('reconnecting');
        return;
      }
      setState('live');
    };

    const armDisconnectTimer = (): void => {
      if (timeoutHandle !== null) return;
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        // Re-check the conditions at fire time: the provider may have
        // raced back to `connected` between the timer arm and now.
        if (osOffline) {
          setState('offline');
          return;
        }
        if (providerStatus === 'disconnected') {
          setState('offline');
        }
      }, DISCONNECT_DEBOUNCE_MS);
    };

    const clearDisconnectTimer = (): void => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    // -----------------------------------------------------------------
    // Provider subscription. Hocuspocus emits `'status'` on every state
    // transition with `{ status: WebSocketStatus }`. We only care about
    // the three string literals — the WebSocketStatus enum's values
    // happen to BE those strings, so a runtime string comparison works
    // and we avoid pulling in the enum at the type seam.
    // -----------------------------------------------------------------
    const handleStatus = (payload: { status: string }): void => {
      providerStatus = payload.status as typeof providerStatus;
      if (providerStatus === 'connected') {
        clearDisconnectTimer();
      } else if (providerStatus === 'disconnected') {
        armDisconnectTimer();
      }
      applyState();
    };

    if (provider !== null) {
      // Type-level: HocuspocusProvider's `on` is overloaded; passing
      // `'status'` returns the typed handler signature above. Cast is
      // unnecessary at runtime — the framework wires it.
      provider.on('status', handleStatus);
      // Seed: if the provider was already disconnected at subscribe
      // time, arm the debounce timer so the OS-offline-style entry is
      // covered.
      if (providerStatus === 'disconnected') {
        armDisconnectTimer();
      }
    }

    // -----------------------------------------------------------------
    // Browser online/offline events. These attach to `window` because
    // `window.online` is the documented event name (it does NOT fire
    // on the `Navigator` object).
    // -----------------------------------------------------------------
    const handleOnline = (): void => {
      osOffline = false;
      // Coming back online with a healthy provider IS the live state.
      // If the provider is still mid-disconnect, the debounce timer
      // (if armed) keeps us in `'reconnecting'` until it fires.
      applyState();
    };
    const handleOffline = (): void => {
      osOffline = true;
      // No debounce on OS offline.
      clearDisconnectTimer();
      applyState();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    // Run the resolver once on mount so the state matches the live
    // signals (provider may have transitioned between render and
    // effect, OS may have gone offline between render and effect).
    applyState();

    return () => {
      clearDisconnectTimer();
      if (provider !== null) {
        provider.off('status', handleStatus);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, [provider]);

  return state;
}

/**
 * Read the current status string off a `HocuspocusProvider`. The
 * framework exposes `provider.status` as the `WebSocketStatus` enum
 * which is a string enum at runtime — we narrow to the three literal
 * values we care about.
 *
 * @internal
 */
function providerStatusOf(
  provider: HocuspocusProvider,
): 'connecting' | 'connected' | 'disconnected' {
  // The `status` getter is typed `WebSocketStatus`. Its values are
  // the strings `'connecting' | 'connected' | 'disconnected'`. The
  // unknown cast is the single seam.
  const raw = (provider as unknown as { status: string }).status;
  if (raw === 'connected' || raw === 'connecting' || raw === 'disconnected') {
    return raw;
  }
  // Defensive default: an unknown status (framework upgrade adding a
  // new value) maps to `'connecting'` so the banner stays hidden
  // until the framework settles.
  return 'connecting';
}
