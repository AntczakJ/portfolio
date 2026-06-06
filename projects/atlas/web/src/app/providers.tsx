'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

// Side-effect import: opt zod out of its `new Function` JIT probe so the strict
// CSP (no `'unsafe-eval'`) reports zero violations — load-bearing here because
// the live WS-frame validation (Phase 4) parses on the client at runtime.
import '@/lib/zod-config';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + TanStack Query (Task 2.1).
 *
 * A single client boundary kept as low as the app shell allows
 * (docs/conventions.md § 3) so the rest of the tree stays Server Components by
 * default. The QueryClient is created once per client via useState — a fresh one
 * per request on the server, a stable one across re-renders on the client.
 *
 * Theme provider config (ADR-001/ADR-006, CLAUDE.md § 4):
 *   - `attribute="class"` — globals.css uses class-strategy theming. DARK is
 *     CANONICAL for Atlas (the control-room register), so `:root` carries the
 *     dark tokens and `.light` overrides for the clean register. next-themes
 *     writes `class="dark"` / `class="light"` on <html>.
 *   - `defaultTheme="system"` + `enableSystem` — next-themes' pre-paint inline
 *     script resolves `prefers-color-scheme` BEFORE the first paint, so a
 *     light-system visitor with no stored pref gets the light register with NO
 *     flash on the static `/about` SEO front door (P1-6 fix: `defaultTheme="dark"`
 *     ignored the system preference on first visit, so a light-system visitor
 *     first saw the dark landing). DARK stays the FALLBACK when there is no system
 *     preference (`:root` carries the dark tokens, so the server render + a
 *     no-preference client agree — still no flash, dark still canonical).
 *   - `themes={['dark', 'light']}` — exactly two registers.
 *   - `disableTransitionOnChange` — suppresses the token crossfade so the theme
 *     flip (which ALSO swaps the MapLibre basemap style, Task 2.2) is instant.
 *
 * TanStack Query holds server state from the Fastify REST surface (fleet
 * snapshot / routes / zones — Phase 6). The LIVE telemetry does NOT flow through
 * Query (it is a WebSocket push into an off-render-path store — Phase 4, the
 * "streaming surface is not Query-polling" discipline). Generous defaults here
 * suit the read-mostly definitions; `retry: 0` keeps a local/dev source honest.
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
      defaultTheme="system"
      themes={['dark', 'light']}
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
