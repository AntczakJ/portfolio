'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface ThemeToggleProps {
  className?: string;
}

/**
 * Brand-styled theme toggle (Task 4.1).
 *
 * Light + dark via next-themes (light default — ADR-001). The "night drive"
 * dark register is intentional, so this toggle is a first-class control, not an
 * afterthought. The crossfade between the two glyphs is CSS only (ADR-002:
 * micro-interactions default to CSS, not GSAP/Motion), gated by the global
 * reduced-motion floor in globals.css.
 *
 * A mounted-gate prevents a hydration mismatch (the resolved theme is only
 * known on the client); before mount it renders a stable, correctly-sized
 * placeholder so there is no layout shift.
 */
export function ThemeToggle({ className }: ThemeToggleProps): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
      className={cn(
        'border-border text-fg-muted hover:text-foreground hover:border-border-strong relative inline-flex size-9 items-center justify-center rounded-md border transition-colors',
        className,
      )}
    >
      {/* Both glyphs are always present; opacity crossfades between them so the
          swap is smooth and there is no reflow. Hidden from the tree until
          mount to avoid a mismatch on the first paint. */}
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
