import { randomUUID } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { PulseDb } from '../db/drizzle';
import { accounts, sessions, users, verifications } from '../db/schema';

/**
 * Options the auth instance needs from the validated env (ADR-006 secrets
 * inventory: BETTER_AUTH_SECRET, BETTER_AUTH_URL + the dev web origin for the
 * cross-origin cookie posture).
 */
export interface AuthFactoryOptions {
  /** HMAC secret better-auth signs sessions / cookies with. */
  secret: string;
  /** Canonical base URL better-auth issues cookies / callbacks against. */
  baseURL: string;
  /** Browser origins trusted for cross-origin auth (the dev split-origin). */
  trustedOrigins: string[];
  /** production tightens cookie attributes (Secure + cross-site). */
  isProduction: boolean;
}

/**
 * The concrete better-auth instance type. Exported so the controller / guard
 * can type the handler + the session read without re-deriving it.
 */
export type PulseAuth = ReturnType<typeof createAuth>;

/**
 * Build the better-auth instance wired to the Pulse Drizzle handle (ADR-007).
 *
 * KEY RECONCILIATION (the Phase-1 uuid-vs-text-id flag): better-auth's default
 * user id is a TEXT id, but every Pulse FK (`monitors.user_id`, ...) points at
 * `users.id` as a `uuid`. Rather than repoint those FKs, we:
 *   - map better-auth's `user` model onto the existing `users` table
 *     (`drizzleAdapter` reads the table from the schema map), and
 *   - override id generation to emit a UUID (`advanced.database.generateId`),
 * so a signed-up user's id is a real uuid that the existing FKs accept. No FK
 * migration is needed — only the additive columns better-auth requires on
 * `users` (`email_verified`, `image`, `updated_at`), added in the Phase-6
 * migration.
 *
 * COOKIE POSTURE (dev split-origin 3081->3080 vs prod single-origin proxy,
 * ADR-006 / ADR-003 / the meld precedent):
 *   - DEV: the web (`:3081`) and the API (`:3080`) are DIFFERENT origins, so
 *     the session cookie must be sent cross-site. `crossSubDomainCookies` is
 *     off (different ports are different origins, not sub-domains); instead we
 *     rely on `trustedOrigins` + CORS `credentials: true` (set in main.ts) and
 *     `defaultCookieAttributes` `SameSite=Lax` over http for localhost. The
 *     browser sends the cookie on same-site-by-eTLD localhost requests; the
 *     dashboard `fetch`/`EventSource` use `credentials:'include'`/`withCredentials`.
 *   - PROD: the `pulse-web` Next app reverse-proxies `pulse-api`, so the
 *     browser sees ONE origin — the cookie is first-party, `Secure`, and
 *     `SameSite=Lax` is sufficient. We set `Secure` + `SameSite=Lax` in
 *     production (no cross-site cookie needed behind the proxy). This is why
 *     ADR-006 chose the single-origin proxy: it makes the cookie first-party
 *     and keeps the SSE `EventSource` (which cannot set headers, only send
 *     cookies) authenticated with no special handling.
 *
 * The cookie attributes work for `EventSource(url, { withCredentials: true })`
 * because the session lives in a normal cookie sent with the SSE GET — exactly
 * the SSE-over-cookie argument ADR-001/003 made.
 */
export function createAuth(db: PulseDb, options: AuthFactoryOptions) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    // The API is mounted under /api/auth/* (see AuthController). better-auth's
    // own base path; the controller catch-all forwards every method here.
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins,

    database: drizzleAdapter(db, {
      provider: 'pg',
      // Map better-auth's singular model names onto our table objects. `user`
      // -> the existing `users` table (the reconciliation), the rest are the
      // auth.ts tables.
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // No email-verification gate in v1 (no SMTP on the demo host — the same
      // honest "email is mocked" posture as the alert channel). A user can sign
      // in immediately after sign-up.
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },

    session: {
      // 7-day sessions, refreshed when older than 1 day (better-auth default
      // is sane; pinned explicitly so the cookie lifetime is documented).
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    advanced: {
      database: {
        // EMIT A UUID for every generated id so `users.id` is a real uuid the
        // existing FKs accept. better-auth otherwise emits its own string id.
        generateId: () => randomUUID(),
      },
      // The client IP the brute-force rate limiter keys on. Behind the
      // pulse-web reverse proxy (prod) the real client is in `x-forwarded-for`;
      // the AuthController injects it from the connecting socket in dev so the
      // limiter always has an IP (otherwise better-auth SKIPS rate limiting —
      // the §4 brute-force guard would silently no-op). `x-real-ip` is a
      // fallback some proxies set.
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      },
      // Cookie attributes for the dev-vs-prod posture documented above.
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: options.isProduction,
        httpOnly: true,
      },
    },

    // better-auth has built-in brute-force rate limiting on its endpoints
    // (sign-in / sign-up). Enabled explicitly with a tight window — a §4
    // security-bar requirement. The store is in-memory in v1 (single web
    // machine, ADR-006); a Redis store is a one-line swap for multi-replica.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      customRules: {
        // The credential endpoints get the tightest limit (brute-force guard).
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
  });
}
