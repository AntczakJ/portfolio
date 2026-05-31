/**
 * Bridge client — single connection to the Rust worker over UDS / named
 * pipe with length-prefixed framing. Task 1.4a per ADR-002 + ADR-004.
 *
 * Responsibility split:
 *   - This class owns ONE connection at a time, the read accumulator
 *     (`FrameReader`), and the reconnect-with-backoff state machine.
 *   - It hands every decoded payload to `onMessage` as a raw
 *     `Uint8Array`. Consumers run `msgpackr` decode + Zod validation
 *     (where relevant — bridge frames are not Zod-validated per ADR-003)
 *     outside this class; the bridge has no opinion on payload shape.
 *   - It calls `onStateChange` on every transition so `/health.worker`
 *     and any future observability path read a consistent value.
 *
 * State machine:
 *
 *     idle ──connect()──▶ connecting ──ok──▶ connected
 *      ▲                    │                  │
 *      │                    └──fail─┐          │
 *      │                            ▼          ▼
 *      │                       reconnecting ◀──  unexpected close
 *      │                            │
 *      │                            └──connect retry──▶ connecting
 *      │
 *      └─────────── close() ───── disconnecting ◀──── any state
 *
 * `disconnecting` is a transient state covering the close()-in-flight
 * window; the loop quits to `idle` from there and does NOT reconnect.
 * That contract matters: callers use `close('reason')` for deliberate
 * teardown (test cleanup, supervisor shutdown) and the bridge must not
 * fight them by reopening.
 */

import { Backoff } from './backoff';
import { encodeFrame, FrameReader } from './frame';

export type BridgeClientState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting';

export interface BridgeClientOptions {
  /** UDS path (Linux/macOS) or `\\.\pipe\<name>` (Windows). */
  path: string;
  /** Called once per decoded payload. Errors are caught and logged. */
  onMessage: (payload: Uint8Array) => void;
  /** Called on every state transition. Errors are swallowed. */
  onStateChange?: (state: BridgeClientState) => void;
  /**
   * If `false`, an unexpected close does NOT trigger a reconnect — the
   * client transitions to `'idle'` and stays there. Defaults to `true`.
   * Tests use `false` to assert the close path without racing the
   * scheduler.
   */
  autoReconnect?: boolean;
}

/**
 * Minimal subset of the Bun.Socket surface this client uses. Typed
 * locally so we do not depend on `Bun.Socket` directly — that import is
 * resolved at runtime via the ambient `bun-types` declaration.
 */
interface BridgeSocket {
  write(data: Uint8Array): number;
  end(): void;
}

export class BridgeClient {
  readonly #path: string;
  readonly #onMessage: (payload: Uint8Array) => void;
  readonly #onStateChange: ((state: BridgeClientState) => void) | undefined;
  readonly #autoReconnect: boolean;
  readonly #backoff = new Backoff();
  #reader = new FrameReader();
  #socket: BridgeSocket | null = null;
  #state: BridgeClientState = 'idle';
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Promise that resolves on the next `'connected'` transition. Refreshed
   * each time we leave `'connected'`. `connect()` awaits this so the
   * public API matches the supervisor expectation of "connected when
   * resolved".
   */
  #connectedDeferred: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null = null;
  #restartCount = 0;

  constructor(options: BridgeClientOptions) {
    this.#path = options.path;
    this.#onMessage = options.onMessage;
    this.#onStateChange = options.onStateChange;
    this.#autoReconnect = options.autoReconnect ?? true;
  }

  /** Current public state. */
  get state(): BridgeClientState {
    return this.#state;
  }

  /**
   * Number of automatic reconnect attempts since construction. Reflects
   * unexpected disconnects, not deliberate close() calls. Surfaced via
   * `/health.worker.restartCount`.
   */
  get restartCount(): number {
    return this.#restartCount;
  }

  /**
   * Open the connection. Resolves on the next `'connected'` transition;
   * rejects if `close()` is called before that happens or if the first
   * attempt fails with no auto-reconnect.
   *
   * Calling `connect()` while already `'connected'` or `'connecting'` is
   * a no-op that resolves once we are connected.
   */
  async connect(): Promise<void> {
    if (this.#state === 'connected') return;
    if (this.#state === 'disconnecting') {
      throw new Error('BridgeClient.connect called during disconnect');
    }
    if (this.#connectedDeferred === null) {
      this.#connectedDeferred = this.#makeDeferred();
    }
    if (this.#state === 'idle' || this.#state === 'reconnecting') {
      this.#cancelReconnectTimer();
      this.#attemptConnect();
    }
    return this.#connectedDeferred.promise;
  }

  /**
   * Send one frame. The payload is the raw bytes the consumer wants on
   * the wire (typically MessagePack from `./codec.ts`); this method
   * prepends the length prefix.
   *
   * Throws if not connected — callers must await `connect()` first or
   * react to `onStateChange`. We deliberately do not buffer here: the
   * supervisor's outbound queue is the right home for that policy.
   */
  send(payload: Uint8Array): void {
    if (this.#state !== 'connected' || this.#socket === null) {
      throw new Error(
        `BridgeClient.send called in state '${this.#state}' (need 'connected')`,
      );
    }
    this.#socket.write(encodeFrame(payload));
  }

  /**
   * Initiate a graceful shutdown. Disables auto-reconnect for the
   * remainder of this client's life and tears down the current socket.
   * Returns a settled promise once we reach `'idle'`.
   *
   * The method is async by signature to match the public surface a
   * future `await`able teardown would want (the supervisor coordinates
   * close + spawn during restart), but the teardown itself is purely
   * synchronous today — Bun.Socket.end is fire-and-forget and we do
   * not await the underlying flush. Marked `async` for the contract,
   * eslint disable for the literal no-await body.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(reason: string): Promise<void> {
    if (this.#state === 'idle') return;
    this.#transition('disconnecting');
    this.#cancelReconnectTimer();
    const pending = this.#connectedDeferred;
    if (pending !== null) {
      pending.reject(new Error(`BridgeClient closed before connect: ${reason}`));
      this.#connectedDeferred = null;
    }
    const sock = this.#socket;
    this.#socket = null;
    if (sock !== null) {
      sock.end();
    }
    this.#reader = new FrameReader();
    this.#transition('idle');
  }

  #attemptConnect(): void {
    this.#transition('connecting');
    // Resolve Bun at runtime — keeps this module loadable under tools
    // that walk the type graph without spawning Bun (drizzle-kit, tsc).
    const bun = (globalThis as { Bun?: typeof Bun }).Bun;
    if (bun === undefined) {
      this.#handleConnectError(
        new Error('BridgeClient requires the Bun runtime (Bun global is undefined)'),
      );
      return;
    }
    void bun
      .connect({
        unix: this.#path,
        socket: {
          open: (socket) => {
            this.#socket = socket;
            this.#reader = new FrameReader();
            this.#transition('connected');
            this.#backoff.reset();
            const pending = this.#connectedDeferred;
            if (pending !== null) {
              pending.resolve();
              this.#connectedDeferred = null;
            }
          },
          data: (_socket, chunk) => {
            try {
              this.#reader.feed(chunk);
              for (const payload of this.#reader.frames()) {
                try {
                  this.#onMessage(payload);
                } catch (err) {
                  console.error('bridge onMessage handler threw', err);
                }
              }
            } catch (err) {
              console.error('bridge framing error, forcing reconnect', err);
              this.#forceReconnect();
            }
          },
          close: () => {
            this.#handleSocketClose();
          },
          end: () => {
            this.#handleSocketClose();
          },
          error: (_socket, err) => {
            console.error('bridge socket error', err);
            this.#handleSocketClose();
          },
        },
      })
      .catch((err: unknown) => {
        this.#handleConnectError(err);
      });
  }

  #handleConnectError(err: unknown): void {
    if (this.#state === 'disconnecting' || this.#state === 'idle') return;
    console.error('bridge connect failed', err);
    this.#scheduleReconnect();
  }

  #handleSocketClose(): void {
    if (this.#state === 'disconnecting' || this.#state === 'idle') {
      this.#socket = null;
      return;
    }
    this.#socket = null;
    this.#scheduleReconnect();
  }

  #forceReconnect(): void {
    const sock = this.#socket;
    this.#socket = null;
    if (sock !== null) {
      sock.end();
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#autoReconnect) {
      // Surface the failure to any awaiter and park in idle.
      const pending = this.#connectedDeferred;
      if (pending !== null) {
        pending.reject(new Error('BridgeClient disconnected (autoReconnect disabled)'));
        this.#connectedDeferred = null;
      }
      this.#transition('idle');
      return;
    }
    if (this.#connectedDeferred === null) {
      this.#connectedDeferred = this.#makeDeferred();
    }
    this.#transition('reconnecting');
    this.#restartCount += 1;
    const delay = this.#backoff.nextDelayMs();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#state !== 'reconnecting') return;
      this.#attemptConnect();
    }, delay);
  }

  #cancelReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #transition(next: BridgeClientState): void {
    if (this.#state === next) return;
    this.#state = next;
    const cb = this.#onStateChange;
    if (cb !== undefined) {
      try {
        cb(next);
      } catch (err) {
        console.error('bridge onStateChange handler threw', err);
      }
    }
  }

  #makeDeferred(): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
  } {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}
