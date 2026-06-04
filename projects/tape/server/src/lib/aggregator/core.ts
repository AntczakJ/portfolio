/**
 * Footprint-cell aggregator — Task 1.4, the TypeScript REFERENCE
 * implementation.
 *
 * This module is the spec. Task 1.5 ports it to Rust
 * (`projects/tape/worker/src/aggregator/mod.rs`) and the conformance
 * test (Task 5.2) asserts the Rust port produces byte-identical output
 * on a recorded tick dataset. Three properties are therefore
 * load-bearing and not negotiable:
 *
 *   1. **Purity.** Ticks in, frames out. No DB, no network, no
 *      `Date.now()`, no global mutable state outside `this`. Bar close
 *      is driven by tick timestamps crossing a boundary (the caller
 *      passes `nowMs` into `closeExpired`), never by wall-clock — so
 *      replaying the same ticks always yields the same frames. The
 *      DB write-through and WS broadcast wiring live OUTSIDE this core
 *      (see `adapter.ts`).
 *
 *   2. **Determinism.** Same input sequence ⇒ same output sequence,
 *      every run, on both TS and Rust. `snapshot()` sorts its cells so
 *      even the read path is order-stable.
 *
 *   3. **Conformance with the Rust port.** Every method here has a
 *      one-to-one counterpart on the Rust `Aggregator`. The
 *      `onTick` / `closeExpired` / `drainAll` / `snapshot` math is a
 *      line-by-line mirror. Do not "optimise" one side without
 *      mirroring the other — the conformance test exists to catch drift.
 *
 * ════════════════════════════════════════════════════════════════════
 *  AGGRESSOR → FOOTPRINT-SIDE CHEAT SHEET (read this before touching
 *  the bid/ask routing — a future agent and the Rust port MUST NOT get
 *  it backwards):
 *
 *    tick.aggressor === 'buy'   (taker LIFTED the ask; Binance m=false)
 *        ⇒ trade printed at the ASK
 *        ⇒ add qty to the cell's  ASK_VOLUME
 *
 *    tick.aggressor === 'sell'  (taker HIT the bid; Binance m=true)
 *        ⇒ trade printed at the BID
 *        ⇒ add qty to the cell's  BID_VOLUME
 *
 *  Per-bar delta  = ask_volume − bid_volume   (net AGGRESSIVE BUYING)
 *  CVD            = running cumulative of per-bar delta across bars
 *
 *  This matches `binance-translator.ts`, the Rust `aggregator/mod.rs`
 *  comment, and the `agg-trade.ts` schema docblock. All four say the
 *  same thing on purpose.
 * ════════════════════════════════════════════════════════════════════
 *
 * **Edge-case policy (documented because the tests assert it and the
 * Rust port must match):**
 *
 *   - **Out-of-order tick** (a tick whose `tsMs` is earlier than the
 *     latest tick seen for its symbol): ACCEPTED and accumulated into
 *     its time-bucket's cell exactly as an in-order tick would be.
 *     The aggregator is bucket-addressed, not append-ordered, so a
 *     late tick for a still-open bucket lands in the correct cell.
 *     We do NOT reorder, reject, or clamp — that would diverge from the
 *     Rust port (which is also bucket-addressed) and break conformance.
 *     A counter (`outOfOrderTicks`) is incremented for observability
 *     ONLY; it does not change any emitted frame. The one real
 *     consequence: if the late tick's bucket has ALREADY been closed
 *     (its `cell.close` shipped), the tick opens a NEW cell for the
 *     same `(symbol, bucketTs, priceBucket)` and that cell will close
 *     again later as a second `cell.close` for the same bar. v1 accepts
 *     this (a late tick after bar close is rare and the browser's last
 *     write wins on rebase); v2 may add a grace window. Documented, not
 *     silently swallowed.
 *
 *   - **Duplicate tick** (identical `tsMs` + `price` + `qty` +
 *     `aggressor`, e.g. a reconnect replay): ACCEPTED and counted as a
 *     real trade — volume and trade-count both increment. The
 *     aggregator has no trade-id to dedupe on (the WS tick payload
 *     deliberately drops Binance's aggregate-trade id), so it CANNOT
 *     distinguish a genuine same-ms second trade from a replayed
 *     duplicate. De-duplication, if ever needed, belongs UPSTREAM at
 *     the ingest boundary where the trade id is still available — not
 *     here, where doing it would (a) require carrying the id into the
 *     core and (b) diverge from the Rust port. A counter
 *     (`duplicateTicks`) flags exact-duplicate arrivals for
 *     observability; it does not change any emitted frame.
 *
 *   - **Gap across an empty bar:** no special handling needed. A bar
 *     with zero ticks simply has no cells, emits no `cell.delta` and no
 *     `cell.close`, and contributes `barDelta = 0` to CVD only if it is
 *     never closed (an empty bucket is never in the open map, so
 *     `closeExpired` never emits a rollup for it). CVD therefore steps
 *     only on bars that actually traded — correct.
 *
 *   - **Tick exactly on a bar boundary** (`tsMs % 60_000 === 0`):
 *     belongs to the NEW bar (floor semantics — `timeBucket(60_000)`
 *     is `60_000`, not `0`). A bucket is "expired" at
 *     `bucketTs + 60_000 <= nowMs`, so a bar that opened at `60_000`
 *     closes only once `nowMs >= 120_000`. Boundary ticks never
 *     straddle two bars.
 */

import { priceBucket, timeBucket, TIME_BUCKET_MS } from './bucketing';
import type {
  AggregatorSnapshot,
  AggregatorTick,
  CellDelta,
  CvdRollup,
  OutboundFrame,
} from './types';

/** In-memory running totals for one open cell. Mirrors Rust `CellState`. */
interface CellState {
  bidVolumeTotal: number;
  askVolumeTotal: number;
  tradesTotal: number;
  /** Trade time of the most recent tick in the cell (Rust `last_ts_ms`). */
  lastTsMs: number;
}

/**
 * Composite open-cell key. JS `Map` keys by reference for objects, so we
 * encode the `(symbol, bucketTs, priceBucket)` tuple into a string. The
 * separator is a unit-separator control char that cannot appear in a
 * symbol, so the key is unambiguous. The Rust side uses a
 * `(String, i64, i64)` tuple key directly — same logical key, different
 * representation; both produce the same cell grouping, which is all the
 * conformance test cares about.
 */
function cellKey(symbol: string, bucketTs: number, priceBucketIdx: number): string {
  return `${symbol}\x1f${String(bucketTs)}\x1f${String(priceBucketIdx)}`;
}

/**
 * The pure footprint-cell aggregator.
 *
 * Public surface (each mirrors a Rust `Aggregator` method):
 *   - `onTick(tick)`          → emit the `cell.delta` for this tick.
 *   - `closeExpired(nowMs)`   → emit `cell.close` + CVD rollups for
 *                               every bar whose end has passed.
 *   - `drainAll()`            → close every open cell (shutdown path).
 *   - `snapshot()`            → read-only open-bar dump.
 *   - `cellsOpen` / `ticksProcessed` / `sessionExtreme` / `cvd` getters.
 */
export class AggregatorCore {
  readonly #open = new Map<string, CellState>();
  /** Per-symbol max `tradesTotal` across every cell since construction. */
  readonly #sessionExtreme = new Map<string, number>();
  /** Per-symbol running cumulative volume delta (sum of closed barDelta). */
  readonly #cvd = new Map<string, number>();
  #ticksProcessed = 0;
  #outOfOrderTicks = 0;
  #duplicateTicks = 0;
  /** Per-symbol latest tick `tsMs` seen — drives the out-of-order counter. */
  readonly #lastTsBySymbol = new Map<string, number>();
  /** Set of `(symbol,tsMs,price,qty,aggressor)` keys — drives dup counter. */
  readonly #seenTickKeys = new Set<string>();

  /**
   * Apply one tick. Returns the single `cell.delta` frame the caller
   * should ship (the array shape mirrors the Rust `Vec<OutboundFrame>`
   * and reserves room for a v2 correction frame).
   *
   * The math is identical to the Rust `on_tick`:
   *   - bucket the tick by time and price,
   *   - route qty to bid or ask per the aggressor cheat sheet,
   *   - bump the trade count,
   *   - emit a delta carrying THIS tick's contribution (not the
   *     running total — that is what `snapshot` is for).
   *
   * Out-of-order and duplicate detection are observability side effects
   * ONLY and do not alter the returned frame (see the class docblock).
   */
  onTick(tick: AggregatorTick): OutboundFrame[] {
    this.#ticksProcessed += 1;
    this.#trackOrdering(tick);
    this.#trackDuplicate(tick);

    const bucketTs = timeBucket(tick.tsMs);
    const priceBucketIdx = priceBucket(tick.price);
    const key = cellKey(tick.symbol, bucketTs, priceBucketIdx);

    let cell = this.#open.get(key);
    if (cell === undefined) {
      cell = {
        bidVolumeTotal: 0,
        askVolumeTotal: 0,
        tradesTotal: 0,
        lastTsMs: tick.tsMs,
      };
      this.#open.set(key, cell);
    }
    cell.lastTsMs = tick.tsMs;

    let bidDelta = 0;
    let askDelta = 0;
    if (tick.aggressor === 'sell') {
      // Taker sold INTO the bid → cell's bid_volume grows.
      cell.bidVolumeTotal += tick.qty;
      bidDelta = tick.qty;
    } else {
      // Taker bought FROM the ask → cell's ask_volume grows.
      cell.askVolumeTotal += tick.qty;
      askDelta = tick.qty;
    }
    cell.tradesTotal += 1;

    // Session extreme = max trade-count any cell has reached for this
    // symbol. Monotone over the aggregator's lifetime (the renderer's
    // intensity anchor). Mirrors the Rust `session_extreme` update.
    const extreme = this.#sessionExtreme.get(tick.symbol) ?? 0;
    if (cell.tradesTotal > extreme) {
      this.#sessionExtreme.set(tick.symbol, cell.tradesTotal);
    }

    const delta: CellDelta = {
      tsMs: tick.tsMs,
      symbol: tick.symbol,
      bucketTs,
      priceBucket: priceBucketIdx,
      bidVolumeDelta: bidDelta,
      askVolumeDelta: askDelta,
      tradesDelta: 1,
    };
    return [{ kind: 'cell.delta', payload: delta }];
  }

  /**
   * Emit `cell.close` for every cell whose bucket has ended, and one
   * `CvdRollup` per closed bar.
   *
   * `nowMs` is supplied by the caller (the worker's rollover timer in
   * production, a fixed value in tests) — the aggregator NEVER reads a
   * clock itself. A cell is closed when
   * `bucketTs + TIME_BUCKET_MS <= nowMs`, identical to the Rust
   * predicate. Closed cells are removed from the open map. Session
   * extremes are NOT reset at a bar boundary (they live for the
   * aggregator's lifetime, matching the renderer's expectation).
   *
   * **CVD computation.** All cells of one `(symbol, bucketTs)` bar
   * expire together (they share `bucketTs`, and the predicate is on
   * `bucketTs` alone), so a bar closes atomically inside a single
   * `closeExpired` call. We sum `(askVolume - bidVolume)` over the
   * bar's closed cells to get `barDelta`, add it to the symbol's
   * running CVD, and emit one rollup. Because a bar closes exactly once,
   * each bar contributes to CVD exactly once — no double counting.
   */
  closeExpired(nowMs: number): {
    readonly frames: OutboundFrame[];
    readonly cvd: CvdRollup[];
  } {
    // Collect expired keys first so we do not mutate the map while
    // iterating it (mirrors the Rust collect-then-drain pattern).
    //
    // **Deterministic close order (Task 1.5e — Rust CVD conformance).**
    // The expired keys are sorted by `(symbol, bucketTs, priceBucket)`
    // before draining so the emitted `cell.close` sequence AND the
    // within-bar `barDelta` fold order are identical regardless of the
    // map's insertion order. This is the SAME ordering `snapshot()`
    // already uses, and it is the order the Rust port (`close_expired`,
    // backed by a `HashMap` that has no insertion order) must reproduce
    // to stay byte-identical on the conformance fixtures. Without this
    // sort the two languages would diverge on close order (and, for a
    // bar with non-dyadic multi-cell volumes, on the last-ULP `barDelta`).
    const expiredKeys: string[] = [];
    for (const key of this.#open.keys()) {
      const bucketTs = this.#bucketTsFromKey(key);
      if (bucketTs + TIME_BUCKET_MS <= nowMs) {
        expiredKeys.push(key);
      }
    }
    expiredKeys.sort((a, b) => {
      const ka = this.#decodeKey(a);
      const kb = this.#decodeKey(b);
      if (ka.symbol !== kb.symbol) return ka.symbol < kb.symbol ? -1 : 1;
      if (ka.bucketTs !== kb.bucketTs) return ka.bucketTs - kb.bucketTs;
      return ka.priceBucketIdx - kb.priceBucketIdx;
    });

    const frames: OutboundFrame[] = [];
    // Accumulate per-bar delta keyed by `(symbol, bucketTs)`. Insertion
    // order is preserved by Map, but we sort the rollups before emit so
    // the CVD step order is deterministic across runs and languages.
    const barDeltas = new Map<string, { symbol: string; bucketTs: number; barDelta: number }>();

    for (const key of expiredKeys) {
      const cell = this.#open.get(key);
      if (cell === undefined) continue;
      this.#open.delete(key);
      const { symbol, bucketTs, priceBucketIdx } = this.#decodeKey(key);

      frames.push({
        kind: 'cell.close',
        payload: {
          tsMs: cell.lastTsMs,
          symbol,
          bucketTs,
          priceBucket: priceBucketIdx,
          bidVolume: cell.bidVolumeTotal,
          askVolume: cell.askVolumeTotal,
          trades: cell.tradesTotal,
        },
      });

      const barKey = `${symbol}\x1f${String(bucketTs)}`;
      const acc = barDeltas.get(barKey) ?? { symbol, bucketTs, barDelta: 0 };
      acc.barDelta += cell.askVolumeTotal - cell.bidVolumeTotal;
      barDeltas.set(barKey, acc);
    }

    // Deterministic CVD emit order: by symbol, then bucketTs. CVD is a
    // running sum, so the order in which simultaneously-closing bars are
    // folded matters for reproducibility (it does not matter for the
    // FINAL CVD value, which is commutative, but the per-rollup `cvd`
    // field is the running value and must be stable).
    const sortedBars = [...barDeltas.values()].sort((a, b) =>
      a.symbol === b.symbol ? a.bucketTs - b.bucketTs : a.symbol < b.symbol ? -1 : 1,
    );

    const cvd: CvdRollup[] = [];
    for (const bar of sortedBars) {
      const running = (this.#cvd.get(bar.symbol) ?? 0) + bar.barDelta;
      this.#cvd.set(bar.symbol, running);
      cvd.push({
        symbol: bar.symbol,
        bucketTs: bar.bucketTs,
        barDelta: bar.barDelta,
        cvd: running,
      });
    }

    return { frames, cvd };
  }

  /**
   * Close every open cell, emptying the open map, and roll the closed
   * bars into CVD. Used on shutdown (`ControlCommand.Shutdown` /
   * SIGTERM on the Rust side). Equivalent to `closeExpired(+Infinity)`
   * in effect, but named for intent. Returns the close frames and the
   * CVD rollups for the drained bars.
   */
  drainAll(): {
    readonly frames: OutboundFrame[];
    readonly cvd: CvdRollup[];
  } {
    return this.closeExpired(Number.POSITIVE_INFINITY);
  }

  /**
   * Read-only dump of the open-bar state. `cellsOpen` carries running
   * absolute totals in the `*Delta` fields (the snapshot convention
   * documented on `AggregatorSnapshot`), sorted by
   * `(symbol, bucketTs, priceBucket)` for stable, diffable output.
   * Mirrors the Rust `snapshot()`.
   */
  snapshot(): AggregatorSnapshot {
    let latest = 0;
    const cellsOpen: CellDelta[] = [];
    for (const [key, state] of this.#open) {
      if (state.lastTsMs > latest) latest = state.lastTsMs;
      const { symbol, bucketTs, priceBucketIdx } = this.#decodeKey(key);
      cellsOpen.push({
        tsMs: state.lastTsMs,
        symbol,
        bucketTs,
        priceBucket: priceBucketIdx,
        bidVolumeDelta: state.bidVolumeTotal,
        askVolumeDelta: state.askVolumeTotal,
        tradesDelta: state.tradesTotal,
      });
    }
    cellsOpen.sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
      if (a.bucketTs !== b.bucketTs) return a.bucketTs - b.bucketTs;
      return a.priceBucket - b.priceBucket;
    });
    return { tsMs: latest, cellsOpen, ticksProcessed: this.#ticksProcessed };
  }

  /** Count of currently-open cells across all symbols. */
  get cellsOpen(): number {
    return this.#open.size;
  }

  /** Cumulative `onTick` count since construction. */
  get ticksProcessed(): number {
    return this.#ticksProcessed;
  }

  /** Ticks whose `tsMs` arrived earlier than the symbol's latest seen. */
  get outOfOrderTicks(): number {
    return this.#outOfOrderTicks;
  }

  /** Exact-duplicate ticks observed (same ts/price/qty/aggressor). */
  get duplicateTicks(): number {
    return this.#duplicateTicks;
  }

  /** Per-symbol max trade-count any single cell has reached. */
  sessionExtreme(symbol: string): number {
    return this.#sessionExtreme.get(symbol) ?? 0;
  }

  /**
   * Current running CVD for a symbol (sum of every closed bar's
   * `barDelta` so far). `0` for a symbol whose first bar has not closed
   * yet — CVD steps on bar CLOSE, not on tick arrival.
   */
  cvd(symbol: string): number {
    return this.#cvd.get(symbol) ?? 0;
  }

  #trackOrdering(tick: AggregatorTick): void {
    const last = this.#lastTsBySymbol.get(tick.symbol);
    if (last !== undefined && tick.tsMs < last) {
      this.#outOfOrderTicks += 1;
    }
    if (last === undefined || tick.tsMs > last) {
      this.#lastTsBySymbol.set(tick.symbol, tick.tsMs);
    }
  }

  #trackDuplicate(tick: AggregatorTick): void {
    const key = `${tick.symbol}\x1f${String(tick.tsMs)}\x1f${String(tick.price)}\x1f${String(tick.qty)}\x1f${tick.aggressor}`;
    if (this.#seenTickKeys.has(key)) {
      this.#duplicateTicks += 1;
    } else {
      this.#seenTickKeys.add(key);
    }
  }

  #bucketTsFromKey(key: string): number {
    return this.#decodeKey(key).bucketTs;
  }

  #decodeKey(key: string): {
    symbol: string;
    bucketTs: number;
    priceBucketIdx: number;
  } {
    const sep1 = key.indexOf('\x1f');
    const sep2 = key.indexOf('\x1f', sep1 + 1);
    const symbol = key.slice(0, sep1);
    const bucketTs = Number(key.slice(sep1 + 1, sep2));
    const priceBucketIdx = Number(key.slice(sep2 + 1));
    return { symbol, bucketTs, priceBucketIdx };
  }
}
