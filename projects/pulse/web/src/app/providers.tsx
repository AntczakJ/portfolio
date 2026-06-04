'use client';

// Side-effect FIRST (client boundary): set zod `jitless` before ANY client
// chunk constructs/runs a Zod schema. The root layout also imports this, but
// that runs in the SERVER module graph; client chunks (the forms, the SSE
// envelope validator) need the flag set in the CLIENT graph too, or Zod 4's
// one-time JIT `new Function` probe fires a `securitypolicyviolation` under the
// strict no-`unsafe-eval` CSP. Providers is a client component on every route,
// so importing it here guarantees the flag is set client-side before the first
// schema runs. Idempotent. (The razors-edge CSP recipe, hardened.)
import '@/lib/zod-config';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

import { AuthDialog } from '@/components/auth/auth-dialog';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + TanStack Query + Tooltip.
 *
 * One client boundary so the rest of the tree stays on Server Components
 * by default. The QueryClient is created once per client via `useState` —
 * a fresh one per request on the server, a stable one across re-renders
 * on the client.
 *
 * Theme provider config:
 *   - `attribute="class"` — globals.css `.dark` overrides + the
 *     `@custom-variant dark` both key off the class next-themes writes on
 *     <html>, so the shadcn `dark:` utilities and the token overrides
 *     agree on first paint.
 *   - `defaultTheme="system"` — Pulse is a clean-SaaS dashboard; the
 *     canonical register is light, but a dashboard is exactly the surface
 *     a developer keeps open all day, so respecting the OS preference is
 *     the right default. `system` resolves to the OS scheme and falls back
 *     to the light :root tokens when no preference is expressed. The
 *     theme toggle (chrome) cycles light -> dark -> system.
 *   - `enableSystem` — required for the `system` default to track the OS.
 *   - `disableTransitionOnChange` — prevents the token crossfade from
 *     looking laggy during the flip (no color-transition jank on toggle).
 *
 * TanStack Query is tuned for a live-data app, but the SSE wiring is
 * Phase 3 — for now the defaults just keep refetch quiet so the shell
 * does not thrash. `staleTime` is generous because the live board's
 * freshness comes from the SSE push (Phase 3.3), not from query polling;
 * `refetchOnWindowFocus` is off for the same reason (the success
 * criterion is one `EventSource` connection, NOT a polling loop).
 *
 * `TooltipProvider` wraps the tree at the root so any tooltip primitive
 * below (the theme toggle, future monitor-card affordances) needs no local
 * provider scope. `delayDuration={200}` matches the Linear tooltip feel.
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
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          {children}
          <AuthDialog />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
