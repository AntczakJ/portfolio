/**
 * WS frame synthesizer — Task 1.6b per ADR-006.
 *
 * Gated by `WS_SYNTHESIZE=1`. Emits a slow deterministic stream so a
 * Task 2.6 browser client sees the contract working end-to-end before
 * the real producers land (Binance ingest in Task 1.3, Rust worker in
 * Task 1.5, replay engine in Task 1.7).
 *
 * Cadence chosen for visible-but-not-noisy demo:
 *
 *  - **5 ticks / second** (one every 200 ms). Slow enough to be
 *    legible in the tape strip when scrolling at human speed, fast
 *    enough to look alive.
 *  - **1 `cell.delta` every 500 ms** (one every 2.5 ticks). Mirrors
 *    the production coalescing window (~50 ms per ADR-003) but at
 *    10× rate slowdown so the chart paints visible mutation steps
 *    instead of a continuous blur.
 *  - **1 `cell.close` every 60 s**. Matches the canonical 1-minute
 *    footprint bar boundary. Real producers use the actual wall
 *    clock; the synthesizer uses a virtual clock starting at the
 *    process boot timestamp so the demo is reproducible across
 *    restarts within a single session.
 *
 * Deterministic RNG: a small in-file LCG seeded by
 * `WS_SYNTHESIZE_SEED` (default `1`). LCG output drives:
 *
 *  - Tick price as a random walk inside +/-25 USD around a $71200
 *    anchor.
 *  - Tick quantity as a uniform draw in [0.001, 0.500] BTC.
 *  - Aggressor as a 50 / 50 buy / sell flip.
 *  - Price bucket derived from the tick price via `floor(price / $5)`
 *    — emitted as a **bucket INDEX** (not a USD price), matching the
 *    Rust worker (`worker/src/bucketing.rs::price_bucket`) and the
 *    renderer's INDEX-based scale math. So the cell schema invariant
 *    ("delta for the same `(bucketTs, priceBucket)` coalesces") and
 *    the end-to-end unit convention are both exercised in practice.
 *
 * The seed and constants are documented inline so a future agent
 * can reproduce the demo stream from scratch.
 *
 * Frames are produced through the registry's broadcast path — the
 * same hot path real ingest will use — and the snapshot cache is
 * updated on every emit so a mid-run reconnect gets a non-trivial
 * snapshot.
 */

import {
  priceBucket,
  TIME_BUCKET_MS,
  timeBucket,
} from '../aggregator/bucketing';
import { type WorkerPipeline } from '../bridge';
import { WS_SNAPSHOT_CELLS_PIN } from '../schemas/ws';

import type { WSConnectionRegistry } from './connections';
import type { SnapshotCache } from './snapshot-cache';

/** Canonical v1 symbol — single-symbol scope per PLAN.md. */
const SYNTH_SYMBOL = 'BTCUSDT-PERP';

/** $71,200 anchor — picked at synthesizer authoring time, arbitrary but stable. */
const SYNTH_PRICE_ANCHOR = 71_200;
/**
 * Half-range of per-tick scatter around the moving anchor. ±$200 spans
 * 80 price buckets at the canonical `$5` grid (the `PRICE_BUCKET_USD`
 * value imported helpers in `aggregator/bucketing` apply).
 */
const SYNTH_PRICE_HALF_RANGE = 200;
/** Per-tick anchor drift (random walk). Keeps the chart visually alive. */
const SYNTH_ANCHOR_DRIFT_STEP = 3;
/** Bound for anchor drift from the seed anchor — prevents unbounded walk. */
const SYNTH_ANCHOR_DRIFT_BOUND = 800;

const SYNTH_QTY_MIN = 0.001;
const SYNTH_QTY_MAX = 0.5;

export const SYNTH_TICK_INTERVAL_MS = 200;
export const SYNTH_CELL_DELTA_INTERVAL_MS = 500;
/**
 * Synthesizer close CADENCE — how often the `cell.close` timer fires.
 * Bound to `TIME_BUCKET_MS` (not a bare literal) because the demo closes
 * one bar per real-time bucket width: the cadence equals the grid by
 * design. This is a timer period, semantically distinct from the
 * bucketing grid that `timeBucket` / `priceBucket` own — they share the
 * same numeric value but not the same meaning, so this stays a named
 * synth constant rather than a third `timeBucket` call site. Aliasing it
 * keeps ADR-007's "no fifth inline 60_000" rule honest.
 */
export const SYNTH_CELL_CLOSE_INTERVAL_MS = TIME_BUCKET_MS;

/**
 * Default LCG seed — change `WS_SYNTHESIZE_SEED` to drive a
 * different deterministic stream. Documented in the README under
 * "Local development" so a contributor can recreate any reported
 * demo session.
 */
export const SYNTH_DEFAULT_SEED = 1;

/**
 * Numerical Recipes / Knuth & Lewis LCG constants. Period 2^32.
 * More than enough for a slow synth stream. The class is private to
 * this module — production paths never call into it.
 */
class LCG {
  #state: number;
  constructor(seed: number) {
    // Normalise into the 32-bit unsigned domain so a zero seed
    // doesn't immediately produce 0 outputs.
    this.#state = (seed >>> 0) || 1;
  }
  /** Next pseudo-random uint32. */
  nextUint32(): number {
    // `a = 1664525`, `c = 1013904223` — classic Knuth choice.
    this.#state = (Math.imul(this.#state, 1664525) + 1013904223) >>> 0;
    return this.#state;
  }
  /** Uniform float in `[0, 1)`. */
  nextUnit(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }
  /** Uniform float in `[min, max)`. */
  nextRange(min: number, max: number): number {
    return min + this.nextUnit() * (max - min);
  }
}

export interface SynthesizerOptions {
  registry: WSConnectionRegistry;
  snapshotCache: SnapshotCache;
  /** Override default seed (env: `WS_SYNTHESIZE_SEED`). */
  seed?: number;
  /** Inject a clock for tests. Returns ms-since-epoch. */
  now?: () => number;
  /** Inject a timer for tests. */
  setInterval?: (cb: () => void, ms: number) => unknown;
  /** Inject the matching clearer. */
  clearInterval?: (handle: unknown) => void;
  /**
   * **Offline cell-producing path (worker-fed synth).** When provided,
   * the synthesizer pushes every synthesised tick INTO the Rust worker
   * via `pipeline.sendTick(...)` — making the worker the authoritative
   * cell aggregator just as it is on the real Binance ingest path. In
   * this mode the synthesizer's OWN `cell.delta` / `cell.close`
   * emission is SUPPRESSED (the worker emits those over the bridge and
   * the `WorkerPipeline` fans them out), so there is exactly one cell
   * producer and no double-counting.
   *
   * This is the local/offline equivalent of the Binance pipeline: it
   * exercises the full `synth tick -> Elysia -> bridge -> Rust worker
   * -> aggregated cell -> bridge -> WS broadcast` loop without a live
   * Binance feed, which Task 1.3 documented as unreachable on the
   * owner's network and which the deploy fallback also needs.
   *
   * When `undefined` (the historic default), the synthesizer keeps its
   * self-contained behaviour: it broadcasts ticks AND emits its own
   * cells directly to the registry, the bridge is not in the loop.
   * Production paths (Binance) never construct a worker-fed synth — the
   * boot mutex in `src/server.ts` only wires this when
   * `WS_SYNTHESIZE=1 + WORKER_PIPELINE_ENABLED=1 + BINANCE_WS_ENABLED=0`.
   */
  workerPipeline?: WorkerPipeline;
}

/**
 * Accumulates the open-bar state so `cell.close` can emit absolute
 * totals (per ADR-005 / ADR-006 — close is a rebase, not a delta).
 */
interface OpenBarState {
  bucketTs: number;
  byPriceBucket: Map<
    number,
    { bidVolume: number; askVolume: number; trades: number }
  >;
}

export class WSSynthesizer {
  readonly #registry: WSConnectionRegistry;
  readonly #snapshotCache: SnapshotCache;
  readonly #workerPipeline: WorkerPipeline | null;
  readonly #rng: LCG;
  readonly #now: () => number;
  readonly #setInterval: (cb: () => void, ms: number) => unknown;
  readonly #clearInterval: (handle: unknown) => void;
  #tickTimer: unknown = null;
  #cellDeltaTimer: unknown = null;
  #cellCloseTimer: unknown = null;
  #openBar: OpenBarState;
  #running = false;
  /** Last tick produced — exposed for test step assertions. */
  #lastTickIndex = 0;
  /** Drifting anchor — random-walks per tick within ±SYNTH_ANCHOR_DRIFT_BOUND. */
  #currentAnchor = SYNTH_PRICE_ANCHOR;

  constructor(options: SynthesizerOptions) {
    this.#registry = options.registry;
    this.#snapshotCache = options.snapshotCache;
    this.#workerPipeline = options.workerPipeline ?? null;
    this.#rng = new LCG(options.seed ?? SYNTH_DEFAULT_SEED);
    this.#now = options.now ?? (() => Date.now());
    this.#setInterval =
      options.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.#clearInterval =
      options.clearInterval ??
      ((h) => {
        clearInterval(h as ReturnType<typeof setInterval>);
      });
    this.#openBar = {
      bucketTs: this.#bucketTsFor(this.#now()),
      byPriceBucket: new Map(),
    };
    // Seed the snapshot cache with the symbol / currentBarTs so a
    // first-connect immediately after process start sees a valid
    // (empty-history) snapshot rather than a `null`.
    this.#snapshotCache.update(SYNTH_SYMBOL, {
      symbol: SYNTH_SYMBOL,
      currentBarTs: this.#openBar.bucketTs,
    });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#tickTimer = this.#setInterval(
      () => {
        this.#emitTick();
      },
      SYNTH_TICK_INTERVAL_MS,
    );
    // Worker-fed mode: the Rust worker is the authoritative cell
    // aggregator (fed by `#emitTick`'s `pipeline.sendTick`), so the
    // synthesizer must NOT also emit its own cell.delta / cell.close —
    // that would double-count. The cell timers stay disarmed; cells
    // arrive over the bridge and the `WorkerPipeline` fans them out.
    if (this.#workerPipeline === null) {
      this.#cellDeltaTimer = this.#setInterval(
        () => {
          this.#emitCellDelta();
        },
        SYNTH_CELL_DELTA_INTERVAL_MS,
      );
      this.#cellCloseTimer = this.#setInterval(
        () => {
          this.#emitCellClose();
        },
        SYNTH_CELL_CLOSE_INTERVAL_MS,
      );
    }
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#tickTimer !== null) this.#clearInterval(this.#tickTimer);
    if (this.#cellDeltaTimer !== null)
      this.#clearInterval(this.#cellDeltaTimer);
    if (this.#cellCloseTimer !== null)
      this.#clearInterval(this.#cellCloseTimer);
    this.#tickTimer = null;
    this.#cellDeltaTimer = null;
    this.#cellCloseTimer = null;
  }

  /**
   * Drive the synthesizer manually — used by tests to assert the
   * deterministic stream without sleeping. One call advances one
   * tick (NOT one cell.delta or close — the cadence is enforced by
   * the interval, not the step).
   */
  stepOnce(kind: 'tick' | 'cell.delta' | 'cell.close'): void {
    if (kind === 'tick') this.#emitTick();
    else if (kind === 'cell.delta') this.#emitCellDelta();
    else this.#emitCellClose();
  }

  #bucketTsFor(tsMs: number): number {
    // 1-minute bucket boundaries, UTC-aligned. Delegates to the shared
    // `timeBucket` helper (ADR-007 single source of truth) — identical
    // output to the previous `tsMs - (tsMs % 60_000)` for non-negative
    // epoch-ms (`Math.floor(tsMs / 60_000) * 60_000`), with the signed
    // branch as defensive parity with the Rust port.
    return timeBucket(tsMs);
  }

  #pickPriceBucket(price: number): number {
    // Emit a bucket INDEX (matches the Rust worker's `price_bucket()`
    // and the renderer's `priceMid` units). Earlier revisions emitted
    // a USD-floored price here — that produced a unit mismatch with
    // the chart's `priceToY`, which expects INDEX-based math and
    // pushed every cell ~tens of thousands of pixels off-viewport.
    // Delegates to the shared `priceBucket` helper (ADR-007) — same
    // `Math.floor(price / 5)` math, one source of truth.
    return priceBucket(price);
  }

  #emitTick(): void {
    const tsMs = this.#now();
    // Drift the anchor by a small step every tick, clamped so the
    // walk never wanders unboundedly away from the seed anchor.
    const drift = this.#rng.nextRange(-SYNTH_ANCHOR_DRIFT_STEP, SYNTH_ANCHOR_DRIFT_STEP);
    this.#currentAnchor = Math.max(
      SYNTH_PRICE_ANCHOR - SYNTH_ANCHOR_DRIFT_BOUND,
      Math.min(SYNTH_PRICE_ANCHOR + SYNTH_ANCHOR_DRIFT_BOUND, this.#currentAnchor + drift),
    );
    const price =
      this.#currentAnchor +
      this.#rng.nextRange(-SYNTH_PRICE_HALF_RANGE, SYNTH_PRICE_HALF_RANGE);
    const qty = this.#rng.nextRange(SYNTH_QTY_MIN, SYNTH_QTY_MAX);
    const aggressor: 'buy' | 'sell' =
      this.#rng.nextUnit() < 0.5 ? 'buy' : 'sell';

    // Round price to 2 decimals — Binance Futures price ticks at
    // $0.10 on BTC-PERP, but the synthesizer uses 2 dp so the
    // numbers look like real exchange data without going past
    // safe-int.
    const roundedPrice = Math.round(price * 100) / 100;
    const roundedQty = Math.round(qty * 1_000_000) / 1_000_000;

    this.#registry.broadcast({
      topic: 'ticks.btc',
      kind: 'tick',
      payload: {
        tsMs,
        price: roundedPrice,
        qty: roundedQty,
        aggressor,
      },
    });

    // Worker-fed mode: push this synth tick INTO the Rust worker so it
    // aggregates the footprint cell and emits cell.delta / cell.close
    // back over the bridge (the `WorkerPipeline` fans those out). This
    // is the offline equivalent of the Binance ingest path's
    // `pipeline.sendTick(...)` call — same topology, deterministic
    // synth source instead of the live feed. A no-op when the bridge
    // client is not yet `connected` (handshake pending / mid-restart);
    // the worker sees ticks again once it reconnects.
    if (this.#workerPipeline !== null) {
      this.#workerPipeline.sendTick({
        tsMs,
        symbol: SYNTH_SYMBOL,
        price: roundedPrice,
        qty: roundedQty,
        aggressor,
      });
    }

    // Accumulate into the open bar so the matching `cell.close`
    // emits correct absolute totals.
    const bucketTs = this.#bucketTsFor(tsMs);
    if (bucketTs !== this.#openBar.bucketTs) {
      this.#openBar = { bucketTs, byPriceBucket: new Map() };
    }
    const priceBucket = this.#pickPriceBucket(roundedPrice);
    let cell = this.#openBar.byPriceBucket.get(priceBucket);
    if (cell === undefined) {
      cell = { bidVolume: 0, askVolume: 0, trades: 0 };
      this.#openBar.byPriceBucket.set(priceBucket, cell);
    }
    if (aggressor === 'buy') {
      cell.askVolume += roundedQty;
    } else {
      cell.bidVolume += roundedQty;
    }
    cell.trades++;

    // Update the snapshot cache so reconnects see this tick.
    this.#snapshotCache.update(SYNTH_SYMBOL, {
      recentTicks: [
        { tsMs, price: roundedPrice, qty: roundedQty, aggressor },
      ],
      currentBarTs: this.#openBar.bucketTs,
    });

    this.#lastTickIndex++;
  }

  #emitCellDelta(): void {
    const tsMs = this.#now();
    const bucketTs = this.#bucketTsFor(tsMs);
    if (bucketTs !== this.#openBar.bucketTs) {
      this.#openBar = { bucketTs, byPriceBucket: new Map() };
    }
    // Pick a price bucket near the anchor — use the LCG so the
    // sequence is deterministic.
    const priceJitter = this.#rng.nextRange(
      -SYNTH_PRICE_HALF_RANGE,
      SYNTH_PRICE_HALF_RANGE,
    );
    const priceBucket = this.#pickPriceBucket(this.#currentAnchor + priceJitter);
    const bidVolumeDelta = Math.round(this.#rng.nextRange(0.001, 0.2) * 1_000_000) / 1_000_000;
    const askVolumeDelta = Math.round(this.#rng.nextRange(0.001, 0.2) * 1_000_000) / 1_000_000;
    const tradesDelta = Math.floor(this.#rng.nextRange(1, 4));

    this.#registry.broadcast({
      topic: 'cells.btc',
      kind: 'cell.delta',
      payload: {
        tsMs,
        bucketTs,
        priceBucket,
        bidVolumeDelta,
        askVolumeDelta,
        tradesDelta,
      },
    });

    let cell = this.#openBar.byPriceBucket.get(priceBucket);
    if (cell === undefined) {
      cell = { bidVolume: 0, askVolume: 0, trades: 0 };
      this.#openBar.byPriceBucket.set(priceBucket, cell);
    }
    cell.bidVolume += bidVolumeDelta;
    cell.askVolume += askVolumeDelta;
    cell.trades += tradesDelta;

    this.#snapshotCache.update(SYNTH_SYMBOL, {
      cellsOpen: [
        {
          tsMs,
          bucketTs,
          priceBucket,
          bidVolumeDelta,
          askVolumeDelta,
          tradesDelta,
        },
      ],
      currentBarTs: bucketTs,
    });
  }

  #emitCellClose(): void {
    // Close the bar that is currently open. Each accumulated
    // `(priceBucket → {bid, ask, trades})` becomes one `cell.close`
    // frame with absolute totals.
    const closingBucketTs = this.#openBar.bucketTs;
    const closedCells: {
      symbol: string;
      bucketTs: number;
      priceBucket: number;
      bidVolume: number;
      askVolume: number;
      trades: number;
    }[] = [];
    for (const [priceBucket, totals] of this.#openBar.byPriceBucket) {
      const closeFrame = {
        symbol: SYNTH_SYMBOL,
        bucketTs: closingBucketTs,
        priceBucket,
        bidVolume: Math.round(totals.bidVolume * 1_000_000) / 1_000_000,
        askVolume: Math.round(totals.askVolume * 1_000_000) / 1_000_000,
        trades: totals.trades,
      };
      closedCells.push(closeFrame);
      this.#registry.broadcast({
        topic: 'cells.btc',
        kind: 'cell.close',
        payload: closeFrame,
      });
    }

    // Promote close frames into the cache's closed-cells ring,
    // reset the open-cells ring, and rotate the bar.
    if (closedCells.length > 0) {
      // Trim to pin in case the bar emitted more cells than the
      // cache can hold (won't happen at synth volume but keeps the
      // invariant honest under future producers).
      const trimmed = closedCells.slice(-WS_SNAPSHOT_CELLS_PIN);
      this.#snapshotCache.update(SYNTH_SYMBOL, { cells: trimmed });
    }
    this.#snapshotCache.resetCellsOpen(SYNTH_SYMBOL);

    const nextBarTs = closingBucketTs + TIME_BUCKET_MS;
    this.#openBar = { bucketTs: nextBarTs, byPriceBucket: new Map() };
    this.#snapshotCache.update(SYNTH_SYMBOL, { currentBarTs: nextBarTs });
  }

  get isRunning(): boolean {
    return this.#running;
  }

  get lastTickIndex(): number {
    return this.#lastTickIndex;
  }
}
