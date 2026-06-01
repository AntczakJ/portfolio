/**
 * Anonymous-session cookie middleware (ADR-005 / Task 1.7a).
 *
 * Reads the `meld_session` cookie on every request. If valid UUID v4 is
 * present, derives the session-scoped identity (emoji + name) and
 * stashes it on the Hono context for downstream handlers via
 * `c.set('session', ...)`. If absent or malformed, mints a fresh UUID
 * v4 via `node:crypto.randomUUID()`, writes the cookie via
 * `setCookie(c, 'meld_session', ...)`, and stashes the same context.
 *
 * Cookie attribute set — pinned by ADR-005 / AGENT_NOTES.md and
 * REPRODUCED HERE so future readers do not have to cross-reference:
 *
 *   - Name:     `meld_session`
 *   - Value:    UUID v4 (36-char lowercase hyphenated)
 *   - HttpOnly: false  — JS-readable for first-paint identity card
 *                        render on the web side. The XSS-readability
 *                        delta is zero in v1 because anonymous
 *                        identity has no write authorization tied to
 *                        it.
 *   - Secure:   true in production OR when X-Forwarded-Proto is https,
 *               false otherwise (localhost dev parity). See ADR-006:
 *               production forces `true` regardless of header so a
 *               platform misconfiguration that drops the header does
 *               NOT silently produce a cookie that fails to attach
 *               to `wss://` upgrades.
 *   - SameSite: Lax   — share-link from email / Slack must set cookie
 *                        on first cross-site arrival; v1 has no
 *                        iframe-embed so None is not a candidate.
 *   - Path:     `/`
 *   - Domain:   unset (host-only — future `api.meld.example.com` does
 *                        NOT silently share the session).
 *   - Max-Age:  31_536_000 seconds (1 year).
 *
 * Per-board awareness color is NOT computed here — it depends on
 * `boardId`, which is a path parameter on the WS route, not visible to
 * a generic HTTP middleware. The welcome-frame builder (Task 1.7b)
 * resolves the color once it knows the board.
 *
 * Hono context augmentation: the middleware writes to
 * `c.set('session', SessionContext)`. Apps that mount this middleware
 * SHOULD type their Hono instance as
 *   new Hono<{ Variables: MeldVariables }>()
 * so `c.get('session')` resolves to a typed value rather than `any`.
 * The `MeldVariables` type is exported from this file.
 */

import { randomUUID } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

import { UUID_V4_REGEX } from './cookie-parser';
import { emojiFor } from './emoji';
import type { EmojiName } from './emoji-names';
import { sessionMetrics } from './metrics';

/** Cookie name — pinned by ADR-005. */
export const SESSION_COOKIE_NAME = 'meld_session';

/** Cookie max-age in seconds — 1 year per ADR-005. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 31_536_000;

/**
 * UUID v4 validation regex now lives in `cookie-parser.ts` so the Hocuspocus
 * `onConnect` extension (Task 1.7b) and this middleware share a single
 * source of truth. Same strict-lowercase 8-4-4-4-12 form `node:crypto.
 * randomUUID()` emits — re-exported via the import above.
 */

/**
 * The shape stashed on `c.set('session', ...)`. Downstream handlers
 * (and the `/api/session` route below) read this via `c.get('session')`.
 *
 *   - `id` is the UUID v4 — the canonical session id.
 *   - `emojiChar` is the resolved Unicode codepoint string from the
 *     whitelist (e.g., the otter emoji).
 *   - `emojiName` is the lowercase kebab-case ASCII aria-label
 *     ('otter'). Frontend can render `char` and bind `name` to the
 *     accessible label without recomputing the lookup.
 *
 * NOTE: per-board awareness color is NOT included. It depends on the
 * `boardId` which is only known at the WS route or board-page level;
 * Task 1.7b computes it inside the Hocuspocus welcome-frame builder
 * and ships it on the wire.
 */
export interface SessionContext {
  id: string;
  emojiChar: EmojiName;
  emojiName: string;
  /**
   * Whether this request loaded the session from a valid cookie
   * (`loaded`) or minted a fresh one because the cookie was absent
   * or malformed (`minted`). Downstream handlers and tests can branch
   * on this without re-implementing the parser; the `/api/session`
   * route does NOT expose this on the wire (it would leak first-visit
   * timing to a client that can already see its own Set-Cookie
   * header).
   */
  source: 'cookie' | 'minted';
}

/**
 * Hono Variables augmentation. Re-export so the root Hono instance
 * can typed-construct:
 *
 *     new Hono<{ Variables: MeldVariables }>()
 *
 * The augmentation is per-app (not a module-augmentation `declare`)
 * because module-augmenting Hono globally would leak the `session`
 * field into other apps that import the same Hono module — including
 * a future test harness that instantiates a standalone Hono app
 * without the session middleware. The per-app generic is local and
 * explicit.
 */
export interface MeldVariables {
  session: SessionContext;
}

/**
 * Result type for the helper that derives the session-attribute
 * decision from a request. Exposed for the `/api/session` route which
 * uses the same predicate to compute the response cookie attributes
 * outside the middleware (the middleware has already run by then;
 * the route just needs to know what attribute set was applied).
 */
export interface CookieAttributeDecision {
  secure: boolean;
}

/**
 * Decide the `Secure` flag for the cookie based on the request's
 * `X-Forwarded-Proto` header AND the `NODE_ENV` (ADR-006 verbatim).
 * Production forces `true` even when the header is missing so a
 * platform misconfiguration that drops `X-Forwarded-Proto` cannot
 * silently produce a cookie that fails the `wss://` upgrade attach.
 *
 * Extracted into its own helper so the same rule can be reused by the
 * `/api/session` POST route in Task 1.7b's cookie-disabled fallback
 * path. ADR-006's `isRequestSecure(c)` predicate at
 * `src/lib/x-forwarded-proto.ts` would be the canonical shared
 * predicate; that module hasn't landed yet, so we inline the rule here
 * and Task 1.7b's `x-forwarded-proto.ts` can re-export this helper.
 */
export function deriveCookieAttributes(
  c: Context,
  nodeEnv: string = process.env.NODE_ENV ?? 'development',
): CookieAttributeDecision {
  if (nodeEnv === 'production') return { secure: true };
  const xfp = c.req.header('x-forwarded-proto');
  return { secure: xfp === 'https' };
}

interface MiddlewareOptions {
  /** Override the env-derived NodeEnv for tests. */
  nodeEnv?: string;
  /** Inject a UUID minter for deterministic tests. */
  uuidMinter?: () => string;
}

/**
 * Build the Hono cookie middleware. The factory shape (rather than a
 * bare exported middleware function) lets tests inject a deterministic
 * UUID minter without monkey-patching `node:crypto`.
 *
 * Mount globally in `server.ts`:
 *
 *     app.use('*', createSessionCookieMiddleware());
 *
 * Order matters: this middleware MUST run before any route that wants
 * to read `c.get('session')`. Mount BEFORE the routes block.
 */
export function createSessionCookieMiddleware(
  options: MiddlewareOptions = {},
): MiddlewareHandler<{ Variables: MeldVariables }> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const mint = options.uuidMinter ?? randomUUID;

  return async (c, next) => {
    const existing = getCookie(c, SESSION_COOKIE_NAME);

    let sessionId: string;
    let source: SessionContext['source'];

    if (existing !== undefined && UUID_V4_REGEX.test(existing)) {
      sessionId = existing;
      source = 'cookie';
      sessionMetrics.recordLoad();
    } else {
      sessionId = mint();
      source = 'minted';
      sessionMetrics.recordMint();

      const { secure } = deriveCookieAttributes(c, nodeEnv);
      // Hono's `setCookie` serializes the attribute set into a
      // standards-compliant Set-Cookie header. Per ADR-005:
      //   httpOnly: false (JS-readable)
      //   sameSite: 'Lax'
      //   path:    '/'
      //   maxAge:  1 year
      //   domain:  unset (host-only)
      setCookie(c, SESSION_COOKIE_NAME, sessionId, {
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        path: '/',
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      });
    }

    const entry = emojiFor(sessionId);
    c.set('session', {
      id: sessionId,
      emojiChar: entry.char,
      emojiName: entry.name,
      source,
    });

    await next();
  };
}
