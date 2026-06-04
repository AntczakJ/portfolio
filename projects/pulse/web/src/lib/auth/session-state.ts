import type { SessionResponse, SessionUser } from '@/lib/api/auth';

/**
 * Pure derivation of the UI auth state from the get-session query result
 * (Task 6.5). Kept IO-free so the demo-gating decision — "does this mutation
 * proceed, or does it prompt sign-in?" — is exhaustively unit-testable without
 * a network or React.
 *
 * The product posture is ADR-007 "keep the demo open": an unauthenticated
 * visitor is NOT walled out — they read the shared demo workspace and can run
 * the demo incident. Only MUTATIONS gate. So the state has three shapes the UI
 * cares about, and one decision function the write affordances call.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  readonly status: SessionStatus;
  /** The signed-in user, or null when anonymous / still loading. */
  readonly user: SessionUser | null;
  /** Convenience flags for render branches. */
  readonly isAuthenticated: boolean;
  readonly isAnonymous: boolean;
  readonly isLoading: boolean;
}

/**
 * Derive the auth state from the raw query inputs.
 *
 * - While the session query is in-flight on first load, status is `loading`
 *   (the header shows a quiet skeleton, not a flash of "Sign in").
 * - A resolved `{ user, session }` is `authenticated`.
 * - A resolved `null` (signed out) OR a query error (API unreachable) is
 *   `anonymous` — the demo board still renders openly, so an auth-endpoint
 *   blip degrades to "anonymous + demo", never a broken dashboard.
 */
export function deriveAuthState(args: {
  data: SessionResponse | null | undefined;
  isPending: boolean;
  isError: boolean;
}): AuthState {
  const { data, isPending, isError } = args;

  if (isPending && !isError) {
    return {
      status: 'loading',
      user: null,
      isAuthenticated: false,
      isAnonymous: false,
      isLoading: true,
    };
  }

  const user = data?.user ?? null;
  if (user) {
    return {
      status: 'authenticated',
      user,
      isAuthenticated: true,
      isAnonymous: false,
      isLoading: false,
    };
  }

  return {
    status: 'anonymous',
    user: null,
    isAuthenticated: false,
    isAnonymous: true,
    isLoading: false,
  };
}

/**
 * The demo-gating decision (ADR-007). A write affordance (create/edit/delete
 * monitor, create/delete alert channel) calls this before firing its request:
 *
 *   - authenticated -> `proceed` (run the real mutation on the user's workspace)
 *   - anonymous     -> `prompt`  (open the tasteful "sign in to manage" flow)
 *   - loading       -> `prompt`  (treat as not-yet-authenticated; the prompt is
 *                                 harmless if the session resolves authenticated
 *                                 a moment later — the user just retries)
 *
 * This mirrors the server boundary exactly: reads are open, writes require a
 * session (`401 authentication_required` on the demo fallback). Intercepting on
 * the client turns that 401 into a calm prompt instead of a raw error, while a
 * 401 that slips through (a race) is still caught and routed to the same prompt.
 */
export type MutationGate = 'proceed' | 'prompt';

export function gateMutation(state: Pick<AuthState, 'isAuthenticated'>): MutationGate {
  return state.isAuthenticated ? 'proceed' : 'prompt';
}

/**
 * Was a failed request a server-side auth rejection? The demo-open backend
 * returns `401 { error: 'authentication_required' }` on a mutation by an
 * anonymous visitor. Any write that slips past the client gate (e.g. the
 * session expired mid-session) lands here and is routed to the sign-in prompt
 * rather than surfaced as a raw error.
 */
export function isAuthRequiredError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  );
}
