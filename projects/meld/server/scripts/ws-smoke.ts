/**
 * ws-smoke — Hocuspocus reachability + welcome-frame + rate-limit
 * verification for Tasks 1.4 and 1.X-control.
 *
 * Three checks, each independent:
 *
 *   1. **Upgrade.** Opens a WS against
 *      `ws://localhost:${PORT}/ws/board/${BOARD_ID}` and asserts the
 *      HTTP 101 lands within 2 s.
 *   2. **Welcome frame (ADR-004 / Task 1.X-control).** Sends the
 *      Hocuspocus 4.1 Auth handshake (`varString(documentName) +
 *      varUint(MessageType.Auth=2) + varUint(AuthMessageType.Token=0)
 *      + varString(token) + varString(providerVersion)`), then
 *      listens for the FIRST text frame on the socket, JSON-parses
 *      it, validates it via `wsControlFrameSchema.parse(...)`,
 *      asserts `kind === 'welcome'`, and checks the canonical field
 *      set — `session.id` is a UUID v4, `board.id` is a UUID v4,
 *      `origin` matches the header we sent, `protocolVersion === 1`.
 *   3. **Token-bucket rate limit (Task 1.X-control).** After the
 *      welcome arrives, floods the socket with 200 small Hocuspocus-
 *      framed messages within ~1 s, then asserts that a TEXT frame
 *      with `kind === 'control.overrun'` lands before the close,
 *      AND that the close arrives with code `4290`.
 *
 * The Hocuspocus 4.1 wire format requires an Auth handshake before
 * the `connected` hook fires (the framework queues binary frames
 * until Auth completes). A raw `ws` smoke that just opens the WS
 * would never see the welcome frame — see AGENT_NOTES Task 1.3
 * "HocuspocusProvider speaks a proprietary wire format". This smoke
 * synthesises the minimum Auth message in line rather than dragging
 * in `@hocuspocus/provider` so the smoke stays independent of the
 * provider implementation.
 *
 * Usage (after `pnpm -F meld-server dev` in another terminal):
 *
 *     pnpm -F meld-server tsx scripts/ws-smoke.ts
 *
 * Exit code 0 on success, 1 on any failed check.
 */
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';

import { wsControlFrameSchema } from '../src/lib/schemas/ws/frame';

const PORT = process.env.PORT ?? '3002';
const BOARD_ID = process.env.SMOKE_BOARD_ID ?? 'test-board-id';
const URL = `ws://127.0.0.1:${PORT}/ws/board/${BOARD_ID}`;
const ORIGIN = 'http://localhost:3000';
const UPGRADE_TIMEOUT_MS = 2_000;
const WELCOME_TIMEOUT_MS = 3_000;
const RATE_LIMIT_TIMEOUT_MS = 4_000;

/** Hocuspocus `MessageType.Auth` opcode. Verified against
 * `node_modules/@hocuspocus/server/dist/index.d.ts` line 332. */
const HP_MESSAGE_TYPE_AUTH = 2;
/** Hocuspocus `MessageType.QueryAwareness` opcode. The flood uses this
 * shape because it is the minimal-payload server-handled message that
 * does NOT mutate the in-memory `Y.Doc` and does NOT require a non-
 * empty awareness payload (MessageType.Awareness=1 would need a real
 * `varUint8Array` body that decodes through y-protocols' awareness
 * applier; an empty body causes lib0 to throw "Unexpected end of
 * array" inside `applyAwarenessUpdate` BEFORE the rate-limit
 * `beforeHandleMessage` chain runs to completion. QueryAwareness has
 * no body — server replies with the current awareness state and
 * returns cleanly, which is exactly what we need to exercise the
 * `beforeHandleMessage` hook 200x without tripping a decoder fault). */
const HP_MESSAGE_TYPE_QUERY_AWARENESS = 3;
/** Hocuspocus inner `AuthMessageType.Token` opcode. */
const HP_AUTH_TOKEN_KIND = 0;
/** Provider version string the server records; the value content
 * doesn't affect the handshake outcome. */
const PROVIDER_VERSION = 'smoke-1.0.0';

/**
 * Build a Hocuspocus Auth message for `documentName`. Mirrors
 * `AuthenticationMessage.get(...)` in `@hocuspocus/provider`:
 *
 *   varString(documentName)
 *   varUint(MessageType.Auth=2)
 *   varUint(AuthMessageType.Token=0)
 *   varString(token)
 *   varString(providerVersion)
 */
function buildAuthMessage(documentName: string, token: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HP_MESSAGE_TYPE_AUTH);
  encoding.writeVarUint(encoder, HP_AUTH_TOKEN_KIND);
  encoding.writeVarString(encoder, token);
  encoding.writeVarString(encoder, PROVIDER_VERSION);
  return encoding.toUint8Array(encoder);
}

/**
 * Build a minimal valid Hocuspocus-framed binary message for the
 * flood — `MessageType.QueryAwareness`. Body is empty (no further
 * bytes after the type opcode). Server-side `MessageReceiver.apply`
 * routes this to `applyQueryAwarenessMessage` which composes the
 * current awareness state into a reply WITHOUT decoding any
 * client-supplied body. This is the cleanest server-load shape for
 * exercising `beforeHandleMessage` without tripping a downstream
 * y-protocols decoder fault.
 */
function buildFloodMessage(documentName: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HP_MESSAGE_TYPE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

interface CheckResult {
  name: string;
  ok: boolean;
  reason: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, reason: string): void {
  results.push({ name, ok, reason });
  console.log(`[ws-smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}: ${reason}`);
}

/** Common upgrade-wait shape — resolves true on `open`, false on
 * error / timeout. */
function waitOpen(ws: WebSocket): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), UPGRADE_TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.once('error', (err: Error) => {
      clearTimeout(timer);
      console.error('[ws-smoke] upgrade error:', err.message);
      resolve(false);
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      console.error(
        `[ws-smoke] unexpected response: ${String(res.statusCode)} ${res.statusMessage ?? ''}`,
      );
      resolve(false);
    });
  });
}

async function checkUpgradeAndWelcome(): Promise<void> {
  console.log(`[ws-smoke] (1+2) opening ${URL} with Origin: ${ORIGIN}`);
  const ws = new WebSocket(URL, { origin: ORIGIN });

  const upgraded = await waitOpen(ws);
  if (!upgraded) {
    record('upgrade', false, 'no HTTP 101 within timeout');
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }
  record('upgrade', true, 'HTTP 101 received');

  // Drive the Auth handshake so the `connected` hook fires.
  ws.send(buildAuthMessage(BOARD_ID, ''));

  // Wait for the first TEXT frame (welcome) — the server also sends
  // a BINARY auth-acknowledgement, so we filter on `isBinary`.
  const welcomeOk = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), WELCOME_TIMEOUT_MS);
    const onMessage = (data: Buffer, isBinary: boolean): void => {
      if (isBinary) return; // skip y-websocket / Hocuspocus binary
      clearTimeout(timer);
      ws.off('message', onMessage);
      try {
        const json: unknown = JSON.parse(data.toString('utf8'));
        const frame = wsControlFrameSchema.parse(json);
        if (frame.kind !== 'welcome') {
          console.error(
            `[ws-smoke] first text frame kind=${frame.kind}, expected 'welcome'`,
          );
          resolve(false);
          return;
        }
        const uuidV4Re =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        if (!uuidV4Re.test(frame.session.id)) {
          console.error(`[ws-smoke] session.id not UUID v4: ${frame.session.id}`);
          resolve(false);
          return;
        }
        if (!uuidV4Re.test(frame.board.id)) {
          console.error(`[ws-smoke] board.id not UUID v4: ${frame.board.id}`);
          resolve(false);
          return;
        }
        if (frame.origin !== ORIGIN) {
          console.error(
            `[ws-smoke] origin mismatch: got ${frame.origin}, sent ${ORIGIN}`,
          );
          resolve(false);
          return;
        }
        if (frame.protocolVersion !== 1) {
          console.error(
            `[ws-smoke] protocolVersion not 1: ${String(frame.protocolVersion)}`,
          );
          resolve(false);
          return;
        }
        console.log(
          `[ws-smoke] welcome: session=${frame.session.emojiName} ` +
            `color.H=${String(frame.session.color.H)} ` +
            `boardId=${frame.board.id} ` +
            `connections=${String(frame.board.connectionCount)}`,
        );
        resolve(true);
      } catch (err) {
        console.error('[ws-smoke] welcome parse failed:', err);
        resolve(false);
      }
    };
    ws.on('message', onMessage);
  });

  record(
    'welcome',
    welcomeOk,
    welcomeOk ? 'TEXT frame parsed, kind=welcome' : 'no valid welcome frame',
  );

  try {
    ws.close(1000, 'smoke complete (welcome)');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 100));
}

async function checkRateLimit(): Promise<void> {
  console.log(`[ws-smoke] (3) flooding ${URL} with 200 Hocuspocus frames`);
  const ws = new WebSocket(URL, { origin: ORIGIN });

  const upgraded = await waitOpen(ws);
  if (!upgraded) {
    record('rate-limit', false, 'upgrade failed');
    return;
  }

  // Send the Auth handshake to trigger `connected`.
  ws.send(buildAuthMessage(BOARD_ID, ''));

  // Wait until we've seen the welcome TEXT frame so we know the
  // `connected` hook has run. Otherwise the flood would race the
  // auth handshake.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 1_500);
    const onMessage = (_data: Buffer, isBinary: boolean): void => {
      if (isBinary) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve();
    };
    ws.on('message', onMessage);
  });

  // Listen for the overrun TEXT frame and the close code.
  let overrunSeen = false;
  let closeCode: number | null = null;
  let overrunReason: string | null = null;

  const observed = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), RATE_LIMIT_TIMEOUT_MS);
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const json: unknown = JSON.parse(data.toString('utf8'));
        const frame = wsControlFrameSchema.parse(json);
        if (frame.kind === 'control.overrun') {
          overrunSeen = true;
          overrunReason = frame.reason;
          console.log(
            `[ws-smoke] overrun frame received: reason=${frame.reason} closeCode=${String(frame.closeCode)} retryAfterMs=${String(frame.retryAfterMs)}`,
          );
        }
      } catch {
        /* ignore non-control text frames */
      }
    });
    ws.on('close', (code: number) => {
      closeCode = code;
      clearTimeout(timer);
      resolve();
    });
  });

  // Flood: 200 binary Hocuspocus frames. The token bucket has
  // capacity 100, refilling at 10 ms/token. Sending 200 frames
  // back-to-back exhausts the bucket and the 101st triggers the
  // rate-limit reject.
  const floodPayload = buildFloodMessage(BOARD_ID);
  for (let i = 0; i < 200; i += 1) {
    try {
      ws.send(floodPayload);
    } catch {
      break;
    }
  }

  await observed;

  const ok = overrunSeen && closeCode === 4290 && overrunReason === 'rate.exceeded';
  record(
    'rate-limit',
    ok,
    `overrun=${String(overrunSeen)} reason=${overrunReason ?? '<none>'} closeCode=${String(closeCode ?? '<no close>')}`,
  );
}

async function main(): Promise<void> {
  console.log(`[ws-smoke] target ${URL}`);

  await checkUpgradeAndWelcome();
  await checkRateLimit();

  const allOk = results.every((r) => r.ok);
  console.log(
    `[ws-smoke] summary: ${results.filter((r) => r.ok).length}/${String(results.length)} checks PASS`,
  );
  process.exit(allOk ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error('[ws-smoke] uncaught error:', err);
  process.exit(1);
});
