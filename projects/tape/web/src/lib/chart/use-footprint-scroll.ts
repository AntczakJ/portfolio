'use client';

/**
 * `useFootprintScroll()` — React subscriber for the chart engine's
 * scroll channel. Powers the Follow-live pill's visibility + click
 * handler.
 *
 * Same shape + lifecycle as `useFootprintCursor`. The engine notifies
 * only when scroll state changes (not every rAF tick), so React
 * re-renders happen at the same cadence as actual scroll movement.
 */
import { useEffect, useState } from 'react';

import type { ScrollSubscriberState } from './footprint-engine';
import { useFootprintEngine } from './engine-context';

export function useFootprintScroll(): ScrollSubscriberState | null {
  const engine = useFootprintEngine();
  const [state, setState] = useState<ScrollSubscriberState | null>(null);

  useEffect(() => {
    if (engine === null) return;
    return engine.subscribeScroll((next) => {
      setState(next);
    });
  }, [engine]);

  return state;
}
