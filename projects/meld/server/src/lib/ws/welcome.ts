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
 * Welcome-frame emit pipeline (ADR-011 transport · ADR-004 payload ·
 * Task 1.7b — ADR-005).
 *
 * Sends exactly one `welcome` control message per connection after the
 * Hocuspocus `connected` hook fires (which itself fires after
 * `onConnect` + `onAuthenticate` succeed and the `Connection` object
 * has been registered in `documentConnections`). The transport is
 * Hocuspocus's **Stateless** message channel — `Connection.sendStateless
 * (payload: string)` — NOT a raw `ws` TEXT frame.
 *
 * Why Stateless and not a raw TEXT frame (ADR-011, supersedes ADR-004's
 * transport): `HocuspocusProvider` binary-decodes every raw `'message'`
 * event as a y-protocol envelope. A bare TEXT frame is not a valid
 * envelope, so the provider's internal decoder threw `Unexpected end of
 * array` once per board load — an uncaught red console error on the live
 * demo. A stateless message IS a valid y-protocol envelope (opcode
 * `MessageType.Stateless = 5`), so the provider decodes it and routes the
 * inner string to its `onStateless` callback instead of choking. The
 * payload byte-shape on the wire is unchanged — it is the SAME JSON
 * string, now nested inside the stateless envelope.
 *
 * Hocuspocus Stateless API — verified against the installed
 * `@hocuspocus/server@4.1.0` `dist/index.d.ts`:
 *
 *   - `Connection.sendStateless(payload: string): void` — line 779.
 *     Wraps the string in a y-protocol envelope with opcode
 *     `MessageType.Stateless = 5` (line 336).
 *   - The connecting `Connection` handle is available on the `connected`
 *     hook payload: `connectedPayload.connection: Connection<Context>`
 *     — line 519. This is the SAME hook + handle the previous TEXT emit
 *     used; only the send call changes (`connection.webSocket.send(...)`
 *     → `connection.sendStateless(...)`).
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
 * Send the welcome control message to a single connection via the
 * Hocuspocus Stateless channel.
 *
 * Validates the payload through `wsWelcomeFrameSchema.parse` at the
 * emit boundary so a regression in the builder surfaces here rather
 * than in the client's parse step. The validation is fast (sub-µs for
 * a payload this size) and adds a load-bearing boundary check the
 * wire-format contract depends on.
 *
 * On success: `wsMetrics.controlFramesOut++` (now counts stateless
 * sends — the counter is transport-agnostic per ADR-011).
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
    // `Connection.sendStateless(payload: string)` — `@hocuspocus/server`
    // 4.1 `dist/index.d.ts` line 779. Wraps the JSON string in a
    // y-protocol stateless envelope (opcode 5) the provider decodes and
    // routes to its `onStateless` callback (ADR-011).
    connection.sendStateless(JSON.stringify(payload));
    wsMetrics.recordControlFrameOut();
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error('[meld-ws] welcome frame send failed:', err);
  }
}
