import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { sql as dsql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';

import { getDb, pingDb } from './db';
import { boards } from './db/schema/boards';
import { COMMIT_SHA } from './lib/commit';
import { CompactionSweep } from './lib/ingest/compaction-sweep';
import { retentionMetrics } from './lib/ingest/retention-metrics';
import { RetentionScheduler } from './lib/ingest/retention-scheduler';
import {
  healthResponseSchema,
  wsHealthResponseSchema,
  type HealthResponse,
  type WsHealthResponse,
} from './lib/schemas/health';
import {
  sessionCreateRequestSchema,
  sessionResponseSchema,
  type SessionResponse,
} from './lib/schemas/session';
import {
  createSessionCookieMiddleware,
  deriveCookieAttributes,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  type MeldVariables,
} from './lib/session/cookie';
import { emojiFor } from './lib/session/emoji';
import { sessionMetrics } from './lib/session/metrics';
import { createMeldWsServer } from './lib/ws/server';
import { storageMetrics } from './lib/ws/storage-metrics';
import { createBoardsRoutes } from './routes/boards';

/**
 * meld — Hono control plane + Hocuspocus WebSocket fan-out.
 *
 * Phase 1 layout:
 *
 *   - Task 1.1 (done): HTTP skeleton + `/health` endpoint.
 *   - Task 1.2 (done): Drizzle + Postgres scaffold; `/health` carries
 *               the `db` sub-shape via `pingDb()`.
 *   - Task 1.3 (queued): Hocuspocus Storage adapter (hybrid ops-log +
 *               debounced snapshot per ADR-003). Replaces
 *               `storage-stub` with the real persistence path.
 *   - **Task 1.4 (THIS COMMIT): Hocuspocus bootstrap on the same
 *               `http.Server` as Hono per ADR-002. Adds
 *               `/ws/board/:boardId` (WS upgrade routed to Hocuspocus)
 *               and `/health.ws` (Hocuspocus document-map snapshot +
 *               control-frame counters from `meldWs.snapshot()`).**
 *   - Task 1.5: Snapshot-chain compaction sweep + nightly retention.
 *   - Task 1.6: `POST /api/boards` endpoint.
 *   - Task 1.7a / 1.7b: anonymous session cookie + welcome-frame
 *               identity wire per ADR-005.
 *
 * Hocuspocus integration shape:
 *
 *   - We build the Node `http.Server` manually via `createServer()` and
 *     pass `getRequestListener(app.fetch)` as the request handler. The
 *     same `httpServer` instance is also the target of
 *     `meldWs.attach(httpServer)` which registers the `upgrade` event.
 *   - We use the lower-level `Hocuspocus` class (NOT the higher-level
 *     `Server` class which owns its own `http.Server`) because ADR-002
 *     pins the integration shape as "mount on the same `http.Server`".
 *   - WebSocket transport: `ws.WebSocketServer({ noServer: true })` —
 *     `maxPayload: 1 MB` configured here (ADR-002 backpressure).
 *
 * See `src/lib/ws/server.ts` for the full Hocuspocus configuration
 * (backpressure knobs, Origin allowlist, extension stubs).
 *
 * Env-var policy: no fallbacks for absent env vars on hot paths (per
 * the per-project AGENT_NOTES gotcha and tape's ADR-005 / Phase 6
 * lesson). `MELD_ALLOWED_ORIGINS` fails closed in production at
 * `createMeldWsServer()` time.
 */

const PORT = Number(process.env.PORT ?? 3002);
// Next standalone runs on this port inside the same container; the
// catch-all reverse proxy below forwards every unmatched HTTP request
// to it. Fly's edge proxy only routes external 443 to one internal
// port (the meld-server on PORT), so meld-server takes the role of
// in-container edge reverse proxy — same pattern tape's Phase 6
// settled on. WS upgrades are handled BEFORE Hono routing fires
// (httpServer.on('upgrade') is registered by meldWs.attach() below),
// so they never reach the catch-all and never get proxied.
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

// Construct the WS server FIRST so we can wire `/health.ws` against
// its snapshot accessor inside the Hono app. Failing closed on an
// empty production allowlist happens here.
const meldWs = createMeldWsServer();

// Task 1.5 background schedulers — constructed at module load so the
// `/health` handler can read their metrics, started/stopped from the
// `isEntryPoint` boot block below so a unit test that imports `app`
// without `process.argv[1]` matching the module URL does NOT start
// the timers.
//
// Retention runs on a daily 03:00 UTC cadence (boot-sweep then anchored
// on wall clock); compaction sweep runs every 6 hours rolling. Both
// hold a reference to `meldWs.hocuspocus` for the room-registry side of
// their work (broadcast-then-close on retention, early-flush on
// compaction).
const retentionScheduler = new RetentionScheduler({
  hocuspocus: meldWs.hocuspocus,
});
const compactionSweep = new CompactionSweep({
  hocuspocus: meldWs.hocuspocus,
});

/**
 * Best-effort `SELECT COUNT(*) FROM boards` for the `/health.boards`
 * extension (Task 1.6). Returns `null` when the DB is unreachable so the
 * `/health` payload still serves a structured shape — matches the
 * tolerant policy `pingDb()` already enforces.
 *
 * Acceptable for v1 demo scale (hundreds of boards across the deployment
 * lifetime — the 30-day retention sweep per ADR-003 caps unbounded
 * growth). At a six-figure board count the `COUNT(*)` walk becomes the
 * hot path's longest-running query; the swap to a materialised view or
 * a running counter column lives in the deployment / observability ADR
 * once the demo accumulates real traffic.
 */
async function countBoards(): Promise<number | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getDb();
    const [row] = await db
      .select({ count: dsql<number>`count(*)::int` })
      .from(boards);
    return row?.count ?? 0;
  } catch (err) {
    console.warn('[meld-server] countBoards failed:', err);
    return null;
  }
}

// `Hono<{ Variables: MeldVariables }>` registers the per-app context
// variables augmentation per ADR-005 / Task 1.7a — `c.set('session', ...)`
// inside the cookie middleware writes a typed `SessionContext` value
// that downstream handlers read via `c.get('session')` with full
// inference. Per-app generic is preferred over module-augmenting
// Hono's global `ContextVariableMap` interface — the latter would leak
// the `session` field into every Hono app imported in this process,
// including future test harnesses without the cookie middleware
// installed.
export const app = new Hono<{ Variables: MeldVariables }>()
  // Anonymous-session cookie middleware (Task 1.7a — ADR-005).
  //
  // MUST run before any route that reads `c.get('session')`. Mounted at
  // the top of the chain so every request, including `/health`, gets
  // the cookie set on first touch — this matches the ADR-005 contract
  // "the cookie IS the source of truth" (a viewer who hits `/health`
  // first and then loads the SPA gets the same cookie as one who hits
  // the SPA directly).
  //
  // `*` wildcard matches every path. The middleware is small enough
  // that adding it to non-API paths is a non-issue (UUID parse + emoji
  // lookup is < 50 µs).
  .use('*', createSessionCookieMiddleware())
  .get('/health', async (c) => {
    const db = await pingDb();
    const ws = meldWs.snapshot();
    const boardsCount = await countBoards();
    const storage = storageMetrics.snapshot();
    const session = sessionMetrics.snapshot();
    const retention = retentionMetrics.snapshot();
    const payload: HealthResponse = healthResponseSchema.parse({
      status: 'ok',
      commit: COMMIT_SHA,
      ts: Date.now(),
      db: { ...db, storage, retention },
      ws,
      boards: { count: boardsCount },
      session,
    });
    return c.json(payload);
  })
  .get('/health.ws', (c) => {
    // Dedicated ws endpoint per ADR-002. Same shape as the `ws`
    // sub-field on `/health` but with the standard envelope so
    // monitoring tools can scrape just the WS surface without
    // reading the (potentially DB-bound) full `/health`.
    const ws = meldWs.snapshot();
    const payload: WsHealthResponse = wsHealthResponseSchema.parse({
      status: 'ok',
      commit: COMMIT_SHA,
      ts: Date.now(),
      ws,
    });
    return c.json(payload);
  })
  // Anonymous-session identity endpoint (Task 1.7a — ADR-005).
  //
  // Returns the current session-context for the request. The cookie
  // middleware has already run (it's the first handler in the chain),
  // so `c.get('session')` always resolves to a typed value — minted
  // on this request OR loaded from the cookie. Either way the cookie
  // is present in the response headers.
  //
  // Used by the frontend to pre-render the brand-corner identity card
  // BEFORE the WS welcome frame arrives (Task 2.5b). The board-scoped
  // OKLCH color is NOT shipped here — it depends on `boardId` which
  // is a WS concern; the welcome frame carries the resolved color.
  .get('/api/session', (c) => {
    const session = c.get('session');
    const payload: SessionResponse = sessionResponseSchema.parse({
      id: session.id,
      emojiChar: session.emojiChar,
      emojiName: session.emojiName,
    });
    return c.json(payload);
  })
  // Cookie-disabled fallback / explicit-new-session endpoint
  // (Task 1.7b — ADR-005).
  //
  // Two call patterns:
  //
  //   1. **Cookie-disabled WS first-arrival.** The WS welcome frame
  //      carried `mintedAt: 'ws-onConnect'` (the server minted because
  //      the WS upgrade did not carry the `meld_session` cookie — the
  //      visitor's browser likely had cookies disabled when the page
  //      first loaded, OR they linked directly to a WS endpoint that
  //      bypassed the Hono middleware). The client POSTs the
  //      server-minted `sessionId` here; the server writes the
  //      `Set-Cookie` header via the same `deriveCookieAttributes` rule
  //      as `createSessionCookieMiddleware` (ADR-006 secure-derivation
  //      verbatim). On the next page reload the cookie is present and
  //      the welcome frame flips to `mintedAt: 'cookie'`.
  //
  //   2. **Explicit-new-session.** Client POSTs with no body to force a
  //      fresh server-minted UUID v4 (reserved — v1 has no UI surface
  //      that triggers this; v2 "log out and back in" mock would use
  //      it). The server mints, writes the cookie, returns the new
  //      identity.
  //
  // The response shape is identical to `GET /api/session` so a client
  // can reuse one parser for both.
  //
  // The cookie middleware has ALREADY run by the time we get here —
  // `c.get('session')` would resolve to a value that may or may not
  // match the `sessionId` in the request body. We deliberately ignore
  // `c.get('session')` and use the request body (or mint) as the
  // authoritative id, then OVERWRITE the cookie via setCookie. This
  // matches the "the cookie IS the source of truth" ADR-005 contract:
  // the POST endpoint exists precisely to mutate that truth.
  .post(
    '/api/session',
    zValidator('json', sessionCreateRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid-request' as const }, 400);
      }
      return undefined;
    }),
    (c) => {
      const body = c.req.valid('json');
      const sessionId = body.sessionId ?? randomUUID();
      const isReusingClientSuppliedId = body.sessionId !== undefined;

      // Increment the correct counter so /health.session is honest:
      // a body-supplied id is a "load" from the client's point of view
      // (the client already had it and is just persisting it server-
      // side); a missing body is a fresh mint here.
      if (isReusingClientSuppliedId) {
        sessionMetrics.recordLoad();
      } else {
        sessionMetrics.recordMint();
      }

      const { secure } = deriveCookieAttributes(c);
      setCookie(c, SESSION_COOKIE_NAME, sessionId, {
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        path: '/',
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      });

      const emoji = emojiFor(sessionId);
      const payload: SessionResponse = sessionResponseSchema.parse({
        id: sessionId,
        emojiChar: emoji.char,
        emojiName: emoji.name,
      });
      return c.json(payload, 201);
    },
  )
  // Board CRUD routes (Task 1.6 — ADR-001 + ADR-005).
  //
  // Mounted under `/api` so the final paths are
  // `POST /api/boards` and `GET /api/boards/:boardId`. The Hono RPC
  // client on `meld-web` reaches them as
  // `api.api.boards.$post(...)` and `api.api.boards[':boardId'].$get(...)`
  // through the type re-export in `src/app.ts`.
  //
  // The factory takes the `meldWs` server instance so `connectedClients`
  // can be read from the Hocuspocus room registry without the route file
  // importing the module-level WS singleton — keeps the routes testable
  // in isolation.
  .route('/api/boards', createBoardsRoutes(meldWs))
  // Catch-all reverse proxy: every HTTP request that did NOT match a
  // server-owned route (the Next.js page tree, static assets, image
  // requests, every client-bundled chunk) is forwarded to the
  // co-located Next standalone server on `127.0.0.1:WEB_PORT`. The
  // production deploy collapses both processes behind a single Fly
  // external port; Fly only routes 443 to one internal port, so the
  // server takes the role of in-container edge reverse proxy.
  //
  // WS upgrades NEVER reach this handler — httpServer.on('upgrade')
  // is registered by `meldWs.attach(httpServer)` below, fires on
  // every WS handshake before Hono's request listener sees the
  // request, and routes the connection to Hocuspocus. The catch-all
  // is therefore HTTP-only and safe to use the high-level fetch().
  //
  // We use Node's native `fetch` here (Node 22 LTS) over a hand-rolled
  // `http.request` streaming proxy because v1 demo traffic stays in
  // the kilobytes-per-request regime (the heaviest payload is the
  // Next standalone bundle, served exactly once per browser cache
  // lifetime). The `duplex: 'half'` flag is required when streaming a
  // request body to an upstream — Node's fetch enforces it for
  // ReadableStream bodies. Errors are swallowed into a 502 so a
  // transient Next restart does not crash the server.
  .all('*', async (c) => {
    const url = new URL(c.req.url);
    const target = `http://127.0.0.1:${String(WEB_PORT)}${url.pathname}${url.search}`;
    const init: RequestInit & { duplex?: 'half' } = {
      method: c.req.method,
      headers: c.req.raw.headers,
    };
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      init.body = c.req.raw.body;
      init.duplex = 'half';
    }
    try {
      const upstream = await fetch(target, init);
      // Node's fetch transparently decompresses the upstream body when
      // the response carries `Content-Encoding: gzip` (or br/deflate),
      // but it leaves the original encoding + length headers on the
      // Headers object. If we forward those headers verbatim the
      // browser tries to decompress an already-decompressed stream and
      // fails with `ERR_CONTENT_DECODING_FAILED`. Strip the three
      // transport-encoding headers so the browser sees the
      // post-decoded body for what it is.
      const headers = new Headers(upstream.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      console.error('[meld-server] proxy to Next failed:', err);
      return new Response('upstream error', { status: 502 });
    }
  });

export type App = typeof app;

// `import.meta.url === ...` is the Node ESM equivalent of tape's
// `import.meta.main` guard. The expression is a literal URL match against
// the entry point so `tsx` and `node --import tsx` both boot the listener,
// while a unit-test importing this file does not start the HTTP server.
const isEntryPoint = (() => {
  if (!process.argv[1]) return false;
  try {
    const entryUrl = new URL(`file://${process.argv[1].replace(/\\/g, '/')}`)
      .href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  // hostname '0.0.0.0' is explicit per tape's Phase 6 deploy-fix lesson —
  // never rely on the @hono/node-server default. Containers and edge
  // proxies (Fly, Railway) need a non-loopback bind to route external
  // traffic in.
  //
  // `getRequestListener` returns an async function; Node's
  // `createServer` accepts a sync void-returning handler, so we wrap
  // in a fire-and-forget shell. The Hono listener handles its own
  // error path inside (writes a 500 on uncaught throw); the outer
  // shell only exists to satisfy the
  // `@typescript-eslint/no-misused-promises` ESLint rule.
  const requestListener = getRequestListener(app.fetch);
  const httpServer = createServer((req, res) => {
    void requestListener(req, res);
  });
  meldWs.attach(httpServer);

  // Graceful shutdown so the WSS releases the port and pending stores
  // get a chance to flush. ADR-002 retention behaviour is unaffected by
  // shutdown — `meldWs.close()` is a best-effort flush.
  //
  // Task 1.5: stop the background schedulers BEFORE the WS close so a
  // sweep does not race with the connection close path. Both `stop()`
  // calls are sync + idempotent.
  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`[meld-server] received ${signal}, shutting down`);
    retentionScheduler.stop();
    compactionSweep.stop();
    void meldWs.close().finally(() => {
      httpServer.close(() => {
        process.exit(0);
      });
      // Hard fallback if `httpServer.close` hangs on a lingering
      // keepalive socket.
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[meld-server] http + ws listening on http://0.0.0.0:${String(PORT)} (commit=${COMMIT_SHA})`,
    );
    // Task 1.5: start the two background schedulers AFTER the listener
    // is up. Retention is async (boot sweep awaited inside `start`);
    // we void-fire so listen() does not block on the sweep — a sweep
    // failure logs but does NOT abort the process. Compaction is sync
    // (it just arms `setInterval`).
    void retentionScheduler.start().catch((err: unknown) => {
      console.error('[meld-server] retentionScheduler.start threw:', err);
    });
    compactionSweep.start();
  });
}
