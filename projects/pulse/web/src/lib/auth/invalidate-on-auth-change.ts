import type { QueryClient } from '@tanstack/react-query';

import { sessionQueryKey } from '@/lib/api/auth';

/**
 * The single owner-scoped invalidation every auth state change runs (ADR-007).
 *
 * Sign-in, sign-up AND sign-out all switch which workspace the board reflects:
 * the demo workspace's monitors/incidents/alert-channels belong to one owner,
 * a real session's belong to another. Invalidating ONLY the session query (the
 * prior bug) left the board showing the previous workspace's monitors until a
 * navigation/refetch — a visible lag right after sign-up. Mirroring sign-out's
 * behaviour, we drop every owner-scoped cache so the board, incidents, alerts,
 * and the per-monitor detail data repaint for the new session immediately.
 *
 * The keys are matched by prefix, so `['monitor', id, ...]` detail sub-queries
 * and `['incidents', 'list', ...]` namespaced lists are covered by their roots.
 * The live SSE board reconnects/reconciles off the refetched `['monitors']`
 * snapshot, so no separate stream reset is needed here.
 */
export async function invalidateOnAuthChange(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['monitors'] }),
    queryClient.invalidateQueries({ queryKey: ['monitor'] }),
    queryClient.invalidateQueries({ queryKey: ['incidents'] }),
    queryClient.invalidateQueries({ queryKey: ['alert-channels'] }),
  ]);
}
