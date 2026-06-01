import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';

/**
 * Edge middleware — anonymous session cookie hydration (Task 2.5b).
 *
 * The `meld_session` cookie is the SSR identity source for the brand-
 * corner badge. Hono's cookie middleware on the backend writes the
 * cookie in response to any `/api/session` GET, but `cookies().set()`
 * from a Next Server Component throws in Next 15 — only Server
 * Actions and Route Handlers may mutate the cookie store. To get the
 * cookie persisted on the FIRST page load (so the SSR identity stays
 * stable across refresh), we mint it here in middleware before the
 * layout RSC ever runs.
 *
 * Flow:
 *
 *   1. Request arrives at any HTML route (excluded: static assets,
 *      `_next/*`, `/api/*`).
 *   2. If `meld_session` cookie is already present, pass through.
 *   3. Otherwise, fetch `${env.apiUrl}/api/session` to mint. The Hono
 *      cookie middleware mints + returns the new id + writes
 *      `Set-Cookie`; we copy the cookie value onto our outbound
 *      `NextResponse`.
 *   4. ALSO inject the just-minted cookie into the request's
 *      `headers` so the downstream RSC server-fetch (`getInitialIdentity`)
 *      sees the cookie on THIS request and not just on the next one.
 *
 * On backend down (mint fetch throws / non-2xx): pass through without
 * a cookie. The badge renders its anonymous fallback, and the next
 * page load tries again. The chrome stays whole.
 *
 * Cookie attributes mirror Hono middleware (ADR-005 verbatim):
 *   - `HttpOnly: false` — JS-readable for v1 (no write authorization
 *     tied to the id, so XSS-exfiltration delta is zero meaningful).
 *   - `SameSite: Lax` — admits the cross-site share-link path.
 *   - `Path: '/'` — every route reads it.
 *   - `Max-Age: 1 year` — matches the server middleware constant.
 *   - `Secure` — derived from the inbound `x-forwarded-proto` header
 *     OR `NODE_ENV === 'production'`. In production the cookie is
 *     always Secure even if the header is missing (defence-in-depth
 *     against a misconfigured edge).
 *
 * Edge-runtime constraint: this file MUST be edge-compatible. No
 * `node:*` imports. `fetch` and `URL` are global. The Hono RPC client
 * (`hc<App>`) is NOT used here because the cookie copy needs raw
 * access to the `Set-Cookie` header which `hc` does not surface
 * directly enough — `fetch(...)` + `res.headers.get('set-cookie')` is
 * the minimal path.
 */

const SESSION_COOKIE_NAME = 'meld_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 31_536_000; // 1 year

function shouldHandle(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  // Static assets + Next internals + the API surface itself must
  // pass through untouched. `/api/*` is the backend proxy / route
  // handlers — letting the middleware double-fetch on those paths
  // would loop.
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path === '/favicon.ico' ||
    path === '/og.png' ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico')
  ) {
    return false;
  }
  return true;
}

interface MintedSession {
  cookieValue: string;
}

async function mintSession(): Promise<MintedSession | null> {
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}/api/session`, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    return null;
  }
  const firstSegment = setCookie.split(';', 1)[0] ?? '';
  const eqIdx = firstSegment.indexOf('=');
  if (eqIdx <= 0) {
    return null;
  }
  const name = firstSegment.slice(0, eqIdx).trim();
  const value = firstSegment.slice(eqIdx + 1).trim();
  if (name !== SESSION_COOKIE_NAME || !value) {
    return null;
  }
  return { cookieValue: value };
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!shouldHandle(request)) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const minted = await mintSession();
  if (!minted) {
    return NextResponse.next();
  }

  // Inject the cookie into the request headers so the downstream RSC
  // server-fetch (`getInitialIdentity`) sees it on THIS render — not
  // just the next page load. `NextResponse.next({ request: { ... } })`
  // is the Next 15 path for mutating the incoming-request view.
  const requestHeaders = new Headers(request.headers);
  const existingCookie = requestHeaders.get('cookie') ?? '';
  const augmentedCookie = existingCookie
    ? `${existingCookie}; ${SESSION_COOKIE_NAME}=${minted.cookieValue}`
    : `${SESSION_COOKIE_NAME}=${minted.cookieValue}`;
  requestHeaders.set('cookie', augmentedCookie);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Detect the secure-cookie posture the same way Hono does on the
  // server side (mirrors ADR-006's `isRequestSecure(c)` rule).
  const proto = request.headers.get('x-forwarded-proto');
  const secure =
    proto === 'https' || process.env.NODE_ENV === 'production';

  response.cookies.set(SESSION_COOKIE_NAME, minted.cookieValue, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    secure,
  });

  return response;
}

export const config = {
  // Match all routes except static files + Next internals + favicon
  // family. This is the matcher recommended by the Next App Router
  // docs for a "run on every page render" middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
};
