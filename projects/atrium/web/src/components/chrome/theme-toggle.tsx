'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Theme toggle (Task 3.1). Flips between the canonical dark and the intentional
 * light "architectural daylight" theme via next-themes.
 *
 * Per ADR-002 the crossfade is CSS, NOT Motion — the two icons cross-dissolve via
 * `transition` + `opacity`/`transform` keyed off the resolved theme, and the
 * reduced-motion floor in globals.css collapses that transition to ~0ms. No JS
 * animation library is involved.
 *
 * SSR/hydration: next-themes cannot know the resolved theme on the server, so we
 * render a stable, theme-agnostic placeholder until mounted, then swap in the
 * live icon — this avoids a hydration mismatch and a wrong-icon flash. The button
 * is always present and focusable; only the icon's identity waits for mount.
 */
export function ThemeToggle({ className }: { className?: string }): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
      }}
      aria-label={
        mounted
          ? `Switch to ${next} theme`
          : 'Toggle colour theme'
      }
      className={cn(
        'border-border-strong text-fg-muted hover:text-fg hover:border-light/60 relative inline-flex size-9 items-center justify-center rounded-md border bg-transparent transition-colors',
        className,
      )}
    >
      {/* Both icons are rendered and cross-faded so there is no layout shift on
          toggle; only the visible one is non-transparent. Before mount, both are
          hidden so neither theme's icon flashes incorrectly. */}
      <Sun
        aria-hidden
        className={cn(
          'absolute size-4 transition-[opacity,transform] duration-300',
          mounted && !isDark
            ? 'scale-100 opacity-100'
            : 'scale-75 opacity-0',
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          'absolute size-4 transition-[opacity,transform] duration-300',
          mounted && isDark ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
      />
    </button>
  );
}
