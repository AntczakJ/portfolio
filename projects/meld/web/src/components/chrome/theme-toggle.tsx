'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUiStore, type ThemePreference } from '@/lib/stores/ui-store';

/**
 * Three-state theme toggle: light -> dark -> system -> light.
 *
 * The button is icon-only at the chrome's small size so a tooltip
 * carries the discoverable label ("Switch to dark mode" etc.). The
 * `aria-label` carries the same text for screen readers so the
 * tooltip is decorative-redundant, not load-bearing.
 *
 * Motion: the icon crossfades on theme change. 180 ms `easeOutCubic`
 * matches Linear's microinteraction feel; `prefers-reduced-motion`
 * falls back to an instant snap (no transition at all) per
 * `docs/conventions.md` § 1 a11y rule and CLAUDE.md § 4.
 *
 * State sync: next-themes is the authoritative driver of the
 * `data-theme` attribute. The Zustand `useUiStore` mirrors the
 * preference so non-React code can read it (Phase 3 presence layer
 * may want this; v1 has no other consumer yet but the wire is in).
 * We write to BOTH on every cycle — the store's persist middleware
 * keys off `meld-ui-v1` and next-themes keeps its own
 * `theme` localStorage key by default; the two stay in sync via the
 * single click handler, not via cross-store subscription.
 */

const CYCLE: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABELS: Record<ThemePreference, string> = {
  light: 'Switch to dark mode',
  dark: 'Switch to system theme',
  system: 'Switch to light mode',
};

const SR_CURRENT: Record<ThemePreference, string> = {
  light: 'Current theme: light',
  dark: 'Current theme: dark',
  system: 'Current theme: system',
};

export function ThemeToggle(): ReactNode {
  const { theme, setTheme } = useTheme();
  const setThemePreference = useUiStore((s) => s.setThemePreference);
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  // next-themes reads localStorage on the client only; before mount
  // we render an inert placeholder to avoid SSR/CSR hydration mismatch
  // on the icon swap. The button stays focusable so Tab order is
  // stable across the mount boundary.
  useEffect(() => {
    setMounted(true);
  }, []);

  const current: ThemePreference = mounted
    ? ((theme as ThemePreference | undefined) ?? 'light')
    : 'light';

  const handleClick = (): void => {
    const next = CYCLE[current];
    setTheme(next);
    setThemePreference(next);
  };

  // 180 ms ease-out-cubic per the Task 2.3 spec. Reduced motion drops
  // the transition entirely (duration 0, no exit) so the swap is
  // instantaneous.
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.33, 1, 0.68, 1] as const };

  const Icon = ICONS[current];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleClick}
          aria-label={mounted ? LABELS[current] : 'Theme toggle'}
          data-testid="theme-toggle"
          data-current-theme={current}
          className="text-(--color-fg-muted) hover:text-(--color-fg)"
        >
          <span className="sr-only">{SR_CURRENT[current]}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={current}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.85 }}
              transition={transition}
              className="inline-flex"
              aria-hidden="true"
            >
              <Icon className="size-4" />
            </motion.span>
          </AnimatePresence>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {mounted ? LABELS[current] : 'Theme'}
      </TooltipContent>
    </Tooltip>
  );
}

const ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};
