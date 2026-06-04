'use client';

import { useQuery } from '@tanstack/react-query';

import { getSession, sessionQueryKey, type SessionResponse } from '@/lib/api/auth';
import { deriveAuthState, type AuthState } from '@/lib/auth/session-state';

/**
 * The single hook every surface reads to know the auth state (Task 6.4 / 6.5).
 *
 * `GET /api/auth/get-session` via TanStack Query (credentials included). The
 * query is the source of truth; sign-in / sign-up / sign-out invalidate
 * `sessionQueryKey` so the header + the gated affordances react immediately.
 *
 * `staleTime` is generous (the session does not change without an explicit
 * auth action, which invalidates it) and window-focus refetch is on so a
 * sign-in / sign-out in another tab reconciles — cheap, and it keeps the two
 * shells honest.
 */
export function useSession(): AuthState {
  const query = useQuery<SessionResponse | null>({
    queryKey: sessionQueryKey,
    queryFn: getSession,
    staleTime: 60_000,
    retry: false,
  });

  return deriveAuthState({
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
  });
}
