'use client';

import { useEffect, useState } from 'react';

/**
 * Read the live theme from the `html.dark` class (Phase 5, extracted from the
 * configurator-stage pattern).
 *
 * Why a MutationObserver and not `next-themes`' `useTheme().resolvedTheme`:
 * `resolvedTheme` lags a render behind hydration (it reports `undefined` then
 * the value), which caused the configurator/hero to flash a light asset on the
 * dark stage. Reading the class next-themes writes on <html> is in sync with
 * what the page actually shows, and the observer keeps it current across a
 * theme toggle.
 *
 * SSR-safe: the default is `'light'` (the canonical default — ADR-001), so the
 * server and the first client render agree (no hydration mismatch); the real
 * value is applied as a post-mount state update. Components that switch a
 * `src`/`blurDataURL` by theme should default to the light asset for SSR.
 */
export function useThemeClass(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const read = (): void =>
      { setTheme(root.classList.contains('dark') ? 'dark' : 'light'); };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); };
  }, []);

  return theme;
}
