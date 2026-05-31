'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Minimal theme toggle. Three-state cycle: system -> light -> dark.
 * Lives in the page footer rather than the header for v1 — we will
 * replace it with the proper toolbar control in Phase 2.3.
 */
export function ThemeToggle(): ReactNode {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — render an inert placeholder until mounted.
  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (theme ?? 'system') : 'system';
  const resolved = mounted ? (resolvedTheme ?? 'dark') : 'dark';

  const next: Record<string, string> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  };

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next[current] ?? 'system');
      }}
      className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2.5 py-1 font-mono text-xs text-(--color-fg-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-fg)"
      aria-label={`Theme: ${current} (resolved: ${resolved}). Click to switch.`}
    >
      theme: {current}
    </button>
  );
}
