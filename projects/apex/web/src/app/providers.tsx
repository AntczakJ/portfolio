'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

// Side-effect import: opt zod out of its `new Function` JIT probe so the
// strict CSP (no `'unsafe-eval'`) reports zero violations (see zod-config).
import '@/lib/zod-config';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + TanStack Query (Task 1.2).
 *
 * A single client boundary kept as low as the app shell allows
 * (docs/conventions.md § 3) so the rest of the tree stays Server Components
 * by default. The QueryClient is created once per client via useState — a
 * fresh one per request on the server, a stable one across re-renders on the
 * client.
 *
 * Theme provider config (ADR-001, CLAUDE.md § 4):
 *   - `attribute="class"` — globals.css uses class-strategy theming
 *     (`.dark` override over the canonical LIGHT `:root`, plus the
 *     `@custom-variant dark` for shadcn `dark:` utilities).
 *   - `defaultTheme="light"` — LIGHT is CANONICAL for this brand (the
 *     premium-modern / EV register; the deliberate contrast with
 *     razors-edge's dark-canonical identity). The dark theme is an
 *     intentional "night drive / charging-bay" register, not a fallback.
 *   - `themes={['light', 'dark']}` — exactly two, no "system" cycle in v1;
 *     `enableSystem` still lets `prefers-color-scheme` pick the initial
 *     theme, defaulting to light when unset.
 *   - `disableTransitionOnChange` — suppresses the token crossfade so the
 *     theme flip is instant, not laggy.
 *
 * TanStack Query is configured for the in-memory mock data layer (ADR-003):
 * generous `staleTime`, no refetch-on-focus (the seeded mock source never
 * changes under the user), `retry: 0` (a local source has no transient
 * failure mode to retry through).
 */
export function Providers({ children }: ProvidersProps): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 0,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={['light', 'dark']}
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
