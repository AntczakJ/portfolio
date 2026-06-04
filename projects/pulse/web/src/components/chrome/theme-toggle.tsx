'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ThemeChoice = 'light' | 'dark' | 'system';

const ORDER: readonly ThemeChoice[] = ['light', 'dark', 'system'];

const LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * Theme toggle — cycles light -> dark -> system.
 *
 * The `theme` value (which may be `'system'`) drives the cycle, while the
 * resolved scheme drives the visible icon. A mount guard keeps SSR
 * rendering an inert, stable button (no theme mismatch / hydration
 * flicker) — the real cycle only runs after hydration, the documented
 * next-themes pattern.
 */
export function ThemeToggle(): ReactNode {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (theme as ThemeChoice | undefined) ?? 'system';

  function cycle(): void {
    const index = ORDER.indexOf(current);
    const next = ORDER[(index + 1) % ORDER.length] ?? 'system';
    setTheme(next);
  }

  // Before mount: render an inert placeholder so server and first client
  // paint agree. After mount: the icon reflects the resolved scheme, and
  // for `system` we show the monitor glyph.
  const icon = !mounted ? (
    <SunIcon />
  ) : current === 'system' ? (
    <MonitorIcon />
  ) : resolvedTheme === 'dark' ? (
    <MoonIcon />
  ) : (
    <SunIcon />
  );

  const label = mounted ? `Theme: ${LABEL[current]}` : 'Toggle theme';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={cycle}
          aria-label={label}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
