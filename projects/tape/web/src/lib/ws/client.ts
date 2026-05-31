/**
 * WSStreamClient — browser WS client for `/ws/stream`.
 *
 * Frame format per ADR-006: msgpackr binary frames, `useRecords: false`
 * to stay spec-compatible with the server `tape-server/src/lib/bridge/codec.ts`
 * vocabulary. Every received frame is validated via `wsFrameSchema` at the
 * receive boundary (the Zod parse is the cheap, load-bearing pass that
 * turns "bytes off the wire" into typed domain state — per AGENT_NOTES
 * "WebSocket frame contract notes").
 *
 * Reconnect semantics, two distinct backoff curves per ADR-006:
 *
 *   - `CloseEvent.code === 4290` (server overrun circuit breaker, signed
 *     `WS_CLOSE_CODE_OVERRUN`): the server told us our queue overran. The
 *     scenario is transient — the next snapshot rebuilds local state. We
 *     reconnect FAST, starting at 100 ms.
 *
 *   - Any other unexpected close (1006 TCP abnormal, server crash,
 *     network blip): start at 1 s. These tend to indicate a real outage
 *     and re-trying every 100 ms would just dogpile.
 *
 *   Both curves double per attempt, cap at 30 s, and apply ±20 %
 *   symmetric jitter on the wait. We track `restartCount` for the
 *   status surface and reset it after `BACKOFF_RESET_HEALTHY_MS` ms of
 *   continuous healthy connection — matches the ADR-004 supervisor
 *   shape one mental model across the project per AGENT_NOTES.
 *
 * Explicit `close(reason)` parks in `idle` and disables auto-reconnect.
 * Re-arm with another `connect()` call.
 *
 * `send(...)` is a no-op in v1 — the v1 client vocabulary is empty,
 * subscribe is implicit on connect per ADR-006. v2 reserves the
 * `clientFrameSchema` shape for explicit subscribe / unsubscribe; the
 * stub here keeps the API stable.
 *
 * SSR safety: the class can be constructed on the server (no `window`
 * touched in the constructor) but `connect()` requires a browser
 * `WebSocket` global. The provider guards against SSR construction by
 * deferring the `connect()` call to a `useEffect`.
 */
import { Unpackr } from 'msgpackr';
import {
  wsFrameSchema,
  type WSFrame,
  type WSSnapshotPayload,
} from 'tape-server/ws-schemas';

/** Server-emitted close code on backpressure overrun (ADR-006). */
export const WS_CLOSE_CODE_OVERRUN = 4290;

/** Reconnect base delay after an overrun close — transient by definition. */
export const BACKOFF_OVERRUN_INITIAL_MS = 100;

/** Reconnect base delay on any other unexpected close. */
export const BACKOFF_DEFAULT_INITIAL_MS = 1_000;

/** Cap on the reconnect wait. */
export const BACKOFF_CAP_MS = 30_000;

/** Symmetric jitter applied to every wait (±20 %). */
export const BACKOFF_JITTER = 0.2;

/** Reset `restartCount` after this much continuous healthy uptime. */
export const BACKOFF_RESET_HEALTHY_MS = 60_000;

/** Normal close code we initiate from `close(reason)`. */
const CLOSE_CODE_CLIENT_REQUESTED = 1000;

export type WSConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface WSStreamClientOptions {
  url: string;
  onFrame: (frame: WSFrame) => void;
  onSnapshot: (snapshot: WSSnapshotPayload) => void;
  onStateChange: (state: WSConnectionState) => void;
  /** Optional override for the global `WebSocket` constructor (tests). */
  WebSocketCtor?: typeof WebSocket;
  /** Optional setTimeout override (tests). */
  scheduler?: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  /** Optional `Math.random` override (tests) for deterministic jitter. */
  random?: () => number;
}

export class WSStreamClient {
  readonly #url: string;
  readonly #onFrame: (frame: WSFrame) => void;
  readonly #onSnapshot: (snapshot: WSSnapshotPayload) => void;
  readonly #onStateChange: (state: WSConnectionState) => void;
  readonly #WebSocketCtor: typeof WebSocket;
  readonly #scheduler: NonNullable<WSStreamClientOptions['scheduler']>;
  readonly #random: () => number;
  readonly #unpackr: Unpackr;

  #state: WSConnectionState = 'idle';
  #socket: WebSocket | null = null;
  #attempt = 0;
  #autoReconnect = true;
  #reconnectHandle: unknown = null;
  #healthyTimerHandle: unknown = null;
  #restartCount = 0;
  /** Initial delay to use on the next reconnect — set by the close handler. */
  #nextInitialMs: number = BACKOFF_DEFAULT_INITIAL_MS;

  constructor(options: WSStreamClientOptions) {
    this.#url = options.url;
    this.#onFrame = options.onFrame;
    this.#onSnapshot = options.onSnapshot;
    this.#onStateChange = options.onStateChange;
    this.#WebSocketCtor =
      options.WebSocketCtor ??
      (typeof WebSocket === 'undefined' ? (null as never) : WebSocket);
    this.#scheduler = options.scheduler ?? {
      setTimeout: (cb, ms) =>
        globalThis.setTimeout(cb, ms) as unknown,
      clearTimeout: (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.#random = options.random ?? Math.random;
    // useRecords: false matches ADR-003 + ADR-006 codec config across server,
    // browser, and the internal bridge. Flipping this would silently break
    // round-trip compat with the server encoder.
    this.#unpackr = new Unpackr({ useRecords: false });
  }

  get state(): WSConnectionState {
    return this.#state;
  }

  get restartCount(): number {
    return this.#restartCount;
  }

  /**
   * Open the WS. Throws synchronously if the browser `WebSocket` global
   * is missing (i.e., called during SSR). Idempotent: a second call
   * while connecting / connected is a no-op.
   */
  connect(): void {
    if (this.#WebSocketCtor === null) {
      throw new Error(
        'WSStreamClient.connect called without a WebSocket global (SSR?).',
      );
    }
    if (this.#state === 'connecting' || this.#state === 'connected') {
      return;
    }
    this.#autoReconnect = true;
    this.#openSocket();
  }

  /**
   * Close the connection explicitly. Disables auto-reconnect. Calling
   * `connect()` again re-arms.
   */
  close(_reason?: string): void {
    void _reason;
    this.#autoReconnect = false;
    this.#cancelReconnect();
    this.#cancelHealthyTimer();
    if (this.#socket !== null) {
      const socket = this.#socket;
      this.#socket = null;
      try {
        socket.close(CLOSE_CODE_CLIENT_REQUESTED, 'client-close');
      } catch {
        // Browsers throw if the socket is already closing. Safe to drop.
      }
    }
    this.#transition('idle');
  }

  /**
   * v1 no-op. Clients don't speak the protocol — subscribe is implicit
   * on connect per ADR-006. v2 will populate `clientFrameSchema`.
   */
  send(_message: unknown): void {
    void _message;
  }

  #openSocket(): void {
    this.#transition('connecting');
    const socket = new this.#WebSocketCtor(this.#url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      // The connection is healthy. Schedule the restart-count reset
      // after `BACKOFF_RESET_HEALTHY_MS` of uptime so we don't drag a
      // historical restart count through a long healthy session.
      this.#cancelHealthyTimer();
      this.#healthyTimerHandle = this.#scheduler.setTimeout(() => {
        this.#restartCount = 0;
        this.#attempt = 0;
      }, BACKOFF_RESET_HEALTHY_MS);
      this.#transition('connected');
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      this.#handleMessage(event.data as ArrayBuffer | Blob | string);
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      this.#handleClose(event.code);
    });

    socket.addEventListener('error', () => {
      // The browser fires 'error' before 'close' on most failures.
      // We rely on the close handler to drive reconnect, so this is
      // observational only — surface to dev console.
      console.error('[ws] socket error (see close event for code)');
    });
  }

  #handleMessage(data: ArrayBuffer | Blob | string): void {
    if (typeof data === 'string' || data instanceof Blob) {
      console.error('[ws] non-binary frame received — dropping');
      return;
    }
    const bytes = new Uint8Array(data);
    let decoded: unknown;
    try {
      decoded = this.#unpackr.unpack(bytes);
    } catch (err) {
      console.error('[ws] msgpackr decode failed', err);
      return;
    }
    const result = wsFrameSchema.safeParse(decoded);
    if (!result.success) {
      console.error('[ws] frame schema validation failed', {
        issues: result.error.issues.slice(0, 5),
        sample: decoded,
      });
      return;
    }
    const frame = result.data;
    if (frame.kind === 'snapshot') {
      this.#onSnapshot(frame.payload);
    } else {
      this.#onFrame(frame);
    }
  }

  #handleClose(code: number): void {
    this.#socket = null;
    this.#cancelHealthyTimer();

    if (!this.#autoReconnect) {
      // Explicit close already moved us to idle; nothing to do.
      return;
    }

    this.#restartCount += 1;
    this.#nextInitialMs =
      code === WS_CLOSE_CODE_OVERRUN
        ? BACKOFF_OVERRUN_INITIAL_MS
        : BACKOFF_DEFAULT_INITIAL_MS;
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    this.#transition('reconnecting');
    const base = Math.min(
      BACKOFF_CAP_MS,
      this.#nextInitialMs * 2 ** this.#attempt,
    );
    // Symmetric jitter ±BACKOFF_JITTER.
    const jitter = (this.#random() * 2 - 1) * BACKOFF_JITTER;
    const wait = Math.max(0, Math.round(base * (1 + jitter)));
    this.#attempt += 1;
    this.#reconnectHandle = this.#scheduler.setTimeout(() => {
      this.#reconnectHandle = null;
      if (!this.#autoReconnect) return;
      this.#openSocket();
    }, wait);
  }

  #cancelReconnect(): void {
    if (this.#reconnectHandle !== null) {
      this.#scheduler.clearTimeout(this.#reconnectHandle);
      this.#reconnectHandle = null;
    }
  }

  #cancelHealthyTimer(): void {
    if (this.#healthyTimerHandle !== null) {
      this.#scheduler.clearTimeout(this.#healthyTimerHandle);
      this.#healthyTimerHandle = null;
    }
  }

  #transition(next: WSConnectionState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#onStateChange(next);
  }
}
