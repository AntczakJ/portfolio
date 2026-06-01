import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  Hocuspocus,
  type Extension,
  type connectedPayload,
  type onConnectPayload,
} from '@hocuspocus/server';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';

import { sessionContextExtension, type MeldSessionIdentity } from './on-connect';
import { storageExtension } from './storage';
import { wsMetrics } from './metrics';
import { rateLimitExtension } from './rate-limit';
import { emitWelcomeFrame } from './welcome';

/**
 * meld Hocuspocus bootstrap (Task 1.4 — ADR-002).
 *
 * Architecture:
 *
 *   - We use the lower-level `Hocuspocus` class, NOT the higher-level
 *     `Server` class. `Server` owns its own `http.Server` (creates one
 *     in its constructor via `createServer(this.requestHandler)`); for
 *     ADR-002 we mount Hocuspocus onto the SAME `http.Server` as Hono.
 *
 *   - The integration uses `ws.WebSocketServer({ noServer: true })` and
 *     manually routes `upgrade` events from `httpServer` to either the
 *     Hocuspocus WS layer or a 404 close on path miss. Hocuspocus's
 *     `Hocuspocus.handleConnection(ws, request)` returns a
 *     `ClientConnection` whose `handleMessage(data)` and `handleClose(event)`
 *     bridge `ws` events into the framework.
 *
 *   - Hocuspocus 4.1's `Server` class uses `crossws/adapters/node` under
 *     the hood (see `node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`
 *     line ~1428). We use the raw `ws` library directly because (a) we
 *     already need `ws` to control `maxPayload` from outside the
 *     framework and (b) using `ws` gives us a single, debuggable
 *     transport rather than the crossws adapter wrapping it.
 *
 * Backpressure config (ADR-002 verbatim):
 *
 *   - `timeout: 30_000 ms` — set on the `Hocuspocus` config. Hocuspocus
 *     uses this as a "no message received for N ms => close" guard
 *     (per upstream source: `ClientConnection.check`). This is the
 *     close-code-4290 path for slow clients ADR-002 named.
 *   - `maxMessageSize: 1 MB` — set on the `ws.WebSocketServer` via the
 *     `maxPayload: 1024 * 1024` option. `ws` enforces this at the
 *     frame-receive level, closing the socket on overflow.
 *   - `maxRate: 100` — **not natively exposed in Hocuspocus 4.1**. The
 *     framework has no per-client message-rate config. ADR-002 named
 *     this; Task 1.X-control will enforce it via an in-extension
 *     counter wired through `beforeHandleMessage`. Tracked in
 *     AGENT_NOTES.md.
 *   - `debounce: 5_000 ms`, `maxDebounce: 30_000 ms` — set on the
 *     `Hocuspocus` config per ADR-003 snapshot persistence. Even though
 *     Task 1.3 owns the actual Storage adapter, the debounce knobs live
 *     on the Hocuspocus server itself.
 *
 * Origin allowlist (ADR-002):
 *
 *   - `MELD_ALLOWED_ORIGINS` env var, comma-separated.
 *   - In production (`NODE_ENV === 'production'`) an empty allowlist
 *     fails closed — the `onConnect` hook rejects every upgrade.
 *   - In development, an empty allowlist still validates against the
 *     dev default `http://localhost:3000` only — never wildcard.
 *   - Reject close code: 4401 (ADR-002 "origin not allowed").
 *
 * The `onConnect` hook in this file is a STUB. Task 1.7a / 1.7b own
 * the cookie-derived session identity. The stub:
 *
 *   - Reads `Origin` and validates against the allowlist.
 *   - Reads `Cookie` header (presence only — does NOT parse
 *     `meld_session` yet).
 *   - Returns a context object `{ sessionId: 'pending', cookiePresent }`
 *     so the type contract holds across hook chains and Task 1.7b can
 *     drop in the real derivation without changing the call sites.
 */

/**
 * The connection context populated by `onConnect`. Two extensions
 * contribute to this shape:
 *
 *   - `createMeldExtension` (Task 1.4, priority 0): the Origin allowlist
 *     defence-in-depth check + the legacy `{ sessionId: 'pending',
 *     cookiePresent }` payload. The `sessionId: 'pending'` placeholder
 *     was a stub the welcome builder branched on to mint a deterministic
 *     id — Task 1.7b's cookie-read extension supersedes it.
 *
 *   - `createSessionContextExtension` (Task 1.7b, priority 10): the real
 *     cookie-derived session identity. Reads `meld_session` cookie out
 *     of `payload.requestHeaders.get('cookie')`, validates UUID v4,
 *     mints on miss, derives emoji + per-board OKLCH color via the
 *     Task 1.7a helpers, returns `{ sessionId, session }` so the
 *     framework merges `session` into the context. The `sessionId`
 *     field is overridden with the resolved value so any consumer
 *     reading `context.sessionId` directly sees the real id (not the
 *     `'pending'` placeholder).
 *
 * `session` is OPTIONAL because Hocuspocus constructs the initial
 * context from the `defaultContext` argument to `handleConnection`
 * BEFORE any extension's `onConnect` runs. The defaultContext we pass
 * in `bridgeConnection` does not populate `session` — only the
 * cookie-read extension does. Downstream consumers (welcome builder,
 * future hooks) MUST defend against `session === undefined` with a
 * structured warn + a degraded-identity fallback per ADR-005's
 * "welcome frame is the authority" principle inverted: when the
 * authority is missing, log loudly and ship a sentinel rather than
 * silently mint another id (which would diverge from the
 * `connection.context` the rest of the framework sees).
 */
export interface MeldConnectionContext {
  sessionId: string;
  cookiePresent: boolean;
  session?: MeldSessionIdentity;
}

interface CreateOptions {
  /** Read at module load time. Re-read here so tests can inject overrides. */
  allowedOrigins?: readonly string[];
  nodeEnv?: string;
  debounceMs?: number;
  maxDebounceMs?: number;
  timeoutMs?: number;
  maxMessageSizeBytes?: number;
}

const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_MAX_DEBOUNCE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MESSAGE_SIZE_BYTES = 1024 * 1024;

/** ADR-002 origin-allowlist close code. */
export const WS_CLOSE_ORIGIN_NOT_ALLOWED = 4401;

/** ADR-002 backpressure close code (echoed in control.overrun). */
export const WS_CLOSE_BACKPRESSURE = 4290;

/** ADR-003 retention-sweep board-deleted close code (Task 1.X-control). */
export const WS_CLOSE_BOARD_DELETED = 4404;

/** Path pattern for board WS endpoints. */
const WS_BOARD_PATH_RE = /^\/ws\/board\/([A-Za-z0-9_-]+)$/;

/**
 * Lazily-resolved Origin allowlist. Read once at module load and again
 * inside `parseAllowedOrigins` for test injection. Empty in production
 * raises a structured throw at `createMeldWsServer` time, not at hook
 * time, so a misconfigured deploy fails the listen() call rather than
 * the first user connection.
 */
function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface OriginCheckOutcome {
  ok: boolean;
  reason?: 'missing' | 'not-allowed';
}

function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  nodeEnv: string,
): OriginCheckOutcome {
  if (!origin) {
    // No Origin header => browser would not have sent one only for a
    // non-browser client (curl, custom WS lib). In production this is
    // suspicious; in dev allow it to keep `ws-smoke.ts` working.
    if (nodeEnv === 'production') return { ok: false, reason: 'missing' };
    return { ok: true };
  }
  if (allowedOrigins.includes(origin)) return { ok: true };
  // Dev fallback: if the allowlist is empty in dev, allow
  // http://localhost:3000 only per ADR-002.
  if (nodeEnv !== 'production' && allowedOrigins.length === 0) {
    if (origin === 'http://localhost:3000') return { ok: true };
  }
  return { ok: false, reason: 'not-allowed' };
}

/**
 * Construct the meld Hocuspocus extension that owns the Origin
 * allowlist check and the placeholder session context.
 */
function createMeldExtension(
  allowedOrigins: readonly string[],
  nodeEnv: string,
): Extension<MeldConnectionContext> {
  return {
    extensionName: 'meld-onconnect-stub',
    priority: 0,

    // eslint-disable-next-line @typescript-eslint/require-await
    async onConnect(
      payload: onConnectPayload<MeldConnectionContext>,
    ): Promise<MeldConnectionContext> {
      const origin = payload.requestHeaders.get('origin') ?? undefined;
      const outcome = isOriginAllowed(origin, allowedOrigins, nodeEnv);
      if (!outcome.ok) {
        wsMetrics.recordRateLimited();
        // Throwing a structured error causes Hocuspocus to abort the
        // connection setup. The actual close-code emission is wired in
        // the upgrade handler below — see `closeWithOriginRejection`.
        throw new OriginNotAllowedError(outcome.reason ?? 'not-allowed');
      }

      const cookieHeader = payload.requestHeaders.get('cookie') ?? '';
      const cookiePresent = cookieHeader
        .split(';')
        .some((kv) => kv.trim().toLowerCase().startsWith('meld_session='));

      // Task 1.7b will derive the real sessionId from the cookie /
      // mint a UUID. For now we hand back a placeholder so the type
      // contract holds and downstream extensions (Storage stub etc.)
      // see a non-empty string.
      return {
        sessionId: 'pending',
        cookiePresent,
      };
    },
  };
}

class OriginNotAllowedError extends Error {
  constructor(public readonly reason: 'missing' | 'not-allowed') {
    super(`origin ${reason}`);
    this.name = 'OriginNotAllowedError';
  }
}

/**
 * Welcome-frame emit extension (Task 1.X-control — ADR-004).
 *
 * Wires into Hocuspocus's `connected` hook (NOT `onConnect`):
 *
 *   - `onConnect` fires BEFORE the `Connection` object is created and
 *     before the auth handshake completes. The connection's
 *     `webSocket` accessor isn't available there.
 *   - `connected` fires AFTER the framework has built the `Connection`
 *     object, registered it in `documentConnections`, and flushed any
 *     queued incoming messages. The `Connection<Context>` instance is
 *     on `payload.connection` and exposes `connection.webSocket` per
 *     the `WebSocketLike` contract (line 718 of the upstream `.d.ts`).
 *
 * The welcome emit picks `payload.connection`, derives identity from
 * `payload.context.sessionId` (Task 1.7b will populate the real value;
 * until then the welcome.ts builder substitutes a stub UUID — see
 * `welcome.ts` for the explicit fallback semantics), and ships the
 * frame via `connection.webSocket.send(JSON.stringify(payload))`.
 */
function createWelcomeExtension(
  allowedOrigins: readonly string[],
): Extension<MeldConnectionContext> {
  return {
    extensionName: 'meld-welcome-emit',
    priority: 50,

    // eslint-disable-next-line @typescript-eslint/require-await
    async connected(
      payload: connectedPayload<MeldConnectionContext>,
    ): Promise<void> {
      // Echo origin back to the client per ADR-004 cross-check. Use the
      // request's Origin if present (which it always is on a real
      // browser); fall back to the first allowed origin for non-browser
      // clients (curl, the smoke script). The empty-string fallback
      // exists so the Zod parse never rejects on a stray non-string.
      const requestOrigin = payload.requestHeaders.get('origin') ?? undefined;
      const origin =
        requestOrigin ?? allowedOrigins[0] ?? 'http://localhost:3000';

      // `connectionCount` is the post-connect count. Hocuspocus reads
      // the Document via `payload.instance.documents.get(documentName)`.
      const doc = payload.instance.documents.get(payload.documentName);
      const connectionCount = doc?.getConnectionsCount() ?? 1;

      // Board metadata `createdAt` lookup is deferred until Task 1.7b
      // — for v1 we ship the server boot time as a placeholder so the
      // welcome frame parses against the schema. The frontend uses
      // `createdAt` only for the chrome's "this board was created N
      // minutes ago" copy which is also Phase 3.x — non-blocking.
      // The boardId field on the welcome frame REQUIRES a UUID v4 per
      // the schema; the path-filter regex allows non-UUID test ids,
      // so we substitute an all-zero-version-4 UUID for non-UUID
      // document names. Smoke tests against `test-board-001` rely on
      // this substitution.
      const boardId = isUuidV4(payload.documentName)
        ? payload.documentName
        : SMOKE_BOARD_ID_UUID;

      emitWelcomeFrame(payload.connection, {
        context: payload.context,
        boardId,
        board: {
          id: boardId,
          createdAt: Date.now(),
          connectionCount,
        },
        origin,
      });
    },
  };
}

/**
 * Strict UUID v4 regex — mirrors `cookie.ts` `UUID_V4_REGEX`. Used by
 * the welcome extension to distinguish production board ids (real
 * UUIDs from `POST /api/boards`) from smoke-test ids
 * (`test-board-001` etc.) and substitute a parseable id in the latter
 * case.
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

/**
 * Sentinel UUID v4 used as the welcome-frame `board.id` echo when the
 * incoming `documentName` is a smoke / test id (not a real UUID).
 * Production callers ALWAYS see a real UUID per the `POST /api/boards`
 * route; this branch exists only to keep the WS smoke + storage smoke
 * flows working.
 */
const SMOKE_BOARD_ID_UUID = '00000000-0000-4000-8000-000000000001';

/**
 * Shape returned by `createMeldWsServer`. Exposes the underlying
 * Hocuspocus instance for `Server.documents` introspection (used by
 * `/health.ws`), the WebSocketServer used for noServer-mode upgrades,
 * and an `attach(httpServer)` helper that wires the `upgrade` event.
 */
export interface MeldWsServer {
  hocuspocus: Hocuspocus<MeldConnectionContext>;
  wss: WebSocketServer;
  /**
   * Register the `upgrade` event handler on the given `http.Server`.
   * Path-filters non-`/ws/board/:boardId` upgrades to a 404 close.
   */
  attach(httpServer: HttpServer): void;
  /**
   * Observability snapshot for `/health.ws`. Reads from the live
   * Hocuspocus document map + the WS metrics counter.
   */
  snapshot(): {
    connectedClients: number;
    roomCount: number;
    controlFramesOut: number;
    controlFramesDropped: number;
    rateLimitedCount: number;
    overrunDisconnectCount: number;
  };
  /** Graceful shutdown — closes connections and the WSS. */
  close(): Promise<void>;
}

/**
 * Build the meld WS server. Idempotent in the sense that the caller
 * decides when to construct — there is no module-level singleton here;
 * `server.ts` constructs once at boot.
 */
export function createMeldWsServer(options: CreateOptions = {}): MeldWsServer {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const allowedOrigins =
    options.allowedOrigins ?? parseAllowedOrigins(process.env.MELD_ALLOWED_ORIGINS);

  // Fail-fast in production on an empty allowlist per ADR-002. Dev mode
  // is tolerant — `isOriginAllowed` falls back to localhost:3000 only.
  if (nodeEnv === 'production' && allowedOrigins.length === 0) {
    throw new Error(
      '[meld-ws] MELD_ALLOWED_ORIGINS must be set to a non-empty comma-separated list in production',
    );
  }

  // Boot log — the resolved allowlist is part of the operator's
  // diagnostic surface (tape's pattern). Don't log in test to keep
  // unit output tidy.
  if (nodeEnv !== 'test') {
    const effective =
      allowedOrigins.length > 0
        ? allowedOrigins.join(', ')
        : nodeEnv === 'production'
          ? '<empty — would fail closed>'
          : 'http://localhost:3000 (dev fallback)';
    console.log(`[meld-ws] origin allowlist: ${effective}`);
  }

  const hocuspocus = new Hocuspocus<MeldConnectionContext>({
    name: 'meld',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    debounce: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    maxDebounce: options.maxDebounceMs ?? DEFAULT_MAX_DEBOUNCE_MS,
    quiet: true,
    extensions: [
      createMeldExtension(allowedOrigins, nodeEnv),
      // Cookie-read + session-identity extension (Task 1.7b — ADR-005).
      // Runs in `onConnect`, BEFORE the welcome-emit hook fires on
      // `connected`. Reads the `meld_session` cookie from the WS upgrade
      // request, validates as UUID v4, mints on miss, derives emoji +
      // per-board OKLCH color, returns `{ sessionId, session }` so the
      // framework merges into `connection.context`. priority 10 grep-only
      // — Hocuspocus 4.1 awaits the full `onConnect` chain before
      // firing `connected`, so ordering within `onConnect` does not
      // affect when `session` becomes visible to the welcome builder.
      sessionContextExtension,
      // Welcome emit (ADR-004) runs on the `connected` hook AFTER the
      // Connection object exists. priority 50 puts it after the
      // onConnect stub (priority 0) and before the storage extension
      // — order within the same hook does not matter for `connected`
      // because the framework runs every extension's `connected` to
      // completion, but the priority is set for grep-ability.
      createWelcomeExtension(allowedOrigins),
      // Per-client rate limit (ADR-002 `maxRate` gap fill —
      // Hocuspocus 4.1 has no native rate config). Token bucket: 100
      // tokens, refill 100 tokens/sec. Throws to close on bucket
      // empty AFTER emitting the control.overrun frame. priority 100
      // puts it ahead of storage so a rate-limit reject does not
      // double-process the message through `onChange`.
      rateLimitExtension,
      storageExtension,
    ],
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxMessageSizeBytes ?? DEFAULT_MAX_MESSAGE_SIZE_BYTES,
  });

  function bridgeConnection(
    ws: WsWebSocket,
    request: IncomingMessage,
    boardId: string,
  ): void {
    // Translate the Node http IncomingMessage into the Fetch-style
    // Request that Hocuspocus expects on `handleConnection`. The
    // framework reads `request.headers` (Headers instance) and the
    // URL — both must be present.
    const url = new URL(
      request.url ?? `/ws/board/${boardId}`,
      `http://${request.headers.host ?? 'localhost'}`,
    );
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (typeof value === 'string') {
        headers.set(key, value);
      }
    }
    const fetchRequest = new Request(url, {
      method: 'GET',
      headers,
    });

    let clientConnection;
    try {
      clientConnection = hocuspocus.handleConnection(ws, fetchRequest, {
        sessionId: 'pending',
        cookiePresent: false,
      });
    } catch (err) {
      console.error('[meld-ws] handleConnection threw:', err);
      ws.close(WS_CLOSE_ORIGIN_NOT_ALLOWED, 'origin not allowed');
      return;
    }

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      // `ws` delivers binary as Buffer / Buffer[]; coerce to Uint8Array
      // for Hocuspocus's `handleMessage(data: Uint8Array)` contract.
      let bytes: Uint8Array;
      if (Array.isArray(data)) {
        const total = data.reduce((acc, b) => acc + b.byteLength, 0);
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const b of data) {
          bytes.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), offset);
          offset += b.byteLength;
        }
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        // Buffer
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      clientConnection.handleMessage(bytes);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      clientConnection.handleClose({
        code,
        reason: reason.toString('utf8'),
      });
    });

    ws.on('error', (err: Error) => {
      console.error('[meld-ws] socket error:', err);
    });
  }

  function attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const rawUrl = request.url ?? '';
      // Path filter — only `/ws/board/:boardId` is handled. Anything
      // else gets a 404 + socket destroy. Hocuspocus's stock `Server`
      // would accept upgrades on every path; we tighten the surface.
      const path = rawUrl.split('?', 1)[0] ?? '';
      const match = WS_BOARD_PATH_RE.exec(path);
      if (!match) {
        socket.write(
          'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
        socket.destroy();
        return;
      }
      const boardId = match[1] ?? '';

      // Pre-flight Origin check BEFORE we burn the ws handshake. This
      // is the same check `onConnect` runs; running it here lets us
      // refuse the upgrade with a clean HTTP 403 instead of a brief
      // accept-then-close, which is what ADR-002's close-code-4401
      // describes for after-upgrade rejections.
      const origin = request.headers.origin ?? undefined;
      const outcome = isOriginAllowed(origin, allowedOrigins, nodeEnv);
      if (!outcome.ok) {
        wsMetrics.recordRateLimited();
        socket.write(
          'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        bridgeConnection(ws, request, boardId);
      });
    });
  }

  function snapshot(): {
    connectedClients: number;
    roomCount: number;
    controlFramesOut: number;
    controlFramesDropped: number;
    rateLimitedCount: number;
    overrunDisconnectCount: number;
  } {
    const m = wsMetrics.snapshot();
    return {
      connectedClients: hocuspocus.getConnectionsCount(),
      roomCount: hocuspocus.getDocumentsCount(),
      controlFramesOut: m.controlFramesOut,
      controlFramesDropped: m.controlFramesDropped,
      rateLimitedCount: m.rateLimitedCount,
      overrunDisconnectCount: m.overrunDisconnectCount,
    };
  }

  async function close(): Promise<void> {
    // Best-effort: close all client sockets, then the WebSocketServer.
    for (const client of wss.clients) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
    // Hocuspocus has no public `destroy` on the lower-level instance,
    // but unloading any pending stores is the safe shutdown step.
    hocuspocus.flushPendingStores();
  }

  return {
    hocuspocus,
    wss,
    attach,
    snapshot,
    close,
  };
}
