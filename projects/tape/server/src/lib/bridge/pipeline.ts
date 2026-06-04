/**
 * Worker pipeline — Task 1.5 per ADR-001..006.
 *
 * Glue layer that:
 *
 *  1. Holds a `BridgeClient` connection to the Rust worker (already
 *     started by the supervisor; we are the client, not the listener).
 *  2. Listens for inbound `BridgeFrame` values on that connection.
 *  3. Promotes `cell.delta` / `cell.close` / `snapshot` /
 *     `worker_ready` / `worker_unavailable` into the matching public
 *     WS frame envelope and broadcasts via the registry.
 *  4. Pushes incoming Binance ticks INTO the worker via the bridge
 *     (the new Task 1.5 ingest topology — the worker becomes the
 *     authoritative aggregator instead of the TS-side synthesizer).
 *  5. Maintains live counters for `/health.worker` (`cellsOpen`,
 *     `ticksProcessed`).
 *
 * Lifecycle:
 *
 *   start() ─▶ supervisor.start()              (spawn `worker` binary)
 *              await `worker_ready` (or timeout → restart)
 *              bridgeClient.connect()
 *              snapshot poll timer
 *
 *   stop()  ─▶ stop snapshot poll timer
 *              bridgeClient.close('shutdown')
 *              supervisor.stop()               (SIGTERM)
 *
 * The pipeline is the canonical "WORKER_PIPELINE_ENABLED=1" surface in
 * `src/server.ts`. The mutex precedence is:
 *
 *   1. BINANCE_WS_ENABLED + WORKER_PIPELINE_ENABLED=1 → real ingest
 *      through Binance → tickWriter + bridge.send(tick) → worker → WS.
 *   2. BINANCE_WS_ENABLED + WORKER_PIPELINE_ENABLED=0 → real ingest
 *      through Binance → tickWriter + direct WS broadcast (no
 *      aggregation; ADR-004 § Limitation cited in README).
 *   3. WS_SYNTHESIZE=1 (no Binance) → synthesizer publishes ticks
 *      AND cell.delta / cell.close directly. The bridge is NOT in the
 *      loop in this mode — it is a dev convenience.
 *
 * The pipeline does NOT touch tickWriter — that path stays direct from
 * Binance ingest to Postgres (ADR-005 invariant: tick archival is
 * decoupled from worker availability so a worker crash-loop does not
 * block persistence).
 */

import {
  type BridgeFrame,
  type CellClose,
  type CellDelta,
  type SnapshotPayload,
  type WorkerReady,
  type WorkerUnavailable,
} from '../schemas/bridge';
import {
  type WSFrame,
  WS_SNAPSHOT_CELLS_PIN,
  type WSCellClosePayload,
  type WSCellDeltaPayload,
} from '../schemas/ws';
import { type WSConnectionRegistry } from '../ws/connections';
import { type SnapshotCache } from '../ws/snapshot-cache';
import { type CellWriter, getCellWriter } from '../ingest/cell-writer';
import { getIngestSession, type IngestSession } from '../ingest/ingest-session';

import { Backoff } from './backoff';
import { BridgeClient } from './client';
import { decode, encode } from './codec';
import {
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_SNAPSHOT_POLL_MS,
} from './config';
import { defaultBridgePath } from './path';
import { type WorkerSupervisor } from './supervisor';

export interface WorkerPipelineOptions {
  readonly supervisor: WorkerSupervisor;
  readonly registry: WSConnectionRegistry;
  readonly snapshotCache: SnapshotCache;
  /** UDS / pipe path override — defaults to `defaultBridgePath()`. */
  readonly bridgePath?: string;
  /** Override the handshake timeout (tests). */
  readonly handshakeTimeoutMs?: number;
  /** Override the snapshot poll cadence (tests). */
  readonly snapshotPollMs?: number;
  /**
   * Footprint-cell persistence writer (Task 1.5f / ADR-005). Defaults
   * to the process-singleton `getCellWriter()`. Receives every
   * `cell.close` frame and persists closed bars to `footprint_cells`
   * (one transaction per bar, idempotent upsert). Injected in tests.
   */
  readonly cellWriter?: CellWriter;
  /**
   * Ingest session providing the `footprint_cells.session_id` FK.
   * Defaults to the process-singleton `getIngestSession()` — the SAME
   * session the Binance ingestor opens, so cells and ticks share a
   * session row. For the offline synth path (no Binance ingestor) the
   * pipeline opens this session itself at `start()`. Injected in tests.
   */
  readonly session?: IngestSession;
}

interface PipelineMetrics {
  cellsOpen: number;
  ticksProcessed: number;
  workerReady: boolean;
  handshakeMisses: number;
}

export class WorkerPipeline {
  readonly #supervisor: WorkerSupervisor;
  readonly #registry: WSConnectionRegistry;
  readonly #snapshotCache: SnapshotCache;
  readonly #bridgePath: string;
  readonly #handshakeTimeoutMs: number;
  readonly #snapshotPollMs: number;
  readonly #cellWriter: CellWriter;
  readonly #session: IngestSession;
  readonly #client: BridgeClient;
  readonly #backoff = new Backoff();
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  #handshakeResolved = false;
  #running = false;
  #metrics: PipelineMetrics = {
    cellsOpen: 0,
    ticksProcessed: 0,
    workerReady: false,
    handshakeMisses: 0,
  };

  constructor(options: WorkerPipelineOptions) {
    this.#supervisor = options.supervisor;
    this.#registry = options.registry;
    this.#snapshotCache = options.snapshotCache;
    this.#bridgePath = options.bridgePath ?? defaultBridgePath();
    this.#handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? BRIDGE_HANDSHAKE_TIMEOUT_MS;
    this.#snapshotPollMs = options.snapshotPollMs ?? BRIDGE_SNAPSHOT_POLL_MS;
    this.#cellWriter = options.cellWriter ?? getCellWriter();
    this.#session = options.session ?? getIngestSession();

    this.#client = new BridgeClient({
      path: this.#bridgePath,
      onMessage: (payload) => {
        this.#dispatch(payload);
      },
    });
  }

  /**
   * Spawn the worker binary, await the handshake, connect the bridge
   * client, and arm the snapshot poll timer. Idempotent.
   */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    // Ensure a session row exists so persisted cells have a valid
    // `footprint_cells.session_id` FK. `IngestSession.start()` is
    // idempotent and singleton-backed: when the Binance ingestor already
    // opened a session, this reuses its id; on the offline synth path
    // (no Binance ingestor) the pipeline opens one here. Tolerant — a DB
    // hiccup at session open degrades persistence (cells will log a null
    // session id and be dropped), it does not block the live board.
    try {
      await this.#session.start();
    } catch (err) {
      console.error(
        '[worker-pipeline] failed to open ingest session for cell persistence (persistence degraded, live board unaffected)',
        err,
      );
    }
    this.#supervisor.start();
    // The supervisor's start path is synchronous — `Bun.spawn` returns
    // before the worker has touched the bridge endpoint, so we need to
    // give the worker a moment to come up before connecting. The
    // BridgeClient's reconnect-with-backoff handles the race naturally:
    // the first connect attempt may fail; we just await the eventual
    // `connected` transition.
    await this.#client.connect();
    this.#armHandshakeTimer();
    this.#armSnapshotPoll();
  }

  /**
   * Tear everything down in reverse-spawn order. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    this.#cancelSnapshotPoll();
    this.#cancelHandshakeTimer();
    try {
      await this.#client.close('pipeline.stop');
    } catch {
      // The client throws inside its disconnecting path — non-fatal.
    }
    await this.#supervisor.stop();
    // Flush the last buffered bar (the worker drains every open cell on
    // SIGTERM, but the final bar may still be buffered in the writer).
    // Tolerant — `flushPending` swallows transient DB errors so a stuck
    // DB does not hang shutdown.
    await this.#cellWriter.flushPending();
  }

  /**
   * Ship one tick into the worker. Called by the Binance ingestor under
   * `WORKER_PIPELINE_ENABLED=1`. No-op when the bridge client is not
   * in the `connected` state — the worker will see ticks again once
   * its handshake completes.
   */
  sendTick(payload: {
    tsMs: number;
    symbol: string;
    price: number;
    qty: number;
    aggressor: 'buy' | 'sell';
  }): void {
    if (this.#client.state !== 'connected') return;
    const frame: BridgeFrame = {
      kind: 'tick',
      payload: {
        ts_ms: BigInt(payload.tsMs),
        symbol: payload.symbol,
        price: payload.price,
        qty: payload.qty,
        aggressor: payload.aggressor === 'buy' ? 'Buy' : 'Sell',
      },
    };
    try {
      this.#client.send(encode(frame));
    } catch (err) {
      console.error('[worker-pipeline] sendTick failed', err);
    }
  }

  /**
   * Send a Snapshot control command, asking the worker to ship its
   * current open-bar state back. Used by the snapshot-poll timer.
   */
  requestSnapshot(): void {
    if (this.#client.state !== 'connected') return;
    const frame: BridgeFrame = {
      kind: 'control',
      payload: { kind: 'Snapshot' },
    };
    try {
      this.#client.send(encode(frame));
    } catch (err) {
      console.error('[worker-pipeline] requestSnapshot failed', err);
    }
  }

  get metrics(): Readonly<PipelineMetrics> {
    return this.#metrics;
  }

  get bridgeState(): string {
    return this.#client.state;
  }

  #dispatch(payload: Uint8Array): void {
    let frame: BridgeFrame;
    try {
      frame = decode<BridgeFrame>(payload);
    } catch (err) {
      console.error('[worker-pipeline] decode failed', err);
      return;
    }
    switch (frame.kind) {
      case 'worker_ready':
        this.#onWorkerReady(frame.payload);
        break;
      case 'worker_unavailable':
        this.#onWorkerUnavailable(frame.payload);
        break;
      case 'cell.delta':
        this.#onCellDelta(frame.payload);
        break;
      case 'cell.close':
        this.#onCellClose(frame.payload);
        break;
      case 'snapshot':
        this.#onSnapshot(frame.payload);
        break;
      // Inbound-only kinds should never arrive here; log and drop.
      case 'tick':
      case 'control':
        console.warn(
          `[worker-pipeline] unexpected inbound kind on bridge: ${frame.kind}`,
        );
        break;
    }
  }

  #onWorkerReady(payload: WorkerReady): void {
    this.#cancelHandshakeTimer();
    this.#handshakeResolved = true;
    this.#metrics.workerReady = true;
    this.#backoff.reset();
    console.log('[worker-pipeline] worker handshake OK');
    // Broadcast the ADR-004 worker-lifecycle frame so every subscribed
    // client can clear its "worker offline" indicator. The generation
    // counter is advisory — it lets the browser correlate the ready
    // frame with the specific worker incarnation. `generation` arrives
    // from the worker as a JS `number` (ts-rs maps it to `number`), but
    // coerce defensively in case the bridge ever widens it to a bigint.
    const readyFrame: WSFrame = {
      topic: 'control',
      kind: 'control.worker_ready',
      payload: {
        generation: bigIntToNumber(payload.generation),
        serverTsMs: Date.now(),
      },
    };
    this.#registry.broadcast(readyFrame);
  }

  #onWorkerUnavailable(payload: WorkerUnavailable): void {
    this.#metrics.workerReady = false;
    console.warn(
      `[worker-pipeline] worker unavailable: ${payload.reason}`,
    );
    // Broadcast the ADR-004 worker-lifecycle frame. Without this the
    // footprint silently freezes on a worker crash-loop while the tape
    // strip keeps moving (ticks are decoupled from the worker per
    // ADR-005) — the documented Task 1.5c gap. `reason` may be empty on
    // a malformed frame; fall back to a generic token so the WS schema
    // (which requires a non-empty string) still parses and the client
    // still gets the offline signal.
    const reason = payload.reason.length > 0 ? payload.reason : 'unavailable';
    const unavailableFrame: WSFrame = {
      topic: 'control',
      kind: 'control.worker_unavailable',
      payload: {
        reason,
        serverTsMs: Date.now(),
      },
    };
    this.#registry.broadcast(unavailableFrame);
  }

  #onCellDelta(payload: CellDelta): void {
    const wsPayload: WSCellDeltaPayload = {
      tsMs: bigIntToNumber(payload.ts_ms),
      bucketTs: bigIntToNumber(payload.bucket_ts),
      priceBucket: bigIntToNumber(payload.price_bucket),
      bidVolumeDelta: payload.bid_volume_delta,
      askVolumeDelta: payload.ask_volume_delta,
      tradesDelta: payload.trades_delta,
    };
    const wsFrame: WSFrame = {
      topic: 'cells.btc',
      kind: 'cell.delta',
      payload: wsPayload,
    };
    this.#registry.broadcast(wsFrame);
    // Track the open cell on the snapshot cache so a fresh client
    // sees it on connect.
    this.#snapshotCache.update(payload.symbol, {
      currentBarTs: bigIntToNumber(payload.bucket_ts),
      cellsOpen: [wsPayload],
    });
  }

  #onCellClose(payload: CellClose): void {
    const wsPayload: WSCellClosePayload = {
      symbol: payload.symbol,
      bucketTs: bigIntToNumber(payload.bucket_ts),
      priceBucket: bigIntToNumber(payload.price_bucket),
      bidVolume: payload.bid_volume,
      askVolume: payload.ask_volume,
      trades: payload.trades,
    };
    const wsFrame: WSFrame = {
      topic: 'cells.btc',
      kind: 'cell.close',
      payload: wsPayload,
    };
    this.#registry.broadcast(wsFrame);
    // Persist the closed cell (Task 1.5f / ADR-005). Enqueue is sync and
    // never throws; the writer groups by bar and upserts one transaction
    // per bar off the hot path. A null session id means no session row
    // is open (DB hiccup at start, or pre-session race) — drop the cell
    // from persistence rather than violate the NOT NULL FK; the live
    // board already has the frame.
    const sessionId = this.#session.currentId;
    if (sessionId !== null) {
      this.#cellWriter.enqueueClose({
        symbol: wsPayload.symbol,
        bucketTs: wsPayload.bucketTs,
        priceBucket: wsPayload.priceBucket,
        bidVolume: wsPayload.bidVolume,
        askVolume: wsPayload.askVolume,
        trades: wsPayload.trades,
        sessionId,
      });
    }
    // Push into the closed-cell ring; reset the open-cell tail for
    // this symbol because the bar just closed.
    this.#snapshotCache.update(payload.symbol, {
      cells: [wsPayload],
    });
    // The snapshot cache caps cellsOpen at WS_SNAPSHOT_CELLS_PIN, so
    // the natural trim handles overflow; clearing it explicitly on bar
    // close keeps the next snapshot's cellsOpen array semantically
    // accurate (empty until the next delta lands).
    this.#snapshotCache.resetCellsOpen(payload.symbol);
  }

  #onSnapshot(payload: SnapshotPayload): void {
    this.#metrics.cellsOpen = payload.cells_open.length;
    this.#metrics.ticksProcessed = bigIntToNumber(payload.ticks_processed);
    // Snapshot is observability only on this code path — the registry
    // does not re-broadcast a synthetic WS snapshot frame because every
    // connected client already has one from its `open` handler. The
    // snapshot cache is incrementally updated by the cell.delta / close
    // handlers above, so we don't need to overwrite it here either.
    // Reviewers occasionally propose "let's promote bridge snapshots
    // to WS snapshot frames" — the answer is the per-connect snapshot
    // is the load-bearing surface for that schema; mid-stream snapshot
    // pushes would force a "you might also receive snapshots randomly"
    // wrinkle on the browser reducer for no real-world benefit.
    void WS_SNAPSHOT_CELLS_PIN;
  }

  #armHandshakeTimer(): void {
    this.#cancelHandshakeTimer();
    this.#handshakeResolved = false;
    this.#handshakeTimer = setTimeout(() => {
      this.#handshakeTimer = null;
      if (this.#handshakeResolved) return;
      this.#metrics.handshakeMisses += 1;
      console.error(
        `[worker-pipeline] handshake timed out after ${String(this.#handshakeTimeoutMs)}ms — restarting worker`,
      );
      // The supervisor restart path runs through its own backoff curve;
      // we trigger it by stopping + starting. Bun resolves the
      // promises in the next microtask so the restart is non-blocking
      // for our caller.
      void (async () => {
        try {
          await this.#supervisor.stop();
        } catch {
          // ignore
        }
        if (this.#running) {
          this.#supervisor.start();
          this.#armHandshakeTimer();
        }
      })();
    }, this.#handshakeTimeoutMs);
  }

  #cancelHandshakeTimer(): void {
    if (this.#handshakeTimer !== null) {
      clearTimeout(this.#handshakeTimer);
      this.#handshakeTimer = null;
    }
  }

  #armSnapshotPoll(): void {
    this.#cancelSnapshotPoll();
    const tick = (): void => {
      if (!this.#running) return;
      this.requestSnapshot();
      this.#pollTimer = setTimeout(tick, this.#snapshotPollMs);
    };
    this.#pollTimer = setTimeout(tick, this.#snapshotPollMs);
  }

  #cancelSnapshotPoll(): void {
    if (this.#pollTimer !== null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }
}

/**
 * msgpackr decodes the bridge's int64 family values as `bigint`. The
 * WS-side and browser-side surfaces use plain `number` (ms timestamps
 * + price buckets stay inside `Number.MAX_SAFE_INTEGER` for our
 * lifetime per the schema docblocks). One coercion at this boundary
 * keeps the bigint plumbing inside the bridge module and the JS
 * domain code clean.
 */
function bigIntToNumber(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

let singleton: WorkerPipeline | null = null;

/** Test seam — clears the singleton between specs. */
export function __resetWorkerPipelineForTests(): void {
  singleton = null;
}

/**
 * Process-singleton pipeline accessor. Constructed lazily so a unit
 * test that imports this module does not need a supervisor + registry
 * available — the singleton is built only when the boot path asks.
 */
export function getWorkerPipeline(options: {
  readonly supervisor: WorkerSupervisor;
  readonly registry: WSConnectionRegistry;
  readonly snapshotCache: SnapshotCache;
}): WorkerPipeline {
  singleton ??= new WorkerPipeline(options);
  return singleton;
}
