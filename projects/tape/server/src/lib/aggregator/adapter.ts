/**
 * Aggregator → WS adapter — Task 1.4 thin integration seam.
 *
 * The aggregator CORE (`core.ts`) is pure: ticks in, frames out, no IO.
 * This adapter is the only place the pure output meets the side-effecting
 * world — it promotes `OutboundFrame` values into the public WS frame
 * envelope (ADR-006) and patches the snapshot cache so a reconnecting
 * client sees the open/closed cells. The DB write-through stays elsewhere
 * (the Rust worker writes closed cells per ADR-005; the TS ingest path
 * archives ticks via `TickWriter`). Keeping the math in `core.ts` and the
 * wiring here is what makes the Rust port (Task 1.5) and the conformance
 * test (Task 5.2) tractable.
 *
 * ════════════════════════════════════════════════════════════════════
 *  SEAM FOR TASK 1.5 (the Rust port). READ THIS BEFORE WIRING THE WORKER.
 *
 *  In production (`WORKER_PIPELINE_ENABLED=1`) the Rust worker is the
 *  authoritative aggregator: ticks go INTO the worker over the bridge,
 *  and `cell.delta` / `cell.close` / `snapshot` frames come BACK over the
 *  bridge, where `lib/bridge/pipeline.ts` already promotes them to WS
 *  frames + snapshot-cache updates. That path does NOT use this adapter
 *  — it is the Rust hot path, and `pipeline.ts` owns the promotion.
 *
 *  THIS adapter is the TS-side equivalent for the modes where the Rust
 *  worker is NOT in the loop:
 *    - a future "TS fallback aggregator" boot mode (worker unavailable),
 *    - replay-mode cell reconstruction (Task 1.7) if it chooses to run
 *      the reference aggregator over archived ticks instead of reading
 *      pre-aggregated cells,
 *    - and the unit / conformance harness, which drives the core and the
 *      adapter without a bridge.
 *
 *  It is wired behind NOTHING by default — `src/server.ts` is untouched
 *  by Task 1.4 (the live production wiring is the Rust path's job in
 *  Task 1.5 per the brief). This is a documented seam: construct a
 *  `WsAggregatorAdapter`, feed it ticks, and it broadcasts + caches
 *  exactly like `pipeline.ts` does for the worker frames. The promotion
 *  logic here is intentionally a mirror of `pipeline.ts`'s
 *  `#onCellDelta` / `#onCellClose` so the two stay consistent.
 * ════════════════════════════════════════════════════════════════════
 */

import type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSFrame,
} from '../schemas/ws';
import type { WSConnectionRegistry } from '../ws/connections';
import type { SnapshotCache } from '../ws/snapshot-cache';

import { AggregatorCore } from './core';
import type { AggregatorTick, CvdRollup, OutboundFrame } from './types';

/** Topic every cell frame is published under in v1 single-symbol scope. */
const CELLS_TOPIC = 'cells.btc';

export interface WsAggregatorAdapterOptions {
  readonly registry: WSConnectionRegistry;
  readonly snapshotCache: SnapshotCache;
  /** Inject a core for tests; defaults to a fresh `AggregatorCore`. */
  readonly core?: AggregatorCore;
}

/**
 * Wraps an `AggregatorCore` and connects its output to the WS registry
 * and snapshot cache. Pure-math stays in the core; this class is the
 * side-effecting boundary.
 */
export class WsAggregatorAdapter {
  readonly #registry: WSConnectionRegistry;
  readonly #snapshotCache: SnapshotCache;
  readonly #core: AggregatorCore;

  constructor(options: WsAggregatorAdapterOptions) {
    this.#registry = options.registry;
    this.#snapshotCache = options.snapshotCache;
    this.#core = options.core ?? new AggregatorCore();
  }

  /** Read-only access to the underlying core (for `/health` counters). */
  get core(): AggregatorCore {
    return this.#core;
  }

  /**
   * Feed one tick: run it through the core and broadcast/cache the
   * resulting `cell.delta`. The tick frame itself is NOT broadcast here
   * — the ingestor already fans out `tick` frames (the tape strip needs
   * every individual trade); this adapter owns only the CELL stream.
   */
  ingestTick(tick: AggregatorTick): void {
    const frames = this.#core.onTick(tick);
    for (const frame of frames) {
      this.#emit(frame);
    }
  }

  /**
   * Drive the bar-rollover: close every bar whose end has passed at
   * `nowMs` and broadcast/cache the resulting `cell.close` frames. The
   * caller supplies `nowMs` (a timer in production) — the adapter, like
   * the core, never reads a clock. Returns the CVD rollups so a caller
   * that drives the CVD sub-pane can forward them.
   */
  rolloverAt(nowMs: number): readonly CvdRollup[] {
    const { frames, cvd } = this.#core.closeExpired(nowMs);
    for (const frame of frames) {
      this.#emit(frame);
    }
    return cvd;
  }

  /** Close every open cell (shutdown path). Returns CVD rollups. */
  drainAll(): readonly CvdRollup[] {
    const { frames, cvd } = this.#core.drainAll();
    for (const frame of frames) {
      this.#emit(frame);
    }
    return cvd;
  }

  #emit(frame: OutboundFrame): void {
    if (frame.kind === 'cell.delta') {
      const payload: WSCellDeltaPayload = {
        tsMs: frame.payload.tsMs,
        bucketTs: frame.payload.bucketTs,
        priceBucket: frame.payload.priceBucket,
        bidVolumeDelta: frame.payload.bidVolumeDelta,
        askVolumeDelta: frame.payload.askVolumeDelta,
        tradesDelta: frame.payload.tradesDelta,
      };
      const wsFrame: WSFrame = {
        topic: CELLS_TOPIC,
        kind: 'cell.delta',
        payload,
      };
      this.#registry.broadcast(wsFrame);
      this.#snapshotCache.update(frame.payload.symbol, {
        currentBarTs: frame.payload.bucketTs,
        cellsOpen: [payload],
      });
      return;
    }

    const payload: WSCellClosePayload = {
      symbol: frame.payload.symbol,
      bucketTs: frame.payload.bucketTs,
      priceBucket: frame.payload.priceBucket,
      bidVolume: frame.payload.bidVolume,
      askVolume: frame.payload.askVolume,
      trades: frame.payload.trades,
    };
    const wsFrame: WSFrame = {
      topic: CELLS_TOPIC,
      kind: 'cell.close',
      payload,
    };
    this.#registry.broadcast(wsFrame);
    this.#snapshotCache.update(frame.payload.symbol, { cells: [payload] });
    this.#snapshotCache.resetCellsOpen(frame.payload.symbol);
  }
}
