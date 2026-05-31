'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme + TanStack Query.
 *
 * Kept as a single client boundary so the rest of the tree can stay on
 * Server Components by default. The QueryClient is created once per
 * client via useState — a fresh one per request on the server, a
 * stable one across re-renders on the client.
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
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
