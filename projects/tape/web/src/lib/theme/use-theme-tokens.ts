'use client';

import { useSyncExternalStore } from 'react';

import {
  SSR_FALLBACK_TOKENS,
  getThemeTokensBridge,
  type ThemeTokensSnapshot,
} from './tokens';

/* -------------------------------------------------------------------------
 * useThemeTokens — React adapter for the theme tokens bridge.
 *
 * Wraps `getThemeTokensBridge()` in `useSyncExternalStore` so React
 * consumers (axis labels, cursor tooltip readouts, the dev preview
 * block) re-render when the theme flips. The hook is for React-shell
 * consumers ONLY — the Phase 3 Canvas2D footprint chart subscribes
 * directly to the bridge in its rAF loop to avoid paying a React
 * re-render per frame.
 *
 * SSR behaviour: `getServerSnapshot` returns the dark fallback (which
 * matches the next-themes `defaultTheme="system"` server-render
 * default — see `tokens.ts` SSR FALLBACK POLICY for the full
 * rationale). The first client `getSnapshot` after hydration returns
 * the actual computed-style snapshot, and React reconciles any
 * difference if the resolved theme is light or system-light.
 *
 * Snapshot stability: the bridge returns the SAME frozen object
 * reference between mutations, so `useSyncExternalStore`'s identity
 * check does not force a render on every subscription tick.
 * --------------------------------------------------------------------- */

function subscribe(callback: () => void): () => void {
  const bridge = getThemeTokensBridge();
  return bridge.subscribe(callback);
}

function getSnapshot(): ThemeTokensSnapshot {
  return getThemeTokensBridge().current();
}

function getServerSnapshot(): ThemeTokensSnapshot {
  return SSR_FALLBACK_TOKENS;
}

export function useThemeTokens(): ThemeTokensSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
