'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Theme toggle (Task 3.1) — dark is canonical; the light "editorial print"
 * register is the intentional alternate (CLAUDE.md § 4).
 *
 * next-themes resolves the active theme only on the client, so the icon is
 * gated behind a `mounted` flag to avoid a hydration mismatch — before
 * mount we render a fixed, non-interactive placeholder of the same size so
 * the header layout never shifts (CLS-safe). The crossfade between the two
 * glyphs is pure CSS (ADR-002: hover/active/theme = CSS), respecting
 * reduced motion via the global floor.
 *
 * Accessible: a real `<button>` with a state-describing `aria-label`,
 * keyboard-reachable, brand focus ring inherited from globals.
 */
export function ThemeToggle(): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-hidden="true"
        tabIndex={-1}
        className="text-fg-muted"
      >
        <Sun className="size-[1.05rem]" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-fg-muted hover:text-fg relative"
    >
      <Sun
        className="size-[1.05rem] scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90"
        aria-hidden="true"
      />
      <Moon
        className="absolute size-[1.05rem] scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0"
        aria-hidden="true"
      />
    </Button>
  );
}
