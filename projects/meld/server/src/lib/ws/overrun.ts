import type { Connection } from '@hocuspocus/server';

import {
  wsOverrunFrameSchema,
  type WSControlOverrunFramePayload,
  type WSOverrunReason,
} from '../schemas/ws/overrun';
import type { MeldConnectionContext } from './server';
import { wsMetrics } from './metrics';
import { WS_CLOSE_BACKPRESSURE } from './server';

/**
 * Overrun-frame emit pipeline (ADR-011 transport · ADR-004 payload).
 *
 * Sends a `control.overrun` stateless message immediately followed by a
 * WS close with code `4290` (ADR-002 backpressure boundary). The frame
 * carries the discriminated `reason` and a `retryAfterMs` hint so the
 * client's `WebsocketProvider` reconnect-backoff respects the server-
 * advised cool-off and avoids a reconnect storm.
 *
 * The overrun frame is shipped on Hocuspocus's Stateless channel via the
 * same path the welcome frame uses — `connection.sendStateless(string)`
 * (`@hocuspocus/server` 4.1 `dist/index.d.ts` line 779; see `welcome.ts`
 * for the full ADR-011 rationale and the verified API).
 *
 * Send-then-close sequencing (ADR-011 — verified equivalent to the prior
 * TEXT-then-close path):
 *
 *   1. `connection.sendStateless(JSON.stringify(payload))` — stateless
 *      frame with the reason + retryAfterMs. `sendStateless` writes a
 *      y-protocol envelope synchronously onto the same `ws` socket send
 *      buffer.
 *   2. `connection.close({ code: 4290, reason })` — Hocuspocus's close
 *      wrapper updates the room registry. It does NOT close the raw
 *      socket; it only writes an in-band `MessageType.CLOSE` byte
 *      (verified against
 *      `node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`
 *      `Connection.close` line ~405).
 *   3. `connection.webSocket.close(4290, reason)` — close the raw
 *      socket with the 4290 close code so the browser
 *      `WebSocket.onclose.event.code` arrives as `4290`.
 *
 *   Because `sendStateless` and both close writes target the SAME `ws`
 *   send buffer in synchronous FIFO order, the stateless frame is
 *   enqueued ahead of the close frame and flushes first — the client
 *   receives `onStateless` with the overrun payload, then `onclose` with
 *   code `4290`. This is the same ordering guarantee the prior
 *   TEXT-then-close path relied on; only the opcode of the first write
 *   changed.
 *
 * Why this is wired as a callable helper instead of via the
 * `beforeHandleMessage` throw-pattern:
 *
 *   Hocuspocus's `beforeHandleMessage` extension hook closes the
 *   connection automatically when it throws (the error's `code` and
 *   `reason` become the close-code per the `Connection.close({code,
 *   reason})` envelope in `processMessages`). HOWEVER, the throw path
 *   does NOT give us a place to send a TEXT frame BEFORE the close
 *   — by the time we'd want to call `connection.webSocket.send(...)`
 *   the throw has already passed control back to the framework, and
 *   the framework closes immediately. So the rate-limit extension
 *   (`rate-limit.ts`) catches the bucket-empty condition and calls
 *   THIS helper (which sends + closes) BEFORE throwing. The throw is
 *   only there as a belt-and-braces — the close has already started.
 */

interface EmitOverrunOptions {
  /** Reason discriminator — names which backpressure boundary fired. */
  reason: WSOverrunReason;
  /**
   * Suggested cool-off (ms) before reconnect. Picked per the boundary:
   *
   *   - `rate.exceeded`     — 1000 ms (one token-bucket refill cycle).
   *   - `queue.overflow`    — 2000 ms (let the queue drain server-side).
   *   - `message.too-large` — 0 ms (the client must shrink its payload,
   *     reconnect is fine immediately).
   *
   * The helper does NOT enforce the per-reason default — callers pass
   * an explicit value. The defaults above are the recommended starting
   * points if a caller has no other source of truth.
   */
  retryAfterMs: number;
}

/**
 * Send the overrun stateless frame and close the WS with code 4290.
 *
 * On serialize / send failure: increment `controlFramesDropped` and
 * still call `connection.close` so the offending peer is gone even if
 * the diagnostic frame couldn't ship. The disconnect counter advances
 * regardless of whether the frame landed.
 */
export function emitOverrunAndClose(
  connection: Connection<MeldConnectionContext>,
  options: EmitOverrunOptions,
): void {
  const { reason, retryAfterMs } = options;

  const candidate: WSControlOverrunFramePayload = {
    kind: 'control.overrun',
    reason,
    closeCode: 4290,
    retryAfterMs,
  };

  let serialized: string | null = null;
  try {
    const payload = wsOverrunFrameSchema.parse(candidate);
    serialized = JSON.stringify(payload);
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error('[meld-ws] overrun frame build failed:', err);
  }

  if (serialized !== null) {
    try {
      // `Connection.sendStateless(payload: string)` — `@hocuspocus/server`
      // 4.1 `dist/index.d.ts` line 779. Enqueued ahead of the close
      // writes below on the same `ws` send buffer (FIFO), so the client
      // sees `onStateless` before `onclose(4290)` (ADR-011).
      connection.sendStateless(serialized);
      wsMetrics.recordControlFrameOut();
    } catch (err) {
      wsMetrics.recordControlFrameDropped();
      console.error('[meld-ws] overrun frame send failed:', err);
    }
  }

  // 1. Tell Hocuspocus to release the connection from its room
  //    registry (in-band CLOSE message + onClose hook fires). This
  //    does NOT close the raw socket — see `Connection.close` in
  //    `hocuspocus-server.esm.js`.
  try {
    connection.close({
      code: WS_CLOSE_BACKPRESSURE,
      reason: `overrun: ${reason}`,
    });
  } catch (err) {
    console.error('[meld-ws] overrun framework-close failed:', err);
  }
  // 2. Close the raw `ws` socket with the 4290 code so the browser
  //    sees `event.code === 4290` on `WebSocket.onclose`. ADR-002
  //    pinned the wire close code; ADR-004 echoes it in the
  //    `control.overrun` payload.
  try {
    connection.webSocket.close(WS_CLOSE_BACKPRESSURE, `overrun: ${reason}`);
  } catch (err) {
    console.error('[meld-ws] overrun socket-close failed:', err);
  }
  wsMetrics.recordOverrunDisconnect();
}
