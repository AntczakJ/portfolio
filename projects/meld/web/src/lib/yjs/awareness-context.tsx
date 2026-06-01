'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Awareness } from 'y-protocols/awareness';

import { useAwareness, type UseAwarenessResult } from './use-awareness';

/**
 * `<AwarenessProvider>` + `useAwarenessContext()` — single-subscription
 * relay for the Phase 3.3 presence-cursor renderer (Task 2.5a).
 *
 *   WHY A CONTEXT
 *
 *     The cursor renderer (Phase 3.3) and the avatar stack (Phase 3.2b)
 *     will both consume the awareness snapshot. If each consumed
 *     `useAwareness(provider.awareness)` directly, each would attach
 *     its own `'change'` listener — fan-out cost is O(consumers) per
 *     awareness tick. Routing through ONE provider-level subscription
 *     and fanning out via React context costs O(1) per tick on the
 *     subscription side; the React re-render fan-out is unchanged.
 *
 *   WHY NOT ZUSTAND
 *
 *     The welcome store IS Zustand (Task 2.5b). Awareness is a
 *     different shape: it's a constantly-updating ephemeral stream
 *     rather than session-scoped state, AND the source of truth lives
 *     OUTSIDE meld (`y-protocols/awareness` owns the state Map). A
 *     Zustand mirror would double-store the data and force a
 *     reconciliation loop on every tick. The `useSyncExternalStore`
 *     adapter on the raw `Awareness` instance is the lower-friction
 *     primitive.
 *
 *   PROVIDER LIFECYCLE
 *
 *     `<BoardCanvasHost />` constructs the `HocuspocusProvider`
 *     inside `useEffect`. The provider is in a `useState` slot so it
 *     re-renders after construction; on that render the host wraps
 *     children in `<AwarenessProvider awareness={...}>` so the cursor
 *     renderer sees the live `Awareness` reference.
 *
 *     Until the provider is constructed (server render + first client
 *     render before the effect fires) the provider value is `null`.
 *     The hook handles `null` gracefully — returns the empty
 *     snapshot.
 */

const AwarenessContext = createContext<UseAwarenessResult>({
  local: null,
  remote: [],
});

interface AwarenessProviderProps {
  /**
   * The `Awareness` instance from the active `HocuspocusProvider`. Pass
   * `null` while the host is still constructing — children will read
   * the empty snapshot through `useAwarenessContext()`.
   */
  awareness: Awareness | null;
  children: ReactNode;
}

export function AwarenessProvider({
  awareness,
  children,
}: AwarenessProviderProps): ReactNode {
  // ONE subscription per provider — the context value fans out to N
  // consumers without N listeners on `Awareness`.
  const snapshot = useAwareness(awareness);

  // Stabilise the value object so context consumers re-render only
  // when the snapshot fields actually change. `useAwareness` already
  // memoises by signature; this `useMemo` is a defensive seam — if a
  // future refactor of `useAwareness` returns a fresh object more
  // often, the context's identity stays stable as long as the field
  // references do.
  const value = useMemo<UseAwarenessResult>(
    () => ({ local: snapshot.local, remote: snapshot.remote }),
    [snapshot.local, snapshot.remote],
  );

  return (
    <AwarenessContext.Provider value={value}>
      {children}
    </AwarenessContext.Provider>
  );
}

/**
 * Read the current awareness snapshot inside a child component. Safe
 * to call when no `<AwarenessProvider>` is in the tree — returns the
 * empty default snapshot.
 *
 * Phase 3.3 consumes this from `<PresenceCursors />` after the engine
 * has been migrated to read the awareness state through this context
 * rather than the raw `Awareness` instance.
 */
export function useAwarenessContext(): UseAwarenessResult {
  return useContext(AwarenessContext);
}
