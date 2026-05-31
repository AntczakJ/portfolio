/**
 * Binance ingestor glue — Task 1.3 per ADR-001.
 *
 * Wires the four moving pieces:
 *
 *   BinanceFuturesClient ── aggTrade ──▶ IngestSession.currentId
 *                                          │
 *                                          ├── TickWriter.enqueue(row)        (persistence)
 *                                          │                                   (ADR-005)
 *                                          │
 *                                          ├── WSConnectionRegistry.broadcast (fan-out)
 *                                          │                                   (ADR-006)
 *                                          │
 *                                          └── SnapshotCache.update           (reconnect snapshot)
 *
 * Lifecycle:
 *
 *   start() ────▶ session.start()
 *                 client.connect()
 *                 setBinanceClient(this client)  -> /health.binance reads it
 *
 *   stop()  ────▶ client.close()
 *                 session.stop()
 *                 setBinanceClient(null)
 *
 * **Synthesizer mutex.** Per the parent task brief, the v1 dev
 * synthesizer (`src/lib/ws/synthesizer.ts`) and the real Binance
 * ingestor publish to the SAME registry under the SAME topic
 * (`ticks.btc`). Running both at once would interleave a synthesised
 * BTC walk with the real exchange feed and corrupt the snapshot
 * cache. The mutex policy lives in `src/server.ts` (only one of the
 * two singletons is started depending on `BINANCE_WS_ENABLED`); this
 * module assumes the boot wiring enforced it and does NOT defensively
 * gate the broadcast. The check is at the right layer — the boot
 * layer — and double-checking here would silently mask a boot-wiring
 * regression.
 *
 * **Symbol normalisation.** Binance reports `s = 'BTCUSDT'` on the
 * wire. The internal symbol is `'BTCUSDT-PERP'` (matching the v1
 * synthesizer, the snapshot cache key, the sessions row, and the
 * `tape-web` UI's `SymbolIndicator`). The translator's `symbol`
 * parameter receives the normalised value; the per-message Binance
 * `s` field is intentionally ignored except in debug logs.
 *
 * **Snapshot cache update policy.** Every aggTrade pushes a single
 * tick onto the snapshot cache's recent-ticks ring (which has a fixed
 * pin of `WS_SNAPSHOT_TICKS_PIN = 200` — defined in
 * `lib/schemas/ws/snapshot.ts`). We pass a one-element array; the
 * cache's `update()` appends and trims, so a reconnecting client sees
 * the most recent ~200 ticks since process start. We do NOT touch
 * `cells`, `cellsOpen`, or `currentBarTs` here — those are produced
 * by the Rust worker in Task 1.5 and stay absent in v1 (the chart
 * gracefully renders the tape strip only per the task brief's "v1.0
 * limitation").
 *
 * **`/health.binance` reader.** Exposes a `health()` getter returning
 * the shape `binanceHealthSchema` expects:
 *
 *   { connected, lastTickTsMs, parseErrors, restartCount, sessionId }
 *
 * Read by the `/health` route handler at request time. All values
 * track the live client + session; no caching, no staleness window.
 *
 * **Failure handling.** This class is a glue layer — it does not
 * catch errors thrown by the downstream singletons. The TickWriter is
 * sync-enqueue and never throws; the registry's `broadcast()` is also
 * non-throwing under normal conditions. A schema mismatch on the
 * broadcast envelope WOULD throw (registry validates publish-side)
 * and that throw escapes — by design, it surfaces a producer bug
 * loudly in dev. The Binance client's `onAggTrade` wrapper catches
 * any handler throw (see `binance-client.ts` `#handleMessage`), so a
 * runtime bug in this glue does not kill the WebSocket connection.
 */

import type { BinanceAggTrade } from '../schemas/binance/agg-trade';
import { getRegistry, type WSConnectionRegistry } from '../ws/connections';
import { getSnapshotCache, type SnapshotCache } from '../ws/snapshot-cache';

import { type WorkerPipeline } from '../bridge';
import {
  BinanceFuturesClient,
  setBinanceClient,
  type BinanceFuturesClientOptions,
} from './binance-client';
import { aggTradeToTickRow, aggTradeToWSTick } from './binance-translator';
import {
  getIngestSession,
  type IngestSession,
} from './ingest-session';
import {
  getTickWriter,
  type TickWriter,
} from './tick-writer';

/**
 * Internal symbol used for the snapshot cache key, the session row,
 * and the persisted `ticks.symbol` column. Mirrors the v1 hard-pin in
 * `src/server.ts` (`V1_SYMBOL`).
 */
export const INGEST_SYMBOL = 'BTCUSDT-PERP';

/**
 * WS topic the ingestor publishes ticks under. Matches the
 * synthesizer's `'ticks.btc'` topic so the WS frame contract is
 * identical between the dev synthesizer and the real ingest path.
 */
const TICKS_TOPIC = 'ticks.btc';

export interface BinanceIngestorOptions {
  /** Pass-through to the underlying client. */
  readonly clientOptions?: Partial<Omit<BinanceFuturesClientOptions, 'onAggTrade'>>;
  /** Test seam — defaults to the process-singleton TickWriter. */
  readonly tickWriter?: TickWriter;
  /** Test seam — defaults to the process-singleton WSConnectionRegistry. */
  readonly registry?: WSConnectionRegistry;
  /** Test seam — defaults to the process-singleton SnapshotCache. */
  readonly snapshotCache?: SnapshotCache;
  /** Test seam — defaults to the process-singleton IngestSession. */
  readonly session?: IngestSession;
  /**
   * Optional worker pipeline. When provided, every aggTrade is also
   * pushed into the Rust worker via `pipeline.sendTick(...)` and the
   * direct `registry.broadcast({kind:'tick'})` call is SKIPPED — the
   * worker becomes the authoritative aggregator, emits
   * `cell.delta` / `cell.close` back over the bridge, and the
   * pipeline broadcasts those to WS clients. The tape strip's `tick`
   * frames continue to flow because the worker's outbound stream
   * does not include ticks; the pipeline broadcasts the WS tick frame
   * itself once the worker handshake completes.
   *
   * When this option is `undefined`, the ingestor falls back to the
   * pre-1.5 direct-broadcast topology (tickWriter + WS tick frame).
   * The three-way mutex is enforced at `src/server.ts` boot time.
   */
  readonly workerPipeline?: WorkerPipeline;
}

export interface BinanceHealth {
  readonly connected: boolean;
  readonly lastTickTsMs: number | null;
  readonly parseErrors: number;
  readonly restartCount: number;
  readonly sessionId: string | null;
}

export class BinanceIngestor {
  readonly #tickWriter: TickWriter;
  readonly #registry: WSConnectionRegistry;
  readonly #snapshotCache: SnapshotCache;
  readonly #session: IngestSession;
  readonly #client: BinanceFuturesClient;
  readonly #workerPipeline: WorkerPipeline | null;
  #running = false;

  constructor(options: BinanceIngestorOptions = {}) {
    this.#tickWriter = options.tickWriter ?? getTickWriter();
    this.#registry = options.registry ?? getRegistry();
    this.#snapshotCache = options.snapshotCache ?? getSnapshotCache();
    this.#session = options.session ?? getIngestSession();
    this.#workerPipeline = options.workerPipeline ?? null;

    this.#client = new BinanceFuturesClient({
      ...(options.clientOptions ?? {}),
      onAggTrade: (event) => {
        this.#handleAggTrade(event);
      },
    });
  }

  /**
   * Open a session row and connect the Binance WebSocket. Idempotent
   * — a second `start()` while already running awaits the in-flight
   * connect.
   *
   * Order matters: the session row MUST exist before any tick is
   * enqueued, because the `ticks` table FK references `sessions.id`.
   * A racing aggTrade between `client.connect()` and `session.start()`
   * would otherwise produce a foreign-key violation in the COPY path.
   */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.#session.start();
    setBinanceClient(this.#client);
    await this.#client.connect();
  }

  /**
   * Close the Binance WebSocket and stamp `ended_at` on the active
   * session row. Idempotent. The graceful-shutdown contract in
   * `src/server.ts` calls `stop()` BEFORE stopping the tick writer so
   * pending Binance frames flush through TickWriter's pipeline (per
   * the parent task brief).
   *
   * NOTE: the tick writer's coalescing window is 50 ms, so this
   * method returns once the client + session are both torn down; the
   * boot path is responsible for awaiting the writer's final flush
   * AFTER this returns.
   */
  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    this.#client.close();
    setBinanceClient(null);
    await this.#session.stop();
  }

  /** True if `start()` was called and `stop()` has not yet returned. */
  get running(): boolean {
    return this.#running;
  }

  /**
   * Snapshot for `/health.binance`. All fields read live off the
   * singletons; no caching, no staleness window.
   */
  health(): BinanceHealth {
    return {
      connected: this.#client.connected,
      lastTickTsMs: this.#client.lastTickTsMs,
      parseErrors: this.#client.parseErrors,
      restartCount: this.#client.restartCount,
      sessionId: this.#session.currentId,
    };
  }

  #handleAggTrade(event: BinanceAggTrade): void {
    const sessionId = this.#session.currentId;
    if (sessionId === null) {
      // A pre-session aggTrade is possible in theory (client open
      // races session insert) but we serialise the order in start().
      // If we ever see this in practice it means an out-of-band event
      // path bypassed start() — log and drop. This is the failure
      // boundary that keeps the FK from being violated.
      console.warn(
        '[binance-ingestor] aggTrade received before session opened; dropped',
      );
      return;
    }

    // 1. Persistence — TickWriter enqueue is sync, never throws.
    //    This path runs in BOTH modes (direct broadcast AND worker
    //    pipeline) because tick archival is decoupled from worker
    //    availability per ADR-005 § Decision.
    const row = aggTradeToTickRow(event, sessionId, INGEST_SYMBOL);
    this.#tickWriter.enqueue(row);

    // 2. WS fan-out — registry validates the envelope on publish.
    //    Always broadcast the tick frame; the worker's aggregated
    //    cell.delta / cell.close frames are an ADDITIVE stream, not
    //    a replacement, because the tape strip needs every individual
    //    tick (PLAN.md "every visible trade is a real trade").
    const wsPayload = aggTradeToWSTick(event);
    this.#registry.broadcast({
      topic: TICKS_TOPIC,
      kind: 'tick',
      payload: wsPayload,
    });

    // 3. Worker pipeline — push the tick INTO the worker so it can
    //    aggregate cells and emit cell.delta / cell.close back over
    //    the bridge. The bridge client's send is a no-op when the
    //    worker is not in `connected` state (handshake pending,
    //    crash mid-restart) so a worker outage does not block the
    //    tick archive or the tape strip.
    if (this.#workerPipeline !== null) {
      this.#workerPipeline.sendTick({
        tsMs: wsPayload.tsMs,
        symbol: INGEST_SYMBOL,
        price: wsPayload.price,
        qty: wsPayload.qty,
        aggressor: wsPayload.aggressor,
      });
    }

    // 3. Snapshot cache — append to the recent-ticks ring so a
    // mid-run reconnect sees real tape rather than an empty array.
    // The cache's `update()` appends and trims to the pin; passing a
    // one-element array is the idiomatic incremental update.
    //
    // `currentBarTs` is the 1-minute UTC-aligned bucket containing
    // this tick. The snapshot frame's schema requires a positive int
    // and a v1 chart with no Rust worker still needs a defined right-
    // edge bucket for the tape strip's time anchor. The worker
    // (Task 1.5) will overwrite this with its authoritative open-bar
    // timestamp once it lands; until then, the wall-clock bucket of
    // the most recent tick is the right approximation.
    const bucketTs = event.T - (event.T % 60_000);
    this.#snapshotCache.update(INGEST_SYMBOL, {
      symbol: INGEST_SYMBOL,
      currentBarTs: bucketTs,
      recentTicks: [wsPayload],
    });
  }
}

let singleton: BinanceIngestor | null = null;

export function getBinanceIngestor(
  options: BinanceIngestorOptions = {},
): BinanceIngestor {
  singleton ??= new BinanceIngestor(options);
  return singleton;
}

/**
 * Test-only reset hook. Clears the singleton so a fresh ingestor is
 * constructed on the next `getBinanceIngestor()` call. Not exported
 * from the public boundary — tests import this module directly.
 */
export function __resetBinanceIngestorForTests(): void {
  singleton = null;
}
