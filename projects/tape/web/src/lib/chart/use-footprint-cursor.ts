'use client';

/**
 * `useFootprintCursor()` — React subscriber for the chart engine's
 * cursor channel.
 *
 * The hook:
 *   1. Reads the engine instance from context.
 *   2. Subscribes once on mount, unsubscribes on unmount.
 *   3. Returns the latest `CursorSubscriberState | null`.
 *
 * Important property — re-renders only when the cursor SUBSCRIBER
 * STATE actually changes. The engine notifies on every `setCursor`,
 * but `setCursor` itself no-ops when (x, y) is unchanged. So the
 * effective render rate is one per real pointer move that produces a
 * new pixel coordinate. Moving inside the same cell still triggers a
 * re-render (the `px` field changes) — that is fine because the
 * tooltip needs to reposition; it just won't reformat data unless the
 * `cell` identity changed too.
 */
import { useEffect, useState } from 'react';

import type { CursorSubscriberState } from './footprint-engine';
import { useFootprintEngine } from './engine-context';

export function useFootprintCursor(): CursorSubscriberState | null {
  const engine = useFootprintEngine();
  const [state, setState] = useState<CursorSubscriberState | null>(null);

  useEffect(() => {
    if (engine === null) return;
    return engine.subscribeCursor((next) => {
      setState(next);
    });
  }, [engine]);

  return state;
}
