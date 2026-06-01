import type { Connection } from '@hocuspocus/server';

import {
  AWARENESS_WHEEL,
  colorSlotFor,
} from '../session/color';
import { emojiFor } from '../session/emoji';
import {
  wsWelcomeFrameSchema,
  type WSWelcomeFramePayload,
} from '../schemas/ws/welcome';
import { sessionMetrics } from '../session/metrics';
import type { MeldConnectionContext } from './server';
import { wsMetrics } from './metrics';

/**
 * Welcome-frame emit pipeline (Task 1.X-control — ADR-004 + Task 1.7b — ADR-005).
 *
 * Sends exactly one `welcome` TEXT frame per connection after the
 * Hocuspocus `connected` hook fires (which itself fires after
 * `onConnect` + `onAuthenticate` succeed and the `Connection` object
 * has been registered in `documentConnections`). The wire is the
 * underlying `ws` socket exposed by Hocuspocus as
 * `connection.webSocket` (`WebSocketLike.send(data: string |
 * ArrayBufferLike | Blob | ArrayBufferView)`) — passing a `string`
 * produces a TEXT frame per RFC 6455, distinct from the BINARY
 * frames Hocuspocus's `Connection.send(message: Uint8Array)` ships
 * for the y-websocket sync + awareness opcodes.
 *
 * Hocuspocus raw-socket access path — verified against the installed
 * `@hocuspocus/server@4.1.0` `.d.ts`:
 *
 *   - `Connection.webSocket: WebSocketLike` (line 718 of
 *     `node_modules/@hocuspocus/server/dist/index.d.ts`).
 *   - `WebSocketLike.send(data: string | ArrayBufferLike | Blob |
 *     ArrayBufferView): void` (line 324).
 *
 * Passing a `string` to the underlying `ws` library send produces a
 * TEXT frame; passing an `ArrayBuffer` produces a BINARY frame. This
 * is the ADR-004 TEXT/BINARY split we depend on. (Hocuspocus's own
 * `sendStateless(payload: string)` does NOT send a TEXT frame — it
 * wraps the string inside a BINARY frame with opcode `5`
 * `MessageType.Stateless`; we deliberately bypass that path to keep
 * the wire form per ADR-004.)
 *
 * Session-identity sourcing (Task 1.7b).
 *
 *   The cookie-read extension at `src/lib/ws/on-connect.ts` populates
 *   `connection.context.session = { id, emojiChar, emojiName, color,
 *   colorDark, mintedAt }` from the `meld_session` cookie carried on the
 *   WS upgrade request (Task 1.7a + 1.7b). The builder consumes that
 *   payload directly — no re-hashing here. If the extension's `onConnect`
 *   never ran (extension order regression, factory not registered) the
 *   builder hits the degraded-identity fallback: minted-on-the-spot
 *   sentinel UUID `00000000-0000-4000-8000-fa11edfa11ed` (visually
 *   distinct in DevTools so a sweep operator notices), `sessionMetrics
 *   .recordWelcomeFallback()` increments, structured `console.warn` logs
 *   the affected board. The fallback is NOT silent — v1 ceiling for the
 *   counter is zero, and the deploy-verification sweep (ADR-007) can
 *   assert `welcomeFramesFallback === 0` after a known-good round.
 */

interface BoardMetadata {
  id: string;
  createdAt: number;
  connectionCount: number;
}

interface EmitWelcomeContext {
  context: MeldConnectionContext;
  boardId: string;
  board: BoardMetadata;
  origin: string;
}

/**
 * Sentinel UUID v4 used when the cookie-read extension did NOT populate
 * `connection.context.session`. The literal `fa11ed` substring is the
 * load-bearing eyeball signal — a recruiter or operator skimming the
 * welcome frame in DevTools immediately notices "fa11ed" (failed) and
 * knows the extension chain regressed. The pattern is intentionally
 * obvious vs `00000000-...-000001` (the smoke-test sentinel) so the two
 * are never confused. Version nibble `4` and variant nibble `8` preserve
 * UUID v4 shape so `wsWelcomeFrameSchema.parse` accepts it.
 */
const FALLBACK_SESSION_ID = '00000000-0000-4000-8000-fa11edfa11ed';

/**
 * Build the welcome payload from a connection's resolved identity and
 * board metadata. Pure — no I/O, no random — once the cookie-read
 * extension's `connection.context.session` is populated, the same inputs
 * produce the same payload.
 *
 * Degraded-identity fallback: if `context.session === undefined`,
 * `sessionMetrics.recordWelcomeFallback()` increments and the builder
 * derives a degraded identity from the FALLBACK_SESSION_ID sentinel.
 * The wire shape stays identical; the operator sees the sentinel id +
 * the non-zero `welcomeFramesFallback` counter on `/health.session` as
 * the distinguished signal.
 */
export function buildWelcomePayload(
  args: EmitWelcomeContext,
): WSWelcomeFramePayload {
  const { context, board, origin } = args;

  let resolvedSessionId: string;
  let emojiChar: string;
  let emojiName: string;
  let color: WSWelcomeFramePayload['session']['color'];
  let colorDark: WSWelcomeFramePayload['session']['colorDark'];
  let mintedAt: WSWelcomeFramePayload['session']['mintedAt'];

  if (context.session !== undefined) {
    // Happy path: the cookie-read extension populated the context.
    resolvedSessionId = context.session.id;
    emojiChar = context.session.emojiChar;
    emojiName = context.session.emojiName;
    color = context.session.color;
    colorDark = context.session.colorDark;
    mintedAt = context.session.mintedAt;
  } else {
    // Degraded-identity fallback path. Should not fire in v1 — the
    // cookie-read extension is wired into the same Hocuspocus
    // `extensions: [...]` array as the welcome extension, so any
    // regression here is a structural bug. The fallback exists so the
    // wire shape always parses + the counter spikes on regression so an
    // operator notices before users do.
    sessionMetrics.recordWelcomeFallback();
    console.warn(
      `[meld-ws] welcome: context.session missing for board=${args.boardId} — emitting FALLBACK identity. ` +
        'This indicates the cookie-read extension did not populate the context before the welcome hook fired.',
    );
    resolvedSessionId = FALLBACK_SESSION_ID;
    const emoji = emojiFor(resolvedSessionId);
    const slot = colorSlotFor(resolvedSessionId, args.boardId);
    const wheel = AWARENESS_WHEEL[slot];
    emojiChar = emoji.char;
    emojiName = emoji.name;
    color = wheel.light;
    colorDark = wheel.dark;
    // Sentinel `mintedAt: 'ws-onConnect'` for the fallback path — the
    // FALLBACK sentinel id was minted right here, never from a cookie.
    // The non-zero `welcomeFramesFallback` counter is the distinguished
    // signal; the wire `mintedAt` value is the closest faithful answer
    // (the client should NOT trust this path's id and should not POST
    // `/api/session` to persist it).
    mintedAt = 'ws-onConnect';
  }

  const payload: WSWelcomeFramePayload = {
    kind: 'welcome',
    session: {
      id: resolvedSessionId,
      emojiChar,
      emojiName,
      color,
      colorDark,
      mintedAt,
    },
    board: {
      id: board.id,
      createdAt: board.createdAt,
      connectionCount: board.connectionCount,
    },
    origin,
    serverTime: Date.now(),
    protocolVersion: 1,
  };
  return payload;
}

/**
 * Send the welcome TEXT frame to a single connection.
 *
 * Validates the payload through `wsWelcomeFrameSchema.parse` at the
 * emit boundary so a regression in the builder surfaces here rather
 * than in the client's parse step. The validation is fast (sub-µs for
 * a payload this size) and adds a load-bearing boundary check the
 * wire-format contract depends on.
 *
 * On success: `wsMetrics.controlFramesOut++`.
 * On failure (serialize throw, socket already closed):
 * `wsMetrics.controlFramesDropped++` and the error is logged.
 */
export function emitWelcomeFrame(
  connection: Connection<MeldConnectionContext>,
  args: EmitWelcomeContext,
): void {
  let payload: WSWelcomeFramePayload;
  try {
    payload = wsWelcomeFrameSchema.parse(buildWelcomePayload(args));
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error('[meld-ws] welcome frame build failed:', err);
    return;
  }

  try {
    // `Connection.webSocket` is the `WebSocketLike` raw socket per
    // Hocuspocus 4.1; `.send(string)` writes a TEXT frame.
    connection.webSocket.send(JSON.stringify(payload));
    wsMetrics.recordControlFrameOut();
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error('[meld-ws] welcome frame send failed:', err);
  }
}
