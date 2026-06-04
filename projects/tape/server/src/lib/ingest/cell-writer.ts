/**
 * Footprint-cell writer — Task 1.5f per ADR-005 (implementation note: the
 * write lives in the Elysia control plane, not the Rust worker — see the
 * "Where the write lives" docblock below and AGENT_NOTES for the ADR-005
 * deviation rationale).
 *
 * Closes the footprint_cells persistence gap. The live
 * `synth -> worker` (and `Binance -> worker`) pipeline produces
 * `cell.close` frames that, before this module, flowed to the WS
 * broadcast ONLY and were never persisted. The replay endpoint (Task
 * 1.7) therefore had no data to serve off a live session, and ADR-004's
 * recovery ("rebuild the current bar from closed bars in Postgres") had
 * no closed bars to read. This writer is the missing WRITE path.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Where the write lives (ADR-005 implementation note)
 * ─────────────────────────────────────────────────────────────────────
 *
 * ADR-005 § "Decision" says "Cells written by the Rust worker on
 * bar-close, one transaction per bar". This module places that write in
 * the Elysia `WorkerPipeline` instead, for three reasons that honour
 * ADR-005's INTENT ("closed-bar history in Postgres is the durable
 * source of truth") while deviating from its LETTER ("the worker
 * writes"):
 *
 *   1. The `WorkerPipeline` already receives every `cell.close` frame
 *      (it promotes them to the public WS envelope). The data is already
 *      here — no new wire, no new DB client.
 *   2. The TS-side DB layer (`getDb()`, the Drizzle `footprintCells`
 *      schema) and the write-discipline precedent (`tickWriter`'s
 *      enqueue + coalesced flush + tolerate-transient-DB-errors pattern)
 *      already live in Elysia. Mirroring them keeps ONE write discipline
 *      in the codebase.
 *   3. Keeping the worker pure-compute (no Postgres client, no
 *      DATABASE_URL, no second connection-management surface in Rust) is
 *      the cleaner separation of concerns and matches how `ticks` are
 *      already written (Elysia direct, ADR-005 § "Write path").
 *
 * The `cell.close` frame already carries the absolute totals
 * (`bid_volume` / `ask_volume` / `trades`), so the Elysia side has
 * everything it needs to write the authoritative row. This is flagged in
 * AGENT_NOTES as an ADR-005 implementation note for the main thread to
 * optionally ratify as a micro-ADR.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Idempotency / transaction contract
 * ─────────────────────────────────────────────────────────────────────
 *
 *  - **One transaction per bar.** All price levels of a single closed
 *    bar (same `bucket_ts`) are written in ONE `db.transaction(...)`,
 *    per ADR-005's "one transaction per bar" requirement.
 *  - **Upsert, not insert.** Each row is written via
 *    `INSERT ... ON CONFLICT (symbol, bucket_ts, price_bucket) DO UPDATE`
 *    using the existing composite PK. A re-emitted close (worker restart
 *    drain, recovery replay) overwrites with the same absolute totals
 *    rather than duplicating or erroring. The write is therefore
 *    idempotent: applying the same closed bar twice yields the same rows.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Decoupled from the hot path (tickWriter discipline)
 * ─────────────────────────────────────────────────────────────────────
 *
 *  - `enqueueClose(...)` is synchronous and never throws — it only
 *    appends to an in-memory per-bar buffer. The WS broadcast and the
 *    bridge read loop are never blocked by a DB round-trip.
 *  - The actual DB write happens off the enqueue path: when a bar
 *    boundary is detected (a `cell.close` for a NEWER `bucket_ts`
 *    arrives), the now-complete bar is handed to an async flush that the
 *    caller does not await. A DB outage degrades persistence (the bar is
 *    logged and dropped after one failed attempt) but never crashes the
 *    pipeline or stalls the live board.
 *  - On `DATABASE_URL` absent, the writer no-ops the DB work (logged
 *    once) — consistent with the rest of the server: the live board
 *    still works, persistence is best-effort.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Bar-boundary detection
 * ─────────────────────────────────────────────────────────────────────
 *
 * The Rust worker emits all expired cells of a bar CONTIGUOUSLY, sorted
 * by `(symbol, bucket_ts, price_bucket)` (worker `close_expired_with_cvd`
 * — deterministic drain order). So a stream of `cell.close` frames looks
 * like:
 *
 *   close(bar=A, p=10) close(bar=A, p=11) close(bar=A, p=12)
 *   close(bar=B, p=9)  close(bar=B, p=10) ...
 *
 * We buffer cells for the current `(symbol, bucket_ts)` open bar; when a
 * close arrives whose `bucket_ts` differs from the buffered one (or whose
 * symbol differs), the buffered bar is COMPLETE — flush it atomically and
 * start a fresh buffer. `flushPending()` (called on pipeline stop /
 * worker drain) flushes whatever bar is still buffered.
 *
 * Edge case — a single bar's cells split across two worker sweeps with
 * the same `bucket_ts`: this never duplicates because the second sweep's
 * close frames carry the SAME `bucket_ts`, land in the same buffer, and
 * the upsert overwrites. (In practice a 1-min bar closes in a single
 * sweep; the upsert is the belt-and-braces guarantee.)
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { footprintCells } from '../../db/schema/footprint-cells';

/**
 * One closed-cell record handed to the writer. Mirrors the bridge
 * `CellClose` payload after the pipeline has coerced its bigints to
 * `number` (the pipeline already does this coercion at the bridge
 * boundary). `sessionId` is resolved by the pipeline at enqueue time
 * from the active ingest session.
 */
export interface ClosedCell {
  readonly symbol: string;
  readonly bucketTs: number;
  readonly priceBucket: number;
  readonly bidVolume: number;
  readonly askVolume: number;
  readonly trades: number;
  readonly sessionId: string;
}

/**
 * The Drizzle handle surface the writer needs. Narrowed to an interface
 * so the unit test can inject a mock without standing up a live
 * Postgres. The real implementation is `getDb()` (postgres-js + Drizzle).
 *
 * `transaction` runs `fn` inside a single DB transaction and resolves
 * with its result; a throw inside `fn` rolls the transaction back and
 * rejects. `insertBar` performs the per-row upsert for one bar's cells.
 */
export interface CellWriterDb {
  transaction<T>(fn: (tx: CellWriterTx) => Promise<T>): Promise<T>;
}

/** Transaction-scoped surface the bar flush uses. */
export interface CellWriterTx {
  upsertCells(rows: readonly ClosedCell[]): Promise<void>;
}

/**
 * Hook the writer reaches for to obtain a DB handle. Defaults to the
 * Drizzle-backed implementation below; tests inject a mock.
 */
export type OpenCellWriterDb = () => CellWriterDb;

export interface CellWriterOptions {
  /** Test seam — defaults to the Drizzle-backed `defaultOpenCellWriterDb`. */
  readonly openDb?: OpenCellWriterDb;
  /**
   * Test seam — override the "is DATABASE_URL present" probe. Defaults
   * to reading `process.env.DATABASE_URL`. Lets a unit test exercise the
   * DB-absent tolerance path without unsetting the real env var.
   */
  readonly hasDatabaseUrl?: () => boolean;
}

/** A bar accumulating in memory: a key plus its price-level cells. */
interface OpenBar {
  symbol: string;
  bucketTs: number;
  cells: ClosedCell[];
}

export class CellWriter {
  readonly #openDb: OpenCellWriterDb;
  readonly #hasDatabaseUrl: () => boolean;

  /** The bar currently accumulating close frames, or null between bars. */
  #openBar: OpenBar | null = null;
  /** In-flight async flushes — awaited by `flushPending()` on stop. */
  readonly #inFlight = new Set<Promise<void>>();

  #barsWritten = 0;
  #cellsWritten = 0;
  #writeErrors = 0;
  #dbAbsentLogged = false;

  constructor(options: CellWriterOptions = {}) {
    this.#openDb = options.openDb ?? defaultOpenCellWriterDb;
    this.#hasDatabaseUrl =
      options.hasDatabaseUrl ?? (() => Boolean(process.env.DATABASE_URL));
  }

  /**
   * Enqueue one closed cell. Synchronous, never throws. Detects the bar
   * boundary: when a cell arrives for a DIFFERENT `(symbol, bucketTs)`
   * than the buffered bar, the buffered bar is complete and is flushed
   * (fire-and-forget) before the new bar starts buffering.
   *
   * No-op on the DB work when `DATABASE_URL` is absent — the cell is
   * still buffered/boundary-tracked so metrics stay coherent, but the
   * flush short-circuits (logged once). This keeps the live board
   * working with persistence best-effort.
   */
  enqueueClose(cell: ClosedCell): void {
    const open = this.#openBar;
    if (
      open !== null &&
      (open.symbol !== cell.symbol || open.bucketTs !== cell.bucketTs)
    ) {
      // Boundary: the buffered bar is complete. Flush it, then start a
      // fresh buffer for the incoming bar.
      this.#flushBar(open);
      this.#openBar = null;
    }
    if (this.#openBar === null) {
      this.#openBar = {
        symbol: cell.symbol,
        bucketTs: cell.bucketTs,
        cells: [],
      };
    }
    this.#openBar.cells.push(cell);
  }

  /**
   * Flush whatever bar is currently buffered (if any) and await all
   * in-flight bar writes. Called on pipeline stop / worker drain so the
   * last open bar's cells are not lost. Tolerant — a transient DB error
   * during the final flush is logged, not thrown, so a SIGTERM handler
   * does not hang.
   */
  async flushPending(): Promise<void> {
    if (this.#openBar !== null) {
      this.#flushBar(this.#openBar);
      this.#openBar = null;
    }
    // Snapshot — `#flushBar` mutates the set as promises settle.
    await Promise.allSettled([...this.#inFlight]);
  }

  /** Total bars successfully written since construction. */
  get barsWritten(): number {
    return this.#barsWritten;
  }

  /** Total cell rows successfully upserted since construction. */
  get cellsWritten(): number {
    return this.#cellsWritten;
  }

  /** Total bar-flush failures since construction (each is one bar dropped). */
  get writeErrors(): number {
    return this.#writeErrors;
  }

  /**
   * Hand one complete bar to an async upsert. Fire-and-forget: the
   * returned promise is tracked in `#inFlight` so `flushPending()` can
   * await it, but the enqueue path never blocks on it.
   */
  #flushBar(bar: OpenBar): void {
    if (bar.cells.length === 0) return;

    if (!this.#hasDatabaseUrl()) {
      if (!this.#dbAbsentLogged) {
        console.warn(
          '[cell-writer] DATABASE_URL absent — footprint_cells persistence is OFF (best-effort). The live board is unaffected.',
        );
        this.#dbAbsentLogged = true;
      }
      return;
    }

    const rows = bar.cells;
    const promise = this.#upsertBar(rows)
      .then(() => {
        this.#barsWritten += 1;
        this.#cellsWritten += rows.length;
      })
      .catch((err: unknown) => {
        this.#writeErrors += 1;
        // Degrade persistence, never crash the pipeline. One bar is lost;
        // the live board and the closed bars already persisted are fine.
        console.error(
          `[cell-writer] failed to persist bar (symbol=${bar.symbol} bucketTs=${String(
            bar.bucketTs,
          )} cells=${String(rows.length)}):`,
          err,
        );
      })
      .finally(() => {
        this.#inFlight.delete(promise);
      });
    this.#inFlight.add(promise);
  }

  /** Run the per-bar upsert inside one transaction (ADR-005 contract). */
  async #upsertBar(rows: readonly ClosedCell[]): Promise<void> {
    const db = this.#openDb();
    await db.transaction(async (tx) => {
      await tx.upsertCells(rows);
    });
  }
}

/**
 * Default Drizzle-backed DB surface. Wraps `getDb()` so the writer's
 * transaction + upsert calls hit real Postgres. Separated from the
 * class so the constructor can swap it for a mock in tests without
 * importing `getDb`.
 */
function defaultOpenCellWriterDb(): CellWriterDb {
  const db = getDb();
  return {
    async transaction<T>(fn: (tx: CellWriterTx) => Promise<T>): Promise<T> {
      return db.transaction(async (drizzleTx) => {
        const tx: CellWriterTx = {
          async upsertCells(rows: readonly ClosedCell[]): Promise<void> {
            if (rows.length === 0) return;
            await drizzleTx
              .insert(footprintCells)
              .values(
                rows.map((c) => ({
                  symbol: c.symbol,
                  bucketTs: c.bucketTs,
                  priceBucket: c.priceBucket,
                  bidVolume: c.bidVolume,
                  askVolume: c.askVolume,
                  trades: c.trades,
                  sessionId: c.sessionId,
                })),
              )
              // Idempotent upsert on the composite PK. A re-emitted or
              // recovery-replayed close overwrites with the same absolute
              // totals rather than duplicating (the PK already exists).
              .onConflictDoUpdate({
                target: [
                  footprintCells.symbol,
                  footprintCells.bucketTs,
                  footprintCells.priceBucket,
                ],
                set: {
                  bidVolume: sql`excluded.bid_volume`,
                  askVolume: sql`excluded.ask_volume`,
                  trades: sql`excluded.trades`,
                  sessionId: sql`excluded.session_id`,
                },
              });
          },
        };
        return fn(tx);
      });
    },
  };
}

let singleton: CellWriter | null = null;

/** Process-singleton accessor — mirrors `getTickWriter`. */
export function getCellWriter(): CellWriter {
  singleton ??= new CellWriter();
  return singleton;
}

/** Test-only reset. Not exported from the public barrel. */
export function __resetCellWriterForTests(): void {
  singleton = null;
}
