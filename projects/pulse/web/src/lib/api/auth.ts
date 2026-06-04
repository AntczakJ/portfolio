import { env } from '@/lib/env';

/**
 * REST client for the better-auth surface (Task 6.4, ADR-007).
 *
 * The endpoints the NestJS catch-all bridges to better-auth's handler:
 *   POST /api/auth/sign-up/email   ({ name, email, password })
 *   POST /api/auth/sign-in/email   ({ email, password })
 *   POST /api/auth/sign-out        ()
 *   GET  /api/auth/get-session     -> { user, session } | null
 *
 * EVERY call carries `credentials: 'include'` so the `better-auth.session_token`
 * cookie is set on sign-up/in and travels on subsequent reads — the same cookie
 * the SSE `EventSource(withCredentials)` uses, so the dashboard stream is
 * per-user scoped with no second credential (ADR-003 / ADR-007).
 *
 * better-auth applies CSRF protection by requiring the browser `Origin` header
 * on its POSTs; the browser sends it automatically for a same-app fetch, and in
 * the deployed single-origin proxy topology (ADR-006) the request is first-party.
 */

/** The authenticated user as better-auth returns it from get-session. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image?: string | null;
  readonly emailVerified?: boolean;
}

/** The get-session payload: `{ user, session }` when signed in, else null. */
export interface SessionResponse {
  readonly user: SessionUser;
  readonly session: { readonly id: string; readonly expiresAt: string };
}

/** Raised for a non-2xx auth response; carries the better-auth message + code. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

async function authRequest<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${env.apiUrl}/api/auth${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        message?: string;
        code?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
      code = body.code;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new AuthApiError(humanizeAuthError(message, res.status), res.status, code);
  }
  // get-session can return a 200 with an empty/`null` body when signed out.
  const text = await res.text();
  if (!text) {
    return null as T;
  }
  return JSON.parse(text) as T;
}

/** Map better-auth's terse messages to calm, user-facing copy. */
function humanizeAuthError(message: string, status: number): string {
  const lowered = message.toLowerCase();
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (lowered.includes('invalid email or password') || status === 401) {
    return 'Invalid email or password.';
  }
  if (lowered.includes('already exists') || lowered.includes('existing')) {
    return 'An account with this email already exists.';
  }
  return message || 'Something went wrong. Try again.';
}

/** GET /api/auth/get-session -> the session, or null when signed out. */
export function getSession(): Promise<SessionResponse | null> {
  return authRequest<SessionResponse | null>('/get-session');
}

export interface SignUpInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export function signUp(input: SignUpInput): Promise<SessionResponse | null> {
  return authRequest<SessionResponse | null>('/sign-up/email', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

export function signIn(input: SignInInput): Promise<SessionResponse | null> {
  return authRequest<SessionResponse | null>('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function signOut(): Promise<unknown> {
  return authRequest<unknown>('/sign-out', { method: 'POST' });
}

/** TanStack Query key for the session — the single source of auth state. */
export const sessionQueryKey = ['auth', 'session'] as const;
