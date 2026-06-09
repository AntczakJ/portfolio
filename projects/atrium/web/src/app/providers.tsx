'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + Tooltip.
 *
 * A single client boundary kept as low as the app shell allows
 * (docs/conventions.md § 3) so the rest of the tree stays Server Components by
 * default.
 *
 * NOTE — no TanStack Query and no Motion here (ADR-002): atrium is single-library
 * GSAP with NO data fetching. There is nothing to query (the only data is the
 * build-time-validated typed `src/data/projects.ts`), and all React-state
 * micro-interaction (hover, theme crossfade, the mobile drawer, any toast) is
 * CSS, not Motion. Adding either in v2 needs its own ADR.
 *
 * Theme provider config (ADR-001, CLAUDE.md § 4):
 *   - `attribute="class"` — globals.css uses class-strategy theming (`.light`
 *     override over the canonical dark `:root`, plus the `@custom-variant dark`
 *     for shadcn `dark:` utilities).
 *   - `defaultTheme="dark"` — dark is CANONICAL for this brand. The light theme
 *     is an intentional "architectural daylight" register, not a fallback.
 *   - `themes={['light', 'dark']}` — exactly two, no "system" cycle in v1;
 *     `enableSystem` still lets `prefers-color-scheme` pick the initial theme,
 *     defaulting to dark when unset.
 *   - `disableTransitionOnChange` — suppresses the token crossfade so the theme
 *     flip is instant, not laggy.
 *
 * `TooltipProvider` wraps the tree once so primitives added in later phases (the
 * U2 disabled-repo-affordance tooltip, the directory chips) need no local
 * provider scope.
 */
export function Providers({ children }: ProvidersProps): ReactNode {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={['light', 'dark']}
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
