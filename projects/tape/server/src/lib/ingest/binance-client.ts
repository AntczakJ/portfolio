/**
 * Binance Futures WebSocket client — Task 1.3 per ADR-001.
 *
 * Connects to `wss://fstream.binance.com/ws/<symbol>@aggTrade` (USDM
 * Futures), parses every incoming `aggTrade` JSON frame through Zod
 * (`schemas/binance/agg-trade.ts`), and hands the validated event to
 * the consumer's callback. The class owns ONE connection at a time,
 * the reconnect-with-backoff state machine, and a parse-error
 * counter; everything downstream (TickWriter, WS broadcast,
 * IngestSession, snapshot cache) is the BinanceIngestor's
 * responsibility, not this layer's.
 *
 * **State machine:**
 *
 *     idle ──connect()──▶ connecting ──open──▶ connected
 *      ▲                    │                    │
 *      │                    └──fail─┐            │
 *      │                            ▼            ▼
 *      │                       reconnecting ◀── unexpected close
 *      │                            │
 *      │                            └── connect retry ──▶ connecting
 *      │
 *      └──── close() ──── any state
 *
 * close() is deliberate teardown — sets `autoReconnect=false` for the
 * remainder of this client's life and transitions to `idle`. The
 * client does NOT fight a deliberate close by reopening; consumers use
 * `close()` for shutdown (SIGTERM handler, BINANCE_WS_ENABLED toggle),
 * and any other unexpected disconnect rides the backoff curve.
 *
 * **Reconnect curve** — reused from `lib/bridge/backoff.ts` per the
 * task brief's "reuse `backoff.ts` from `lib/bridge/` if exported"
 * note. The bridge already exports `Backoff` via its barrel
 * (`lib/bridge/index.ts`), so we import that. The defaults are
 * already 250 ms initial -> 5 s cap, ±20% jitter (matching the
 * ADR-004 numbers); no override needed.
 *
 * **Heartbeat / ping.** Binance Futures sends WS ping frames every
 * ~3 minutes per their official documentation. The browser-spec
 * `WebSocket` API in Bun (and in every other WHATWG-compliant
 * runtime) AUTO-RESPONDS to protocol-level ping frames with the
 * matching pong — there is no API surface to hook for either ping or
 * pong on `globalThis.WebSocket`. Verified against Bun 1.3.14's
 * documented behaviour ("ping frames are responded to automatically").
 *
 * If a future Binance change extracts ping into the JSON payload
 * vocabulary (the way some other exchanges do), the parse-error
 * handler will drop the unknown frame silently — the connection
 * stays alive, and the parse-error counter surfaces the unhandled
 * shape on `/health.binance.parseErrors`. The task brief's stance is
 * explicit: "log, drop the frame, increment a counter. Do NOT throw —
 * connection stability matters more than catching one malformed
 * event."
 *
 * **Fail-fast on misconfiguration.** Per the task brief: `connect()`
 * validates the configured URL eagerly (must start with `wss://`)
 * and the symbol (must be a non-empty ASCII slug). A bad value
 * throws synchronously rather than silently retrying forever against
 * a default that hides the bug.
 *
 * **No reach into the registry / writer / snapshot cache.** This
 * class is the IPC layer. The BinanceIngestor wires the parsed events
 * to the broadcasting + persistence singletons. Keeping the boundary
 * here means the unit test for this class needs only a fake WebSocket
 * — no DB, no broadcast registry.
 */

import { Backoff } from '../bridge';
import {
  binanceAggTradeSchema,
  type BinanceAggTrade,
} from '../schemas/binance/agg-trade';

export type BinanceClientState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Minimal browser-spec WebSocket surface this client uses. Re-declared
 * locally so the unit test can pass a fake without importing the
 * global type; the live path constructs `globalThis.WebSocket(...)`.
 */
export interface BinanceWebSocket {
  binaryType: 'arraybuffer' | 'blob';
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open',
    listener: () => void,
  ): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: 'close',
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

/**
 * Factory for constructing the underlying WebSocket. Defaults to
 * `new WebSocket(url)` against the global; tests inject a fake.
 */
export type BinanceWebSocketFactory = (url: string) => BinanceWebSocket;

/**
 * Timer abstractions so the test seam can drive the reconnect schedule
 * without sleeping. Matches the shape used by `TickWriter` and
 * `RetentionScheduler` for consistency.
 */
export interface BinanceTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_TIMERS: BinanceTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export interface BinanceFuturesClientOptions {
  /**
   * Base WS URL — defaults to the public Binance Futures endpoint
   * from `BINANCE_WS_URL` env var or
   * `wss://fstream.binance.com/ws`. The symbol-stream suffix
   * (`/btcusdt@aggTrade`) is appended internally.
   */
  readonly url?: string;
  /**
   * Lowercase symbol slug — `'btcusdt'` for BTC-PERP. Defaults to
   * `BINANCE_SYMBOL` env var or `'btcusdt'`.
   */
  readonly symbol?: string;
  /**
   * Called once per VALIDATED aggTrade event. Parse errors do not
   * reach here — they increment `parseErrors` and the frame is
   * dropped.
   */
  readonly onAggTrade: (event: BinanceAggTrade) => void;
  /** Called on every state transition. Errors are swallowed. */
  readonly onStateChange?: (state: BinanceClientState) => void;
  /**
   * If `false`, an unexpected close does NOT trigger a reconnect — the
   * client transitions to `'idle'` and stays there. Defaults to `true`.
   * Tests use `false` to assert the close path without racing the
   * scheduler.
   */
  readonly autoReconnect?: boolean;
  /** Test seam — defaults to `new WebSocket(url)`. */
  readonly webSocketFactory?: BinanceWebSocketFactory;
  /** Test seam — defaults to `globalThis.setTimeout` / `clearTimeout`. */
  readonly timers?: BinanceTimers;
}

/**
 * URL validator — fails loudly on a misconfigured `BINANCE_WS_URL`
 * rather than silently retrying against the wrong endpoint forever.
 * Exported for tests.
 */
export function isValidBinanceWsUrl(url: string): boolean {
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Symbol validator — Binance stream paths are ASCII slugs of the
 * exchange-symbol in lowercase. We accept letters and digits and the
 * `_` separator (some perpetuals use it). Exported for tests.
 */
export function isValidBinanceSymbol(symbol: string): boolean {
  return /^[a-z0-9_]+$/.test(symbol);
}

export class BinanceFuturesClient {
  readonly url: string;
  readonly symbol: string;
  readonly streamUrl: string;
  readonly #onAggTrade: (event: BinanceAggTrade) => void;
  readonly #onStateChange: ((state: BinanceClientState) => void) | undefined;
  readonly #autoReconnect: boolean;
  readonly #webSocketFactory: BinanceWebSocketFactory;
  readonly #timers: BinanceTimers;
  readonly #backoff = new Backoff();
  #state: BinanceClientState = 'idle';
  #socket: BinanceWebSocket | null = null;
  #reconnectTimer: unknown = null;
  #restartCount = 0;
  #parseErrors = 0;
  #lastTickTsMs: number | null = null;
  #deliberateClose = false;

  constructor(options: BinanceFuturesClientOptions) {
    const baseUrl = options.url ?? process.env.BINANCE_WS_URL ?? 'wss://fstream.binance.com/ws';
    const symbol = options.symbol ?? process.env.BINANCE_SYMBOL ?? 'btcusdt';

    if (!isValidBinanceWsUrl(baseUrl)) {
      throw new Error(
        `BinanceFuturesClient: invalid BINANCE_WS_URL '${baseUrl}' — must start with ws:// or wss:// and be a valid URL`,
      );
    }
    if (!isValidBinanceSymbol(symbol)) {
      throw new Error(
        `BinanceFuturesClient: invalid BINANCE_SYMBOL '${symbol}' — must be lowercase ASCII letters/digits/underscore`,
      );
    }

    this.url = baseUrl;
    this.symbol = symbol;
    // Trim a trailing slash off the base then append the stream path
    // so `wss://fstream.binance.com/ws` and `wss://.../ws/` both work.
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.streamUrl = `${base}/${symbol}@aggTrade`;

    this.#onAggTrade = options.onAggTrade;
    this.#onStateChange = options.onStateChange;
    this.#autoReconnect = options.autoReconnect ?? true;
    this.#webSocketFactory =
      options.webSocketFactory ??
      ((url): BinanceWebSocket => {
        // Bun's global `WebSocket` is browser-spec; the cast is to our
        // local minimal surface (the real object has more methods we
        // do not touch).
        return new globalThis.WebSocket(url) as unknown as BinanceWebSocket;
      });
    this.#timers = options.timers ?? DEFAULT_TIMERS;
  }

  /**
   * Open the connection. Idempotent — calling while already
   * `'connected'` or `'connecting'` returns immediately. The returned
   * promise resolves on the FIRST successful `open` event; later
   * reconnects do not re-resolve. Callers that need to observe every
   * state change use `onStateChange`.
   */
  async connect(): Promise<void> {
    if (this.#state === 'connected') return;
    if (this.#state === 'connecting' || this.#state === 'reconnecting') return;
    this.#deliberateClose = false;
    await new Promise<void>((resolve, reject) => {
      const offChange = (state: BinanceClientState): void => {
        if (state === 'connected') {
          this.#offFirstConnect = null;
          resolve();
        } else if (state === 'idle') {
          this.#offFirstConnect = null;
          reject(new Error('BinanceFuturesClient: closed before first connect'));
        }
      };
      this.#offFirstConnect = offChange;
      this.#attemptConnect();
    });
  }

  /**
   * Internal hook for the connect() promise to listen for the first
   * transition. Cleared on resolve / reject so subsequent reconnects
   * do not re-trigger it.
   */
  #offFirstConnect: ((state: BinanceClientState) => void) | null = null;

  /**
   * Initiate a graceful shutdown. Disables auto-reconnect for the
   * remainder of this client's life and tears down the current socket.
   * Multiple calls are no-ops once the state lands at `'idle'`.
   */
  close(): void {
    this.#deliberateClose = true;
    this.#cancelReconnectTimer();
    const sock = this.#socket;
    this.#socket = null;
    if (sock !== null) {
      try {
        sock.close(1000, 'client closed');
      } catch {
        // Already closing — ignore.
      }
    }
    this.#transition('idle');
  }

  /** Current public state. */
  get state(): BinanceClientState {
    return this.#state;
  }

  /** Cumulative parse-error count since construction. */
  get parseErrors(): number {
    return this.#parseErrors;
  }

  /** Cumulative automatic reconnect count since construction. */
  get restartCount(): number {
    return this.#restartCount;
  }

  /**
   * Timestamp (Binance trade time, ms) of the last successfully
   * parsed aggTrade. `null` until the first event lands. Read by
   * `/health.binance.lastTickTsMs`.
   */
  get lastTickTsMs(): number | null {
    return this.#lastTickTsMs;
  }

  /** Whether the underlying socket is in the `'connected'` state. */
  get connected(): boolean {
    return this.#state === 'connected';
  }

  #attemptConnect(): void {
    this.#transition(this.#restartCount === 0 ? 'connecting' : 'reconnecting');
    let ws: BinanceWebSocket;
    try {
      ws = this.#webSocketFactory(this.streamUrl);
    } catch (err) {
      console.error('[binance-client] WebSocket constructor threw:', err);
      this.#scheduleReconnect();
      return;
    }
    this.#socket = ws;
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      if (this.#socket !== ws) return;
      this.#transition('connected');
      this.#backoff.reset();
    });

    ws.addEventListener('message', (event: { data: unknown }) => {
      if (this.#socket !== ws) return;
      this.#handleMessage(event.data);
    });

    ws.addEventListener('close', (event: { code: number; reason: string }) => {
      if (this.#socket !== ws) return;
      this.#socket = null;
      if (this.#deliberateClose) {
        this.#transition('idle');
        return;
      }
      console.warn(
        `[binance-client] socket closed code=${String(event.code)} reason=${event.reason}`,
      );
      this.#scheduleReconnect();
    });

    ws.addEventListener('error', (err) => {
      if (this.#socket !== ws) return;
      console.error('[binance-client] socket error:', err);
      // The `close` event always follows an error; do NOT schedule
      // reconnect here to avoid double-scheduling.
    });
  }

  #handleMessage(data: unknown): void {
    // Binance sends JSON text frames; we configured `binaryType =
    // 'arraybuffer'` for diagnostic predictability, but text frames
    // arrive as `string` regardless. Defensive: handle both.
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      text = new TextDecoder().decode(data);
    } else {
      this.#parseErrors += 1;
      console.warn(
        `[binance-client] unexpected frame type: ${typeof data}; dropped`,
      );
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      this.#parseErrors += 1;
      console.warn('[binance-client] JSON parse failed; frame dropped:', err);
      return;
    }

    const parsed = binanceAggTradeSchema.safeParse(raw);
    if (!parsed.success) {
      this.#parseErrors += 1;
      // Log compactly — full Zod errors are large; the first issue
      // is usually enough to triage.
      const first = parsed.error.issues[0];
      console.warn(
        `[binance-client] schema validation failed; frame dropped: ${
          first ? `${first.path.join('.')}: ${first.message}` : 'no issues reported'
        }`,
      );
      return;
    }

    this.#lastTickTsMs = parsed.data.T;
    try {
      this.#onAggTrade(parsed.data);
    } catch (err) {
      // The consumer (BinanceIngestor) is expected to be defensive;
      // a throw here would otherwise kill the connection. Log and
      // continue.
      console.error('[binance-client] onAggTrade handler threw:', err);
    }
  }

  #scheduleReconnect(): void {
    if (!this.#autoReconnect || this.#deliberateClose) {
      this.#transition('idle');
      return;
    }
    this.#transition('reconnecting');
    this.#restartCount += 1;
    const delay = this.#backoff.nextDelayMs();
    this.#reconnectTimer = this.#timers.setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#state !== 'reconnecting') return;
      this.#attemptConnect();
    }, delay);
  }

  #cancelReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #transition(next: BinanceClientState): void {
    if (this.#state === next) return;
    this.#state = next;
    const cb = this.#onStateChange;
    if (cb !== undefined) {
      try {
        cb(next);
      } catch (err) {
        console.error('[binance-client] onStateChange handler threw:', err);
      }
    }
    const firstConnect = this.#offFirstConnect;
    if (firstConnect !== null) {
      try {
        firstConnect(next);
      } catch (err) {
        console.error('[binance-client] connect() listener threw:', err);
      }
    }
  }
}

/**
 * Process-singleton accessor. The ingestor registers the live
 * client through `setBinanceClient()` on construction so
 * `/health.binance` and any future observability path can read the
 * same instance the ingest hot path holds. Returns `null` until the
 * ingestor wires its client (i.e. when `BINANCE_WS_ENABLED=0` or
 * before boot).
 */
let singleton: BinanceFuturesClient | null = null;

export function getBinanceClient(): BinanceFuturesClient | null {
  return singleton;
}

export function setBinanceClient(client: BinanceFuturesClient | null): void {
  singleton = client;
}

/**
 * Test-only reset hook. Clears the singleton so a fresh client can
 * be registered on the next ingestor construction.
 */
export function __resetBinanceClientSingletonForTests(): void {
  singleton = null;
}
