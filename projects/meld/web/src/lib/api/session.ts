import { cache } from 'react';
import { headers } from 'next/headers';
import type { InferResponseType } from 'hono/client';

import { api } from '@/lib/api/client';

/**
 * Server-side identity fetch for the brand-corner badge (Task 2.5b).
 *
 * Runs in a Server Component on every render. Forwards the incoming
 * request's `Cookie` header to `GET /api/session` so the same
 * `meld_session` cookie that drives the WS welcome frame also drives
 * the SSR identity. Wrapped in React `cache(...)` so multiple
 * consumers in the same render tree (e.g., layout + page calling
 * `getInitialIdentity()` independently) collapse to a single network
 * round-trip.
 *
 * On API error (server down, non-2xx, malformed body) the helper
 * returns `null` and the badge renders the "anonymous" fallback. We
 * deliberately do NOT throw — the chrome must continue to render even
 * when the backend is offline (the `<ApiStatusDot />` is the visible
 * signal for the operator).
 *
 * Cookie roundtrip — when the Hono cookie middleware mints a fresh
 * `meld_session` (cookie was absent from the inbound request), the
 * server returns a `Set-Cookie` header. Next 15's Server Components
 * CANNOT mutate the response cookie store — `cookies().set(...)` only
 * works from Server Actions and Route Handlers. We solve the first-
 * load persistence path via Next edge middleware (`src/middleware.ts`)
 * which mints the cookie BEFORE the layout RSC runs AND injects the
 * cookie into the request headers so this helper sees the freshly-
 * minted value on the FIRST render (not just the second).
 *
 * On every subsequent render, the cookie is already in the browser
 * jar and arrives on the inbound request — this helper just forwards
 * it and the Hono middleware returns 200 without `Set-Cookie`.
 */

export type ServerSessionResponse = InferResponseType<
  typeof api.api.session.$get
>;

export const getInitialIdentity = cache(
  async (): Promise<ServerSessionResponse | null> => {
    // `headers()` is server-only and async in Next 15. Awaiting it
    // inside the cached factory is fine — `cache(...)` memoises
    // against the React render, not the input list.
    const requestHeaders = await headers();

    // Forward the entire `Cookie` header rather than serialising the
    // jar by hand — preserves any cookies the middleware might also
    // care about (none in v1, but the convention costs nothing). On
    // the first render after middleware mints, the value is the just-
    // minted UUID v4 (middleware mutated the request headers so we
    // see it without waiting for the browser-roundtrip).
    const cookieHeader = requestHeaders.get('cookie') ?? '';

    let res: Awaited<ReturnType<typeof api.api.session.$get>>;
    try {
      res = await api.api.session.$get(undefined, {
        init: {
          headers: cookieHeader ? { cookie: cookieHeader } : {},
          cache: 'no-store',
        },
      });
    } catch {
      // Network failure / DNS / refused connection — the backend is
      // down. Fall through to anonymous render.
      return null;
    }

    if (!res.ok) {
      return null;
    }

    try {
      const body = (await res.json());
      return body;
    } catch {
      return null;
    }
  },
);
