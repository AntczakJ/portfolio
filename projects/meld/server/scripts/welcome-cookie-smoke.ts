/**
 * welcome-cookie-smoke — verifies the welcome control message + the Task
 * 1.7b cookie ↔ welcome identity wire end-to-end over the ADR-011
 * **Stateless** transport.
 *
 * This smoke opens a canonical `@hocuspocus/provider` client (the SAME
 * provider the web app uses) instead of a raw `ws` socket, so it exercises
 * the real ADR-011 path: the server sends the welcome via
 * `Connection.sendStateless`, the provider decodes the y-protocol stateless
 * envelope natively and fires its `onStateless` callback with
 * `{ payload: string }`. The pre-ADR-011 TEXT-frame path made the provider's
 * internal binary decoder throw `Unexpected end of array` once per connect;
 * this smoke asserts that error (and any other) NEVER fires on the client
 * during connect.
 *
 * Four checks, run sequentially against a fresh `meld-server`:
 *
 *   1. **Welcome arrives via onStateless + no decode error.** Opens a
 *      provider to `/ws/board/<random-uuid>` WITHOUT a cookie, waits for
 *      the `onStateless` callback, parses the payload against the control-
 *      frame schema, asserts `kind === 'welcome'`. Simultaneously a
 *      global error trap asserts NO `Unexpected end of array` (or any
 *      uncaught) error fired during connect.
 *
 *   2. **No-cookie connect mints (mintedAt: 'ws-onConnect').** Same connect
 *      as (1); asserts `session.id` is a UUID v4 and
 *      `session.mintedAt === 'ws-onConnect'`.
 *
 *   3. **Cookie connect reuses (mintedAt: 'cookie').** Hits
 *      `GET /api/session` for a server-set cookie, reconnects WITH the
 *      `Cookie: meld_session=<id>` header, asserts the welcome's
 *      `session.id === <id>` AND `session.mintedAt === 'cookie'`.
 *
 *   4. **Two tabs same cookie produce matching session.id.** Opens two
 *      concurrent providers to the SAME board with the SAME cookie, asserts
 *      both welcome payloads carry the same `session.id` and both arrive
 *      over `onStateless`.
 *
 * Usage (after a `meld-server` is listening — see the verify section of
 * the Task 1.X-stateless brief for the local-boot recipe; set PORT +
 * MELD_ALLOWED_ORIGINS to match):
 *
 *     PORT=3002 pnpm -F meld-server welcome:smoke
 *
 * Exit code 0 on success, 1 on any failed check.
 */
import { randomUUID } from 'node:crypto';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { WebSocket as WsWebSocket } from 'ws';

import { wsControlFrameSchema } from '../src/lib/schemas/ws/frame';

const PORT = process.env.PORT ?? '3002';
const HTTP_BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:3000';
const WELCOME_TIMEOUT_MS = 4_000;

interface CheckResult {
  name: string;
  ok: boolean;
  reason: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, reason: string): void {
  results.push({ name, ok, reason });
  console.log(`[welcome-cookie-smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}: ${reason}`);
}

/**
 * Global error trap — the load-bearing ADR-011 assertion. The pre-ADR-011
 * TEXT-frame welcome made the provider's internal lib0 decoder throw
 * `Unexpected end of array` on the raw 'message' event; under Stateless no
 * such error should ever fire. We watch BOTH `unhandledRejection` and
 * `uncaughtException` plus the provider's own message-decode path (whose
 * throw would surface as an uncaughtException in `ws`'s message listener).
 */
const trappedErrors: string[] = [];
process.on('unhandledRejection', (reason) => {
  trappedErrors.push(`unhandledRejection: ${String(reason)}`);
});
process.on('uncaughtException', (err) => {
  trappedErrors.push(`uncaughtException: ${String(err)}`);
});

/**
 * Build a `ws`-backed `WebSocketPolyfill` bound to a fixed Origin header
 * and (optionally) a Cookie header. The provider constructs the polyfill
 * as `new WebSocketPolyfill(url, protocols)`; subclassing lets us inject
 * the upgrade-request headers the server's Origin allowlist + cookie-read
 * extension need.
 */
function makeWebSocketPolyfill(
  cookie: string | undefined,
): typeof WsWebSocket {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  return class extends WsWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { origin: ORIGIN, headers });
    }
  } as unknown as typeof WsWebSocket;
}

interface WelcomeResult {
  sessionId: string;
  mintedAt: 'cookie' | 'ws-onConnect';
  emojiName: string;
}

/**
 * Open a provider, wait for the first `onStateless` welcome payload, parse
 * + validate it, then destroy the provider. Returns the welcome identity
 * or null on timeout / non-welcome.
 *
 * The `keepOpen` callback (used by the two-tab check) receives the live
 * provider so both can be alive at once before either is destroyed.
 */
async function connectAndCaptureWelcome(
  boardId: string,
  cookie: string | undefined,
  keepOpen?: (provider: HocuspocusProvider) => void,
): Promise<WelcomeResult | null> {
  const doc = new Y.Doc();
  let settle: (value: WelcomeResult | null) => void = () => undefined;
  const welcomePromise = new Promise<WelcomeResult | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), WELCOME_TIMEOUT_MS);
    settle = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
  });

  const provider = new HocuspocusProvider({
    // Full board path in the URL — `HocuspocusProviderWebsocket` connects
    // to `configuration.url` verbatim (the document `name` rides inside
    // the y-protocol Sync message, NOT the URL). Mirrors the web app's
    // `composeBoardUrl` (`${wsUrl}/ws/board/<id>`).
    url: `${WS_BASE}/ws/board/${encodeURIComponent(boardId)}`,
    name: boardId,
    document: doc,
    token: null,
    WebSocketPolyfill: makeWebSocketPolyfill(cookie),
    onStateless: ({ payload }) => {
      settle(parseWelcome(payload));
    },
  });

  const welcome = await welcomePromise;

  if (keepOpen !== undefined) {
    keepOpen(provider);
  } else {
    try {
      provider.destroy();
    } catch {
      /* ignore */
    }
    doc.destroy();
  }
  return welcome;
}

/**
 * Parse a stateless payload string against the control-frame schema and
 * project the welcome identity. Returns null on a parse failure or a
 * non-welcome kind — both are silent here because the caller treats a
 * null welcome as the failure.
 */
function parseWelcome(payload: string): WelcomeResult | null {
  try {
    const json: unknown = JSON.parse(payload);
    const frame = wsControlFrameSchema.parse(json);
    if (frame.kind !== 'welcome') return null;
    return {
      sessionId: frame.session.id,
      mintedAt: frame.session.mintedAt,
      emojiName: frame.session.emojiName,
    };
  } catch {
    return null;
  }
}

/**
 * Hit `GET /api/session` and return the `meld_session` Set-Cookie value.
 */
async function fetchSessionCookie(): Promise<string | null> {
  const res = await fetch(`${HTTP_BASE}/api/session`);
  if (!res.ok) {
    console.error(
      `[welcome-cookie-smoke] GET /api/session failed: ${String(res.status)}`,
    );
    return null;
  }
  const setCookieHeader =
    res.headers.get('set-cookie') ?? res.headers.get('Set-Cookie');
  if (setCookieHeader === null) {
    console.error('[welcome-cookie-smoke] no Set-Cookie on /api/session');
    return null;
  }
  const match = /meld_session=([^;]+)/.exec(setCookieHeader);
  if (match === null || match[1] === undefined) {
    console.error('[welcome-cookie-smoke] meld_session not in Set-Cookie');
    return null;
  }
  return match[1];
}

async function checkWelcomeOverStateless(): Promise<void> {
  const boardId = randomUUID();
  const errorsBefore = trappedErrors.length;
  const result = await connectAndCaptureWelcome(boardId, undefined);
  // Give any late error a tick to surface before we read the trap.
  await new Promise((r) => setTimeout(r, 150));
  const newErrors = trappedErrors.slice(errorsBefore);
  const decodeError = newErrors.find((e) =>
    e.includes('Unexpected end of array'),
  );

  if (result === null) {
    record('welcome-over-stateless', false, 'no welcome via onStateless');
  } else if (decodeError !== undefined) {
    record(
      'welcome-over-stateless',
      false,
      `welcome arrived but decode error fired: ${decodeError}`,
    );
  } else if (newErrors.length > 0) {
    record(
      'welcome-over-stateless',
      false,
      `welcome arrived but ${String(newErrors.length)} error(s) fired: ${newErrors.join('; ')}`,
    );
  } else {
    record(
      'welcome-over-stateless',
      true,
      `welcome via onStateless, kind=welcome, ZERO client errors on connect (emoji=${result.emojiName})`,
    );
  }

  // (2) no-cookie mints — same connect, separate assertion.
  if (result !== null) {
    const ok = result.mintedAt === 'ws-onConnect';
    record(
      'no-cookie-mints',
      ok,
      `mintedAt=${result.mintedAt} sessionId=${result.sessionId}`,
    );
  } else {
    record('no-cookie-mints', false, 'no welcome via onStateless');
  }
}

async function checkCookieReuses(): Promise<{
  cookie: string;
  sessionId: string;
} | null> {
  const cookieValue = await fetchSessionCookie();
  if (cookieValue === null) {
    record('cookie-reuses', false, 'failed to fetch /api/session cookie');
    return null;
  }
  const cookieHeader = `meld_session=${cookieValue}`;
  const boardId = randomUUID();
  const result = await connectAndCaptureWelcome(boardId, cookieHeader);
  if (result === null) {
    record('cookie-reuses', false, 'no welcome via onStateless');
    return null;
  }
  const ok = result.mintedAt === 'cookie' && result.sessionId === cookieValue;
  record(
    'cookie-reuses',
    ok,
    `mintedAt=${result.mintedAt} sessionId=${result.sessionId} (cookie=${cookieValue.slice(0, 8)}…)`,
  );
  return { cookie: cookieHeader, sessionId: cookieValue };
}

async function checkTwoTabsSameCookie(
  cookieHeader: string,
  expectedSessionId: string,
): Promise<void> {
  const boardId = randomUUID();
  const openProviders: HocuspocusProvider[] = [];
  const keep = (provider: HocuspocusProvider): void => {
    openProviders.push(provider);
  };

  const [welcomeA, welcomeB] = await Promise.all([
    connectAndCaptureWelcome(boardId, cookieHeader, keep),
    connectAndCaptureWelcome(boardId, cookieHeader, keep),
  ]);

  if (welcomeA === null || welcomeB === null) {
    record('two-tabs-same-cookie', false, 'one or both welcomes missing');
  } else {
    const idsMatch = welcomeA.sessionId === welcomeB.sessionId;
    const matchesExpected = welcomeA.sessionId === expectedSessionId;
    const bothCookie =
      welcomeA.mintedAt === 'cookie' && welcomeB.mintedAt === 'cookie';
    const ok = idsMatch && matchesExpected && bothCookie;
    record(
      'two-tabs-same-cookie',
      ok,
      `A.id=${welcomeA.sessionId.slice(0, 8)}… B.id=${welcomeB.sessionId.slice(0, 8)}… match=${String(idsMatch)} bothCookie=${String(bothCookie)}`,
    );
  }

  for (const provider of openProviders) {
    try {
      provider.destroy();
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 100));
}

async function main(): Promise<void> {
  console.log(`[welcome-cookie-smoke] target ${HTTP_BASE} (ADR-011 Stateless)`);

  await checkWelcomeOverStateless();
  const reusesResult = await checkCookieReuses();
  if (reusesResult !== null) {
    await checkTwoTabsSameCookie(reusesResult.cookie, reusesResult.sessionId);
  } else {
    record('two-tabs-same-cookie', false, 'skipped — cookie-reuses failed');
  }

  const allOk = results.every((r) => r.ok) && trappedErrors.length === 0;
  console.log(
    `[welcome-cookie-smoke] summary: ${results.filter((r) => r.ok).length}/${String(results.length)} checks PASS; ${String(trappedErrors.length)} client error(s) trapped`,
  );
  if (trappedErrors.length > 0) {
    console.log(
      `[welcome-cookie-smoke] trapped errors: ${trappedErrors.join(' | ')}`,
    );
  }
  process.exit(allOk ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error('[welcome-cookie-smoke] uncaught error:', err);
  process.exit(1);
});
