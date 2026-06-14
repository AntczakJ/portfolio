'use client';

import { Moon, SunMedium } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { HudButton } from './hud-button';

/**
 * The chrome theme toggle (ADR-004 §4). `next-themes` themes only the CHROME +
 * `/about` + the poster surround; the canvas STAGE stays dark in both themes
 * (theme-invariant `--stage-*` tokens). Mounted-guard avoids a hydration
 * mismatch on the icon (the server cannot know the resolved theme).
 */
export function ThemeToggle(): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme !== 'light';
  const label = mounted
    ? isDark
      ? 'Switch to light chrome'
      : 'Switch to dark chrome'
    : 'Toggle chrome theme';

  return (
    <HudButton
      iconOnly
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
    >
      {/* Render a stable icon until mounted to avoid a hydration flip. */}
      {mounted && !isDark ? (
        <Moon className="size-4" aria-hidden />
      ) : (
        <SunMedium className="size-4" aria-hidden />
      )}
    </HudButton>
  );
}
