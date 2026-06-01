'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + TanStack Query + Tooltip.
 *
 * Kept as a single client boundary so the rest of the tree stays on
 * Server Components by default. The QueryClient is created once per
 * client via useState — a fresh one per request on the server, a
 * stable one across re-renders on the client.
 *
 * Theme provider config:
 *   - `attribute="data-theme"` — globals.css overrides target
 *     `:root[data-theme='dark']`. Class-strategy fallback also wired
 *     in globals.css for future shadcn primitives that might key off
 *     `:root.dark`.
 *   - `defaultTheme="light"` — meld is a paper-canvas creative tool;
 *     light is canonical per PLAN.md "warm-paper light theme".
 *   - `themes={['light', 'dark']}` + `enableSystem` — Task 2.3 added
 *     the third "system" option so the chrome theme toggle can cycle
 *     light -> dark -> system. The Task 2.1 note about hydration
 *     flicker stands: we mitigate by gating the toggle's visible
 *     state behind a mount guard inside the component, so SSR always
 *     renders the inert label and the real cycle only runs after
 *     hydration. No flicker.
 *   - `disableTransitionOnChange` — prevents the OKLCH bg crossfade
 *     from looking laggy during the flip.
 *
 * `TooltipProvider` wraps the tree at the root so any tooltip
 * primitive added below (the chrome theme toggle, future toolbar
 * buttons in Phase 2.6) does not need a local provider scope.
 * `delayDuration={300}` matches Linear's tooltip feel — fast enough
 * to feel responsive without firing on accidental hover.
 */
export function Providers({ children }: ProvidersProps): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      themes={['light', 'dark']}
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
