/**
 * The telemetry WebSocket client (Task 4.2) — the single live channel.
 *
 * Exactly ONE WebSocket connection (the DevTools proof, the success criterion):
 * no polling, no second socket. It opens `/ws`, handles the server frames
 * (`snapshot` / `tick` / `event` / `heartbeat`), and reconnects with backoff +
 * a snapshot reconcile on drop. Frame handling is delegated to caller-supplied
 * callbacks (the glue wires them to the InterpStore + the controller + the
 * connection store) so this class stays framework-free and testable against a
 * mock socket.
 *
 * Liveness + correctness rules (ADR-003 / Phase 4.1 close-out):
 *   - `seq` is monotonic per connection; a GAP triggers `{ t:'snapshot.request' }`
 *     and the client reconciles from the fresh snapshot rather than trusting
 *     stale deltas.
 *   - heartbeats arrive every ~20 s; ~2 missed (~45 s of silence with no frame
 *     at all) is treated as dead -> the socket is force-closed and reconnects.
 *   - on a drop the markers FREEZE at their last authoritative position (the
 *     glue stops feeding ticks; the InterpStore holds) — never stale-as-live.
 *   - reconnect uses capped exponential backoff with jitter.
 */

import { HEARTBEAT_INTERVAL_MS } from 'atlas-shared/schemas/ws';

import {
  parseServerFrame,
  serializeClientFrame,
  type ClientFrame,
  type EventFrame,
  type HeartbeatFrame,
  type ServerFrame,
  type SnapshotFrame,
  type TickFrame,
} from '@/lib/ws/frames';

/** A minimal socket interface — the browser `WebSocket`, or a mock in tests. */
export interface SocketLike {
  send: (data: string) => void;
  close: () => void;
  onopen: ((this: unknown, ev: unknown) => unknown) | null;
  onclose: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
  onmessage: ((this: unknown, ev: { data: unknown }) => unknown) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export type WsConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface WsClientCallbacks {
  onSnapshot: (frame: SnapshotFrame) => void;
  onTick: (frame: TickFrame) => void;
  onEvent: (frame: EventFrame) => void;
  onHeartbeat: (frame: HeartbeatFrame) => void;
  onStatus: (status: WsConnectionStatus) => void;
}

export interface WsClientOptions {
  url: string;
  callbacks: WsClientCallbacks;
  /** Inject a socket factory in tests; defaults to the browser `WebSocket`. */
  socketFactory?: SocketFactory;
  /** Override timing in tests (heartbeat liveness window, backoff bounds). */
  livenessTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/** ~2 missed heartbeats — the default liveness window. */
const DEFAULT_LIVENESS_MS = HEARTBEAT_INTERVAL_MS * 2 + 5_000;
const DEFAULT_MIN_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 10_000;

function defaultSocketFactory(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

export class TelemetryWsClient {
  private readonly url: string;
  private readonly cb: WsClientCallbacks;
  private readonly socketFactory: SocketFactory;
  private readonly livenessMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  private socket: SocketLike | null = null;
  private status: WsConnectionStatus = 'connecting';
  private closedByUser = false;

  /** Last `seq` received on THIS connection (resets to -1 on (re)connect). */
  private lastSeq = -1;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce repeated snapshot.requests on a flapping seq stream. */
  private snapshotRequestedAt = 0;

  constructor(opts: WsClientOptions) {
    this.url = opts.url;
    this.cb = opts.callbacks;
    this.socketFactory = opts.socketFactory ?? defaultSocketFactory;
    this.livenessMs = opts.livenessTimeoutMs ?? DEFAULT_LIVENESS_MS;
    this.minBackoffMs = opts.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /** Open the single connection. Idempotent — a second call is a no-op. */
  connect(): void {
    if (this.socket) return;
    this.closedByUser = false;
    this.openSocket();
  }

  /** Send a client control frame (subscribe / snapshot.request / sim.control). */
  send(frame: ClientFrame): void {
    if (!this.socket || this.status !== 'live') return;
    try {
      this.socket.send(serializeClientFrame(frame));
    } catch {
      // A send on a socket that just dropped — the close handler reconnects.
    }
  }

  /** Tear down: close the socket, cancel all timers, do not reconnect. */
  close(): void {
    this.closedByUser = true;
    this.clearReconnect();
    this.clearLiveness();
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      try {
        this.socket.close();
      } catch {
        // ignore — already closing
      }
      this.socket = null;
    }
    this.setStatus('offline');
  }

  getStatus(): WsConnectionStatus {
    return this.status;
  }

  /* --------------------------------------------------------------------- */

  private openSocket(): void {
    this.lastSeq = -1;
    const socket = this.socketFactory(this.url);
    this.socket = socket;

    socket.onopen = (): void => {
      this.reconnectAttempts = 0;
      this.setStatus('live');
      this.armLiveness();
    };

    socket.onmessage = (ev: { data: unknown }): void => {
      if (typeof ev.data !== 'string') return;
      this.handleFrame(ev.data);
    };

    socket.onerror = (): void => {
      // Errors precede a close; the close handler drives reconnect.
    };

    socket.onclose = (): void => {
      this.socket = null;
      this.clearLiveness();
      if (this.closedByUser) return;
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
  }

  private handleFrame(raw: string): void {
    const frame = parseServerFrame(raw);
    if (!frame) return;

    // Any frame is liveness — re-arm the dead-connection timer.
    this.armLiveness();

    // Seq-gap detection. A snapshot resets the sequence baseline (seq 0 on
    // connect / after a snapshot.request); a delta with a gap triggers a resync.
    if (frame.t === 'snapshot') {
      this.lastSeq = frame.seq;
      this.dispatch(frame);
      return;
    }

    if (this.lastSeq >= 0 && frame.seq > this.lastSeq + 1) {
      // A gap — we missed at least one frame. Request a fresh snapshot and
      // reconcile from it rather than applying a stale delta on a hole.
      this.requestSnapshot();
    }
    this.lastSeq = Math.max(this.lastSeq, frame.seq);
    this.dispatch(frame);
  }

  private dispatch(frame: ServerFrame): void {
    switch (frame.t) {
      case 'snapshot':
        this.cb.onSnapshot(frame);
        break;
      case 'tick':
        this.cb.onTick(frame);
        break;
      case 'event':
        this.cb.onEvent(frame);
        break;
      case 'heartbeat':
        this.cb.onHeartbeat(frame);
        break;
    }
  }

  private requestSnapshot(): void {
    const now = Date.now();
    // Debounce so a flapping seq stream cannot snapshot-storm the gateway (the
    // gateway also debounces server-side, this is belt-and-braces).
    if (now - this.snapshotRequestedAt < 1_000) return;
    this.snapshotRequestedAt = now;
    this.send({ t: 'snapshot.request' });
  }

  /* --- reconnect ------------------------------------------------------- */

  private scheduleReconnect(): void {
    this.clearReconnect();
    const base = Math.min(
      this.maxBackoffMs,
      this.minBackoffMs * 2 ** this.reconnectAttempts,
    );
    const jitter = base * 0.3 * Math.random();
    const delay = base + jitter;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      this.openSocket();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /* --- liveness (missed-heartbeat) ------------------------------------- */

  private armLiveness(): void {
    this.clearLiveness();
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null;
      // Silence past the window — treat the connection as dead. Force a close;
      // the close handler reconnects (which sends a fresh snapshot).
      if (this.socket && !this.closedByUser) {
        this.setStatus('reconnecting');
        try {
          this.socket.close();
        } catch {
          // ignore
        }
      }
    }, this.livenessMs);
  }

  private clearLiveness(): void {
    if (this.livenessTimer !== null) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private setStatus(status: WsConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.cb.onStatus(status);
  }
}
