/**
 * WS connection registry — Task 1.6b per ADR-006.
 *
 * Owns the live set of per-client send queues and broadcasts encoded
 * frames to subscribers. The Elysia handler at `/ws/stream` registers
 * a fresh client on `open`, calls `unregister` on `close`, and the
 * publish-side producers (synthesizer in v1, Binance ingest in Task
 * 1.3, replay engine in Task 1.7) feed `broadcast()`.
 *
 * Backpressure policy is canonical to ADR-006 §"Decision":
 *
 *   - **256 KB total queued bytes** OR **2 s of head-of-line wall
 *     time**, whichever trips first, is the circuit-breaker
 *     threshold. The first breach emits `control.overrun` to the
 *     offending client and closes the socket with
 *     `CloseEvent.code = 4290` and a reason picked from
 *     `{ 'queue.overflow' (bytes), 'memory.budget' (wall) }`.
 *
 *   - Inside the budget, drop policy is per-kind. `tick` frames drop
 *     OLDEST FIRST when the queue is pressured (the tape strip on
 *     the browser is a sliding window — stale ticks are useless).
 *     `cell.delta` frames COALESCE by the
 *     `(symbol, bucket_ts, price_bucket)` triple: an enqueued delta
 *     for the same triple has its volumes / trades summed into the
 *     earlier frame, and the new frame is not enqueued separately.
 *     `cell.close`, `snapshot`, and any `control.*` frame NEVER
 *     drop — if any of them cannot fit, the circuit breaker fires.
 *
 *   - Topic subscription is universal in v1 (every client subscribes
 *     to every topic). The `topics` field on the per-client state
 *     exists so v2 can filter without changing this surface.
 *
 * The registry is intentionally independent of the Elysia `ws` shape
 * — it speaks to a small `WSClientSocket` adapter the endpoint
 * supplies on register. That keeps the unit tests honest (fake
 * adapter, no Bun runtime needed).
 *
 * v1 limitation documented inline: connections are in-process. A
 * server restart blanks the registry; clients reconnect from a
 * fresh snapshot via `SnapshotCache`. ADR-006 intentional simplification.
 */

import { encode } from '../bridge/codec';
import {
  type WSFrame,
  type WSFrameKind,
  type WSTopic,
  wsFrameSchema,
} from '../schemas/ws';

/** ADR-006 canonical circuit-breaker thresholds — single source of truth. */
export const WS_QUEUE_MAX_BYTES = 256 * 1024;
export const WS_QUEUE_MAX_WALL_MS = 2_000;

/** ADR-006 reason codes the server attaches to `control.overrun`. */
export type WSOverrunReason = 'queue.overflow' | 'memory.budget';

/**
 * Minimal client-socket surface the registry consumes. Backed by
 * `ElysiaWS` at runtime (which forwards to Bun's `ServerWebSocket`),
 * but the registry never imports Elysia or Bun types directly so the
 * unit tests can hand it a fake adapter.
 *
 * `send` accepts a `Uint8Array` and returns void; the registry trusts
 * the underlying transport to apply OS-level flow control once the
 * application-level circuit breaker has fired.
 */
export interface WSClientSocket {
  send(payload: Uint8Array): void;
  close(code: number, reason: string): void;
}

/**
 * Per-client state. Exposed (read-only) to consumers via the handle
 * returned from `register`. The handle is the only legal surface for
 * the endpoint to interact with its own client; the registry owns
 * the queue and the policy.
 */
export interface WSClientHandle {
  readonly id: number;
  send(payload: Uint8Array): void;
  close(code: number, reason: string): void;
  readonly queueDepth: number;
  readonly droppedFrames: number;
  readonly lastTickTsMs: number | null;
  readonly topics: ReadonlySet<WSTopic>;
}

/**
 * One entry in the per-client send queue.
 *
 * The `kind` discriminator drives the drop / coalesce policy. The
 * `bytes` field is the encoded msgpack frame ready for `socket.send`.
 * The `length` cache avoids recomputing `bytes.byteLength` on every
 * eviction check (registries with thousands of queued frames pay this
 * back).
 *
 * `coalesceKey` is set only on `cell.delta` frames; the registry
 * uses it as a fast equality probe before falling back to encoding
 * a merged frame.
 */
interface QueuedFrame {
  kind: WSFrameKind;
  topic: WSTopic;
  bytes: Uint8Array;
  length: number;
  coalesceKey?: string;
  /** Original payload preserved on `cell.delta` for coalescing arithmetic. */
  deltaPayload?: {
    tsMs: number;
    bucketTs: number;
    priceBucket: number;
    bidVolumeDelta: number;
    askVolumeDelta: number;
    tradesDelta: number;
  };
}

interface ClientRecord {
  id: number;
  socket: WSClientSocket;
  queue: QueuedFrame[];
  queuedBytes: number;
  /** Wall-clock ms when the head-of-line frame was enqueued. */
  headEnqueuedAtMs: number | null;
  droppedFrames: number;
  lastTickTsMs: number | null;
  topics: Set<WSTopic>;
  /** Marks a client mid-disconnect so duplicate breakers no-op. */
  closing: boolean;
}

/**
 * Drains the queue head into the underlying socket synchronously.
 *
 * The registry's policy is "if it's in the queue, send it now". We do
 * NOT carry a wall-clock-pacing layer here — the queue exists strictly
 * for the broadcast path to detect head-of-line build-up under
 * backpressure. Under normal load, every frame is sent immediately
 * and the queue stays at depth 1 only for the duration of the
 * `socket.send` call.
 *
 * Returns the number of bytes actually shipped — the caller uses this
 * to maintain `queuedBytes` and `headEnqueuedAtMs`.
 */
function drainQueueToSocket(record: ClientRecord): void {
  while (record.queue.length > 0) {
    const head = record.queue[0];
    if (head === undefined) break;
    try {
      record.socket.send(head.bytes);
    } catch {
      // socket.send throws under Bun if the underlying socket is
      // already closing — there is no recovery here, the close
      // handler will run shortly and remove this client. Stop draining.
      return;
    }
    record.queue.shift();
    record.queuedBytes -= head.length;
  }
  record.headEnqueuedAtMs = null;
}

function deltaCoalesceKey(payload: {
  bucketTs: number;
  priceBucket: number;
}): string {
  return `${String(payload.bucketTs)}|${String(payload.priceBucket)}`;
}

export class WSConnectionRegistry {
  readonly #clients = new Map<number, ClientRecord>();
  /** Process-lifetime overrun-disconnect counter for `/health.ws`. */
  #overrunDisconnects = 0;
  /** Process-lifetime dropped-frame counter for `/health.ws`. */
  #totalDroppedFrames = 0;
  /** Sliding-window broadcast timestamps for `framesPerSecOut`. */
  readonly #broadcastWindow: number[] = [];
  static readonly #BROADCAST_WINDOW_MS = 5_000;
  #nextId = 1;

  /**
   * Default-subscribe every client to all three v1 topics. The set is
   * mutable on the per-client record so v2 multi-symbol subscription
   * can swap it out without changing the registry API.
   */
  readonly #defaultTopics: ReadonlySet<WSTopic> = new Set([
    'ticks.btc',
    'cells.btc',
    'control',
  ]);

  register(socket: WSClientSocket): WSClientHandle {
    const id = this.#nextId++;
    const record: ClientRecord = {
      id,
      socket,
      queue: [],
      queuedBytes: 0,
      headEnqueuedAtMs: null,
      droppedFrames: 0,
      lastTickTsMs: null,
      topics: new Set(this.#defaultTopics),
      closing: false,
    };
    this.#clients.set(id, record);

    // Handle is a thin view onto the record. Arrow functions
    // preserve the registry's `this` without needing an alias.
    const enqueueAndDrain = (
      payload: Uint8Array,
      kind: WSFrameKind,
      topic: WSTopic,
    ): void => {
      this.#enqueueAndDrain(record, payload, kind, topic);
    };
    return {
      get id() {
        return record.id;
      },
      send(payload: Uint8Array): void {
        // Direct send path (used by the snapshot-on-connect frame).
        // Bypasses the broadcast loop but still pays into queueing
        // policy — if the socket is mid-overrun this enqueues and
        // the breaker may still fire.
        enqueueAndDrain(payload, 'snapshot', 'cells.btc');
      },
      close(code: number, reason: string): void {
        if (record.closing) return;
        record.closing = true;
        try {
          record.socket.close(code, reason);
        } catch {
          // Already closed — ignore.
        }
      },
      get queueDepth() {
        return record.queue.length;
      },
      get droppedFrames() {
        return record.droppedFrames;
      },
      get lastTickTsMs() {
        return record.lastTickTsMs;
      },
      get topics() {
        return record.topics;
      },
    };
  }

  unregister(id: number): void {
    this.#clients.delete(id);
  }

  /**
   * Encode + broadcast a frame to every subscribed client.
   *
   * The frame is validated through the WS schema once on the publish
   * side — fail loud on a producer bug rather than ship a malformed
   * frame to N clients. Per ADR-006 § "No fallback parsing".
   *
   * Returns the count of clients the frame was actually delivered
   * (or queued) to. Helps tests assert fan-out reach.
   */
  broadcast(frame: WSFrame): number {
    // Single validation pass on the publish side. Throws on a
    // producer bug so the synthesizer / ingest path surfaces the
    // schema mismatch loudly in dev. This is the explicit
    // guardrail in the task brief — "No fallbacks on bad frames".
    wsFrameSchema.parse(frame);

    const bytes = encode(frame);
    let delivered = 0;

    for (const record of this.#clients.values()) {
      if (record.closing) continue;
      if (!record.topics.has(frame.topic)) continue;

      // Track on the record before queueing so a circuit-break drop
      // still updates last-tick for the overrun frame's payload.
      if (frame.kind === 'tick') {
        record.lastTickTsMs = frame.payload.tsMs;
      }

      this.#enqueueAndDrain(record, bytes, frame.kind, frame.topic, frame);
      delivered++;
    }

    this.#recordBroadcastTick();
    return delivered;
  }

  /**
   * Enqueue a single frame onto a client and immediately drain.
   *
   * Applies the per-kind drop / coalesce policy under pressure, and
   * trips the circuit breaker when either threshold is breached.
   *
   * The `frame` parameter is optional because the snapshot direct
   * send path does not have the parsed envelope — it carries the
   * already-encoded bytes and a known kind/topic pair.
   */
  #enqueueAndDrain(
    record: ClientRecord,
    bytes: Uint8Array,
    kind: WSFrameKind,
    topic: WSTopic,
    frame?: WSFrame,
  ): void {
    if (record.closing) return;

    // Coalesce step: `cell.delta` with a matching key in the queue
    // merges into the earlier frame.
    if (frame?.kind === 'cell.delta') {
      const key = deltaCoalesceKey(frame.payload);
      const existing = record.queue.find(
        (q) => q.kind === 'cell.delta' && q.coalesceKey === key,
      );
      if (existing?.deltaPayload !== undefined) {
        existing.deltaPayload.bidVolumeDelta += frame.payload.bidVolumeDelta;
        existing.deltaPayload.askVolumeDelta += frame.payload.askVolumeDelta;
        existing.deltaPayload.tradesDelta += frame.payload.tradesDelta;
        // Carry the newer observation timestamp so the merged frame
        // reflects the latest activity window.
        existing.deltaPayload.tsMs = frame.payload.tsMs;
        const reEncoded = encode({
          topic: 'cells.btc',
          kind: 'cell.delta',
          payload: {
            tsMs: existing.deltaPayload.tsMs,
            bucketTs: existing.deltaPayload.bucketTs,
            priceBucket: existing.deltaPayload.priceBucket,
            bidVolumeDelta: existing.deltaPayload.bidVolumeDelta,
            askVolumeDelta: existing.deltaPayload.askVolumeDelta,
            tradesDelta: existing.deltaPayload.tradesDelta,
          },
        });
        record.queuedBytes += reEncoded.byteLength - existing.length;
        existing.bytes = reEncoded;
        existing.length = reEncoded.byteLength;
        // Coalesced frames count as dropped — one frame in, zero
        // additional frames enqueued. Surfaces the savings in
        // `/health.ws.droppedFrameCount`.
        record.droppedFrames++;
        this.#totalDroppedFrames++;
        drainQueueToSocket(record);
        return;
      }
    }

    const entry: QueuedFrame = {
      kind,
      topic,
      bytes,
      length: bytes.byteLength,
    };
    if (frame?.kind === 'cell.delta') {
      entry.coalesceKey = deltaCoalesceKey(frame.payload);
      entry.deltaPayload = { ...frame.payload };
    }

    // Drop-policy under pressure: pre-enqueue check. If pushing this
    // frame would exceed the byte budget, attempt to make room by
    // dropping oldest tick frames. If we cannot, the breaker fires.
    while (record.queuedBytes + entry.length > WS_QUEUE_MAX_BYTES) {
      const evicted = this.#evictOldestDroppable(record);
      if (!evicted) {
        // No droppable frame — this is a hard breaker. The new
        // frame itself may or may not be droppable; for snapshot /
        // close / control we fire the breaker. For a tick that
        // arrives into an over-budget queue we still fire because
        // dropping the incoming tick alone does not relieve enough
        // pressure to admit the next snapshot / close.
        this.#tripCircuitBreaker(record, 'queue.overflow');
        return;
      }
    }

    if (record.queue.length === 0) {
      record.headEnqueuedAtMs = Date.now();
    }
    record.queue.push(entry);
    record.queuedBytes += entry.length;

    // Wall-time circuit breaker. Checked after enqueue so a single
    // frame held for 2 s also trips even when the byte budget is
    // far from full (slow client, fast feed).
    if (this.#headIsStale(record)) {
      this.#tripCircuitBreaker(record, 'memory.budget');
      return;
    }

    drainQueueToSocket(record);
  }

  /**
   * Evict the oldest `tick`-kind frame in the queue. Returns true if
   * an eviction happened, false if none was available (in which case
   * the breaker should fire).
   *
   * Frames of kind `cell.close`, `snapshot`, or `control.*` are
   * never evicted — they are the load-bearing state-restoring or
   * lifecycle frames per ADR-006.
   */
  #evictOldestDroppable(record: ClientRecord): boolean {
    const idx = record.queue.findIndex((q) => q.kind === 'tick');
    if (idx < 0) return false;
    const removed = record.queue[idx];
    if (removed === undefined) return false;
    record.queue.splice(idx, 1);
    record.queuedBytes -= removed.length;
    record.droppedFrames++;
    this.#totalDroppedFrames++;
    if (record.queue.length === 0) {
      record.headEnqueuedAtMs = null;
    }
    return true;
  }

  #headIsStale(record: ClientRecord): boolean {
    if (record.headEnqueuedAtMs === null) return false;
    return Date.now() - record.headEnqueuedAtMs >= WS_QUEUE_MAX_WALL_MS;
  }

  /**
   * Emit `control.overrun` to the client then close the socket with
   * `CloseEvent.code = 4290` per ADR-006. Idempotent — repeated
   * breach signals are absorbed.
   */
  #tripCircuitBreaker(
    record: ClientRecord,
    reason: WSOverrunReason,
  ): void {
    if (record.closing) return;
    record.closing = true;
    this.#overrunDisconnects++;

    // Construct the overrun frame and send it directly through the
    // socket bypassing the queue (which is already saturated).
    const overrunFrame: WSFrame = {
      topic: 'control',
      kind: 'control.overrun',
      payload: {
        reason,
        droppedFrames: record.droppedFrames,
        // `lastTickTsMs` is non-nullable on the payload. If the
        // client never received a tick, surface the breach time
        // itself so the schema still parses — the browser uses
        // this only as a "reconnected at" hint per the schema.
        lastTickTsMs: record.lastTickTsMs ?? Date.now(),
      },
    };
    try {
      record.socket.send(encode(overrunFrame));
    } catch {
      // Socket already gone — close call below will also no-op.
    }
    try {
      record.socket.close(4290, reason);
    } catch {
      // Already closed — ignore.
    }
  }

  /**
   * Records a broadcast in the sliding 5-second window. Old entries
   * are pruned lazily on every record so the buffer never grows
   * beyond the active window length.
   */
  #recordBroadcastTick(): void {
    const now = Date.now();
    this.#broadcastWindow.push(now);
    const cutoff = now - WSConnectionRegistry.#BROADCAST_WINDOW_MS;
    while (
      this.#broadcastWindow.length > 0 &&
      (this.#broadcastWindow[0] ?? Infinity) < cutoff
    ) {
      this.#broadcastWindow.shift();
    }
  }

  /**
   * Sliding-window outbound broadcast rate, frames-per-second over
   * the last 5 s. Read by both the `control.heartbeat` payload and
   * the `/health.ws.framesPerSecOut` field — single source of truth.
   */
  framesPerSecOut(): number {
    const now = Date.now();
    const cutoff = now - WSConnectionRegistry.#BROADCAST_WINDOW_MS;
    while (
      this.#broadcastWindow.length > 0 &&
      (this.#broadcastWindow[0] ?? Infinity) < cutoff
    ) {
      this.#broadcastWindow.shift();
    }
    const count = this.#broadcastWindow.length;
    if (count === 0) return 0;
    return count / (WSConnectionRegistry.#BROADCAST_WINDOW_MS / 1000);
  }

  get connectedClients(): number {
    return this.#clients.size;
  }

  get droppedFrameCount(): number {
    return this.#totalDroppedFrames;
  }

  get overrunDisconnectCount(): number {
    return this.#overrunDisconnects;
  }

  /**
   * Snapshot of all connected client handles. Used by the heartbeat
   * loop and observability paths — never by per-frame producers
   * (which use `broadcast` so the registry can fan out efficiently).
   */
  clients(): IterableIterator<ClientRecord> {
    return this.#clients.values();
  }
}

/**
 * Process-singleton registry. The Elysia handler and the synthesizer
 * both reach for this — single source of truth for connected clients.
 * Reset only by process restart per the v1 in-memory simplification.
 */
let singleton: WSConnectionRegistry | null = null;

export function getRegistry(): WSConnectionRegistry {
  singleton ??= new WSConnectionRegistry();
  return singleton;
}

/**
 * Test-only reset. Not exported from the barrel — tests import this
 * file directly to keep the production surface honest.
 */
export function __resetRegistryForTests(): void {
  singleton = null;
}
