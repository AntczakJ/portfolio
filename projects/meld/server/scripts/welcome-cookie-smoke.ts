/**
 * welcome-cookie-smoke — verifies the Task 1.7b cookie ↔ welcome-frame
 * identity wire end-to-end.
 *
 * Three checks, run sequentially against a fresh `pnpm -F meld-server dev`:
 *
 *   1. **No-cookie connect mints (mintedAt: 'ws-onConnect').** Opens a
 *      WS to `/ws/board/<random-uuid>` WITHOUT a Cookie header, drives
 *      the Hocuspocus Auth handshake, asserts the welcome frame's
 *      `session.id` is a UUID v4, `session.mintedAt === 'ws-onConnect'`.
 *
 *   2. **Cookie connect reuses (mintedAt: 'cookie').** Hits
 *      `GET /api/session` to obtain a server-set cookie value, then
 *      reconnects to the same `/ws/board/<id>` WITH the `Cookie:
 *      meld_session=<id>` header attached, asserts the welcome frame's
 *      `session.id === <id>` AND `session.mintedAt === 'cookie'`.
 *
 *   3. **Two tabs same cookie produce matching session.id.** Opens two
 *      concurrent WS connections to the SAME board with the SAME cookie,
 *      asserts both welcome frames carry the same `session.id` AND that
 *      both connections each receive the welcome frame independently
 *      (the framework assigns a distinct awarenessId per connection — we
 *      do not assert on the awareness id here since the welcome frame
 *      is the load-bearing contract for session identity).
 *
 * Hocuspocus 4.1 wire format: the same Auth handshake from `ws-smoke.ts`
 * applies — `varString(documentName) + varUint(MessageType.Auth=2) +
 * varUint(AuthMessageType.Token=0) + varString(token) +
 * varString(providerVersion)`. The framework queues binary frames until
 * Auth completes, so without sending the Auth message the `connected`
 * hook never fires and we never see the welcome frame.
 *
 * Usage (after `pnpm -F meld-server dev` in another terminal, with
 * DATABASE_URL set so `POST /api/boards` works — though this smoke does
 * NOT call `POST /api/boards`, it uses arbitrary UUID-shaped board ids
 * because the welcome wire shape requires UUID v4 board ids and the
 * Hocuspocus `onConnect` storage extension short-circuits unknown UUIDs
 * to a no-op load per AGENT_NOTES "isPersistableBoardId belt-and-braces"):
 *
 *     pnpm -F meld-server tsx scripts/welcome-cookie-smoke.ts
 *
 * Exit code 0 on success, 1 on any failed check.
 */
import { randomUUID } from 'node:crypto';

import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';

import { wsControlFrameSchema } from '../src/lib/schemas/ws/frame';

const PORT = process.env.PORT ?? '3002';
const HTTP_BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:3000';
const UPGRADE_TIMEOUT_MS = 2_000;
const WELCOME_TIMEOUT_MS = 3_000;

const HP_MESSAGE_TYPE_AUTH = 2;
const HP_AUTH_TOKEN_KIND = 0;
const PROVIDER_VERSION = 'welcome-cookie-smoke-1.0.0';

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

function buildAuthMessage(documentName: string, token: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HP_MESSAGE_TYPE_AUTH);
  encoding.writeVarUint(encoder, HP_AUTH_TOKEN_KIND);
  encoding.writeVarString(encoder, token);
  encoding.writeVarString(encoder, PROVIDER_VERSION);
  return encoding.toUint8Array(encoder);
}

interface ConnectResult {
  sessionId: string;
  mintedAt: 'cookie' | 'ws-onConnect';
  emojiName: string;
}

/**
 * Open a WS, drive the Auth handshake, wait for the welcome TEXT frame,
 * parse + validate it, return the session id + mintedAt. Closes the WS
 * on completion or timeout.
 */
async function connectAndCaptureWelcome(
  boardId: string,
  cookie: string | undefined,
): Promise<ConnectResult | null> {
  const url = `ws://127.0.0.1:${PORT}/ws/board/${boardId}`;
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  const ws = new WebSocket(url, { origin: ORIGIN, headers });

  const upgraded = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), UPGRADE_TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  if (!upgraded) {
    return null;
  }

  ws.send(buildAuthMessage(boardId, ''));

  const welcome = await new Promise<ConnectResult | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), WELCOME_TIMEOUT_MS);
    const onMessage = (data: Buffer, isBinary: boolean): void => {
      if (isBinary) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      try {
        const json: unknown = JSON.parse(data.toString('utf8'));
        const frame = wsControlFrameSchema.parse(json);
        if (frame.kind !== 'welcome') {
          resolve(null);
          return;
        }
        resolve({
          sessionId: frame.session.id,
          mintedAt: frame.session.mintedAt,
          emojiName: frame.session.emojiName,
        });
      } catch {
        resolve(null);
      }
    };
    ws.on('message', onMessage);
  });

  try {
    ws.close(1000, 'smoke complete');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 100));
  return welcome;
}

/**
 * Open a WS WITHOUT closing it. Used by the two-tab concurrent test
 * where both connections must be live at the same time so they share
 * the same Hocuspocus room. Returns the welcome result + the WS so the
 * caller can close it.
 */
async function connectAndKeepOpen(
  boardId: string,
  cookie: string,
): Promise<{ welcome: ConnectResult | null; ws: WebSocket } | null> {
  const url = `ws://127.0.0.1:${PORT}/ws/board/${boardId}`;
  const ws = new WebSocket(url, {
    origin: ORIGIN,
    headers: { cookie },
  });

  const upgraded = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), UPGRADE_TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  if (!upgraded) {
    return null;
  }

  ws.send(buildAuthMessage(boardId, ''));

  const welcome = await new Promise<ConnectResult | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), WELCOME_TIMEOUT_MS);
    const onMessage = (data: Buffer, isBinary: boolean): void => {
      if (isBinary) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      try {
        const json: unknown = JSON.parse(data.toString('utf8'));
        const frame = wsControlFrameSchema.parse(json);
        if (frame.kind !== 'welcome') {
          resolve(null);
          return;
        }
        resolve({
          sessionId: frame.session.id,
          mintedAt: frame.session.mintedAt,
          emojiName: frame.session.emojiName,
        });
      } catch {
        resolve(null);
      }
    };
    ws.on('message', onMessage);
  });

  return { welcome, ws };
}

/**
 * Hit `GET /api/session` and return the Set-Cookie value for the
 * `meld_session` name. The Hono middleware mints + writes the cookie on
 * any cookie-less request.
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
  // Parse `meld_session=<uuid>; Max-Age=...; ...`
  const match = /meld_session=([^;]+)/.exec(setCookieHeader);
  if (match === null || match[1] === undefined) {
    console.error('[welcome-cookie-smoke] meld_session not in Set-Cookie');
    return null;
  }
  return match[1];
}

async function checkNoCookieMints(): Promise<void> {
  const boardId = randomUUID();
  const result = await connectAndCaptureWelcome(boardId, undefined);
  if (result === null) {
    record('no-cookie-mints', false, 'no welcome frame');
    return;
  }
  const ok = result.mintedAt === 'ws-onConnect';
  record(
    'no-cookie-mints',
    ok,
    `mintedAt=${result.mintedAt} sessionId=${result.sessionId} (emoji=${result.emojiName})`,
  );
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
    record('cookie-reuses', false, 'no welcome frame');
    return null;
  }
  const ok =
    result.mintedAt === 'cookie' && result.sessionId === cookieValue;
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
  // Open both concurrently so they share the live room.
  const [tabA, tabB] = await Promise.all([
    connectAndKeepOpen(boardId, cookieHeader),
    connectAndKeepOpen(boardId, cookieHeader),
  ]);

  if (tabA === null || tabB === null) {
    record('two-tabs-same-cookie', false, 'one or both upgrades failed');
    return;
  }

  const welcomeA = tabA.welcome;
  const welcomeB = tabB.welcome;

  if (welcomeA === null || welcomeB === null) {
    record('two-tabs-same-cookie', false, 'one or both welcomes missing');
    try {
      tabA.ws.close();
      tabB.ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

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

  try {
    tabA.ws.close(1000, 'smoke complete');
    tabB.ws.close(1000, 'smoke complete');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 100));
}

async function main(): Promise<void> {
  console.log(`[welcome-cookie-smoke] target ${HTTP_BASE}`);

  await checkNoCookieMints();
  const reusesResult = await checkCookieReuses();
  if (reusesResult !== null) {
    await checkTwoTabsSameCookie(reusesResult.cookie, reusesResult.sessionId);
  } else {
    record('two-tabs-same-cookie', false, 'skipped — cookie-reuses failed');
  }

  const allOk = results.every((r) => r.ok);
  console.log(
    `[welcome-cookie-smoke] summary: ${results.filter((r) => r.ok).length}/${String(results.length)} checks PASS`,
  );
  process.exit(allOk ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error('[welcome-cookie-smoke] uncaught error:', err);
  process.exit(1);
});
