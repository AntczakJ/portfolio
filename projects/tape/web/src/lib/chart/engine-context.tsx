'use client';

/**
 * React glue that exposes the `FootprintChartEngine` instance to its
 * sibling React surfaces — the cell tooltip and the Follow-live pill.
 *
 * Why a context (not a singleton):
 *   - The engine instance lives for one mount. Strict-mode double
 *     mount, route navigation, and resize-driven re-creation all
 *     produce fresh engines. A module-scope singleton would silently
 *     leak across them.
 *   - The chart container owns engine creation. The tooltip + pill
 *     receive the same instance via context — no prop drilling, no
 *     re-subscription churn.
 *
 * The `useFootprintEngine` hook is a thin getter; consumers usually
 * want the higher-level hooks `useFootprintCursor` /
 * `useFootprintScroll` in sibling files.
 */
import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';

import type { FootprintChartEngine } from './footprint-engine';

const FootprintEngineContext = createContext<FootprintChartEngine | null>(null);

export function FootprintEngineProvider({
  engine,
  children,
}: {
  engine: FootprintChartEngine | null;
  children: ReactNode;
}): ReactNode {
  return (
    <FootprintEngineContext.Provider value={engine}>
      {children}
    </FootprintEngineContext.Provider>
  );
}

/**
 * Return the engine instance currently mounted in the tree, or null
 * if the consumer rendered outside a `FootprintChart`. Returning null
 * (rather than throwing) is the right call for chrome surfaces that
 * may render before the canvas has had a chance to mount its engine.
 */
export function useFootprintEngine(): FootprintChartEngine | null {
  return useContext(FootprintEngineContext);
}
