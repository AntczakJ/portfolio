'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface ThemeToggleProps {
  className?: string;
}

/**
 * Control-room theme toggle (Task 2.1).
 *
 * Dark + light via next-themes (DARK canonical — the control-room register).
 * Switching theme ALSO swaps the MapLibre basemap style (MapCanvas bridges
 * `resolvedTheme` → `controller.setTheme`), so this toggle drives the whole
 * surface, not just the chrome. The glyph crossfade is CSS only, gated by the
 * global reduced-motion floor.
 *
 * A mounted-gate prevents a hydration mismatch (the resolved theme is only known
 * on the client); before mount it renders a stable, correctly-sized placeholder
 * so there is no layout shift.
 */
export function ThemeToggle({ className }: ThemeToggleProps): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme !== 'light';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
      className={cn(
        'border-border text-fg-muted hover:text-foreground hover:border-border-strong relative inline-flex size-8 items-center justify-center rounded-md border transition-colors',
        className,
      )}
    >
      <Sun
        className={cn(
          'absolute size-4 transition-opacity duration-300',
          mounted && isDark ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />
      <Moon
        className={cn(
          'absolute size-4 transition-opacity duration-300',
          mounted && !isDark ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
