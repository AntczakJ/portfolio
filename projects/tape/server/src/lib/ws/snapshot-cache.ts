/**
 * Snapshot cache — Task 1.6b per ADR-006.
 *
 * Holds the most recent server-pushed `snapshot` payload per symbol.
 * The Elysia WS handler reads `current(symbol)` on every fresh
 * connect and ships the cached value as the very first frame.
 *
 * v1 simplification documented in ADR-006: this cache is purely
 * in-memory. A server restart blanks it; the first reconnecting
 * client receives `null` and gets an empty-shape snapshot frame
 * (cells: [], cellsOpen: [], recentTicks: []) — the live producer
 * (synthesizer today, Binance ingest in Task 1.3, Rust worker in
 * Task 1.5) repopulates the cache as soon as the next tick / cell
 * mutation lands. Task 1.5 / 1.7 supply a durable recovery path.
 *
 * Ring policy — fixed pin sizes from the WS schema module so a
 * single edit moves both the wire-budget estimate documented inline
 * in `snapshot.ts` and the cache's actual eviction policy:
 *
 *  - `WS_SNAPSHOT_CELLS_PIN = 120` — most-recent N closed cells.
 *  - `WS_SNAPSHOT_TICKS_PIN  = 200` — most-recent N ticks.
 *
 * Newer entries push out older ones FIFO so the snapshot always
 * carries the right edge of the visible history.
 *
 * Cache hit rate accounting:
 *
 *  - `recordConnect()` is called by the endpoint on every `open`.
 *  - `recordHit()` is called whenever the endpoint actually shipped
 *    a non-empty snapshot from the cache. Empty-snapshot shipments
 *    (cache miss on first-ever connect after restart) DO NOT count
 *    as hits — the metric measures "did the cache actually save the
 *    browser from a synthesise-from-cold round-trip".
 *  - `cacheHitRate()` returns `hits / connects`, or `null` before
 *    the first connect happens.
 */

import {
  WS_SNAPSHOT_CELLS_PIN,
  WS_SNAPSHOT_TICKS_PIN,
  type WSCellClosePayload,
  type WSCellDeltaPayload,
  type WSSnapshotPayload,
  type WSTickPayload,
} from '../schemas/ws';

/**
 * Per-symbol cache record. Mutable for cheap append on every
 * incoming tick / cell event. Caller-side immutability is preserved
 * by `current()` copying the ring arrays before returning.
 */
interface CacheRecord {
  symbol: string;
  currentBarTs: number;
  cells: WSCellClosePayload[];
  cellsOpen: WSCellDeltaPayload[];
  recentTicks: WSTickPayload[];
}

export class SnapshotCache {
  readonly #records = new Map<string, CacheRecord>();
  #connectTotal = 0;
  #hitTotal = 0;

  /**
   * Patch the cache for `symbol`. Each provided field appends and
   * trims to its pin size; absent fields leave the existing ring
   * untouched.
   *
   * `currentBarTs` REPLACES the previous value when supplied — the
   * snapshot always carries the current bar's open timestamp.
   *
   * Mutation semantics are intentional: the cache is a hot-path
   * write surface (synthesizer at 5 Hz, Binance ingest at ~200 Hz),
   * so cloning on every update would burn allocation budget for no
   * correctness win. `current()` clones once at read time, which
   * matches the actual access pattern (~10 reads/min vs ~hundreds
   * of writes/sec).
   */
  update(symbol: string, partial: Partial<WSSnapshotPayload>): void {
    let record = this.#records.get(symbol);
    if (record === undefined) {
      record = {
        symbol,
        currentBarTs: partial.currentBarTs ?? 0,
        cells: [],
        cellsOpen: [],
        recentTicks: [],
      };
      this.#records.set(symbol, record);
    }
    if (partial.currentBarTs !== undefined) {
      record.currentBarTs = partial.currentBarTs;
    }
    if (partial.cells !== undefined) {
      for (const cell of partial.cells) {
        record.cells.push(cell);
      }
      if (record.cells.length > WS_SNAPSHOT_CELLS_PIN) {
        record.cells.splice(0, record.cells.length - WS_SNAPSHOT_CELLS_PIN);
      }
    }
    if (partial.cellsOpen !== undefined) {
      // `cellsOpen` is the open-bar delta tail. On bar close the
      // producer is expected to reset it; we accept any caller
      // policy here (append-only or full replace) by treating the
      // partial as additive, then trimming to the pin.
      for (const open of partial.cellsOpen) {
        record.cellsOpen.push(open);
      }
      if (record.cellsOpen.length > WS_SNAPSHOT_CELLS_PIN) {
        record.cellsOpen.splice(
          0,
          record.cellsOpen.length - WS_SNAPSHOT_CELLS_PIN,
        );
      }
    }
    if (partial.recentTicks !== undefined) {
      for (const tick of partial.recentTicks) {
        record.recentTicks.push(tick);
      }
      if (record.recentTicks.length > WS_SNAPSHOT_TICKS_PIN) {
        record.recentTicks.splice(
          0,
          record.recentTicks.length - WS_SNAPSHOT_TICKS_PIN,
        );
      }
    }
  }

  /**
   * Replace `cellsOpen` outright — used by the producer at bar
   * boundary to clear the delta tail that has been promoted into
   * `cells` as an absolute total.
   */
  resetCellsOpen(symbol: string): void {
    const record = this.#records.get(symbol);
    if (record === undefined) return;
    record.cellsOpen.length = 0;
  }

  /**
   * Returns the current snapshot for `symbol`, or `null` if no
   * producer has ever populated this symbol since process start.
   *
   * Caller receives a defensive copy — mutating the returned arrays
   * does not corrupt the cache. The clone is shallow per-element
   * because the payload values are plain JS records the schema
   * already validates as immutable shapes.
   */
  current(symbol: string): WSSnapshotPayload | null {
    const record = this.#records.get(symbol);
    if (record === undefined) return null;
    return {
      symbol: record.symbol,
      currentBarTs: record.currentBarTs,
      cells: record.cells.slice(),
      cellsOpen: record.cellsOpen.slice(),
      recentTicks: record.recentTicks.slice(),
    };
  }

  recordConnect(): void {
    this.#connectTotal++;
  }

  recordHit(): void {
    this.#hitTotal++;
  }

  /**
   * `hits / connects` since process start. Null before the first
   * connect — distinguishes "no data yet" from "0 % hit rate" which
   * would otherwise both read as 0.
   */
  cacheHitRate(): number | null {
    if (this.#connectTotal === 0) return null;
    return this.#hitTotal / this.#connectTotal;
  }

  get connectTotal(): number {
    return this.#connectTotal;
  }

  get hitTotal(): number {
    return this.#hitTotal;
  }
}

let singleton: SnapshotCache | null = null;

export function getSnapshotCache(): SnapshotCache {
  singleton ??= new SnapshotCache();
  return singleton;
}

export function __resetSnapshotCacheForTests(): void {
  singleton = null;
}
