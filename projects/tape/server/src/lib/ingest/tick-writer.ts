/**
 * Tick ingest writer — Task 1.2b per ADR-005.
 *
 * Bridges the live Binance ingest path (Task 1.3, not yet implemented) to
 * the persisted `ticks` archive. The writer owns a bounded ring buffer of
 * pending tick rows and flushes them in batches via Postgres
 * `COPY ticks (...) FROM STDIN` on a 50 ms coalescing window — both
 * numbers verbatim from ADR-005 § "Decision" and § "Backend-engineer
 * tasks dropped into Phase 1".
 *
 * Why this exists separately from the Rust worker (architectural):
 *
 *   ADR-005 § "Write path" decoupled tick archival from worker
 *   availability on purpose. A worker crash-loop must not block the tick
 *   archive, and the tick archive must remain usable for cold-replay even
 *   while the worker is unhealthy. Elysia owns the writer; the worker
 *   only consumes ticks for aggregation, never for persistence.
 *
 * Drop-policy contrast with the public WS (ADR-006):
 *
 *   The public WebSocket fan-out (Task 1.6b) drops oldest ticks AND
 *   coalesces cell deltas on its per-client send queue. Both policies
 *   serve the same goal — never block the producer — but the DB ingest
 *   path can only drop, never coalesce: a tick row is a write-once
 *   atom, there is no "merge two ticks into one tick" operation. A tick
 *   lost from persistence is acceptable in v1 because (a) the worker's
 *   in-memory cell aggregation still consumes every tick, so the live
 *   chart stays correct; (b) the replay scan still serves whatever was
 *   persisted; (c) the loss only happens under sustained ingest above
 *   the DB's COPY throughput ceiling, which is far above the 200 ticks/s
 *   steady-state target.
 *
 * Failure-mode handling (ADR-005 § Negative point 1):
 *
 *   On a partition-missing error during the COPY (the "create-ahead
 *   loop fell behind" case), the writer calls `ensureRollingPartitions`
 *   once and retries the batch. This is the paranoia path — in steady
 *   state, the boot bootstrap plus the daily 03:00 UTC sweep keep two
 *   months of forward partitions, so the retry should never fire. A
 *   structured-log alert distinguishes "retry path was needed" from
 *   the nominal case.
 *
 * Lifecycle:
 *
 *   - `start()` opens the coalescing timer and is idempotent (calling
 *     twice is a no-op). Requires `DATABASE_URL` to be set — fails fast
 *     on the runtime path even though `/health.db` tolerates a missing
 *     env var.
 *   - `enqueue(row)` is non-blocking, synchronous, and never throws on
 *     ring overflow — overflow drops the oldest row and increments
 *     `dropTotal`.
 *   - `stop()` clears the timer and performs one final flush. Safe to
 *     call from a SIGTERM handler (does not throw on a transient DB
 *     error during the final drain — the error is structured-logged and
 *     the buffer is cleared regardless).
 *
 * Metrics (read by `/health.db`):
 *
 *   - `flushCount` — cumulative successful flushes since process start.
 *     Exposed as `tickBatchFlushCount` on `/health.db`. A flush counts
 *     as one even if it carries multiple ticks; a flush is not counted
 *     if the ring was empty (no work done).
 *   - `dropTotal` — cumulative drop-oldest invocations since process
 *     start. Not currently exposed on `/health.db` (deferred until
 *     a real incident surfaces the need).
 */

import { getSql } from '../../db';
import { ensureRollingPartitions } from '../../db/partitions';
import type { Tick } from '../../db/schema/ticks';

/**
 * Maximum number of pending tick rows the ring buffer holds before
 * drop-oldest kicks in. Verbatim from ADR-005 § "Decision" — a 500-tick
 * cap covers ~2.5 s of sustained 200 ticks/s ingest, which is plenty of
 * headroom against the 50 ms coalescing window and small enough that a
 * full ring serialised into a COPY payload stays well under any single-
 * frame memory budget.
 */
export const TICK_BATCH_RING_CAP = 500;

/**
 * Coalescing window in milliseconds. Verbatim from ADR-005 § "Decision":
 * the writer wakes at most every 50 ms; if the ring is non-empty, the
 * whole ring is flushed in one transaction. This matches the bridge's
 * coalescing cadence from ADR-003 / ADR-002 so the two pipelines stay
 * on the same mental model.
 */
export const TICK_BATCH_WINDOW_MS = 50;

/**
 * Row shape the writer accepts. The order matches the Drizzle `ticks`
 * column order (`ts_ms, symbol, price, qty, aggressor, session_id`) so
 * the COPY payload builder below can read the fields in declaration
 * order without a per-row mapping table. The `Tick` row type from the
 * schema barrel is the source of truth — narrow to the `NewTick` shape
 * locally because Drizzle's `$inferInsert` and `$inferSelect` happen to
 * coincide for this table (all columns are NOT NULL, no defaults
 * besides the implicit PK composite).
 */
export type TickRow = Tick;

/**
 * Structural surface the writer needs from postgres-js. Re-declared as a
 * narrow interface so the unit test can pass a mock without pulling in
 * the full `Sql` type from postgres-js (which carries the parametric
 * tagged-template surface and is awkward to mock).
 *
 * postgres-js's COPY surface returns a Node `Writable` after the
 * `.writable()` await; we model only the methods the writer touches
 * (write, end, error events).
 */
export interface CopyWritable {
  /**
   * Write a chunk to the COPY stream. Returns `false` if backpressure
   * applies; the writer drains via the `drain` event before the next
   * write.
   */
  write(chunk: Buffer | string): boolean;
  /**
   * End the COPY stream. The returned Promise resolves on Postgres
   * acknowledgement (CommandComplete), rejects on a stream error.
   */
  end(): Promise<void> | void;
  on(event: 'drain' | 'error' | 'finish', listener: (...args: unknown[]) => void): void;
  once(event: 'drain' | 'error' | 'finish', listener: (...args: unknown[]) => void): void;
}

/**
 * Hook the writer reaches for to obtain a COPY writable stream. Default
 * implementation uses the global `getSql()` (postgres-js — exposes the
 * COPY surface via the tagged-template path
 * `await sql\`copy ticks (...) from stdin\`.writable()`); tests inject
 * an alternative via `TickWriterOptions.openCopyStream`.
 */
export type OpenCopyStream = () => Promise<CopyWritable>;

/**
 * Hook the writer reaches for to recover from a missing-partition error.
 * Defaults to the real `ensureRollingPartitions` from the partition
 * module; tests inject a stub.
 */
export type EnsurePartitions = (lookaheadMonths?: number) => Promise<void>;

export interface TickWriterOptions {
  readonly ringCap?: number;
  readonly windowMs?: number;
  readonly openCopyStream?: OpenCopyStream;
  readonly ensurePartitions?: EnsurePartitions;
  /**
   * Test seam: override the wall-clock-tick scheduler. Defaults to
   * `setInterval` / `clearInterval` from `globalThis`. Tests pass a
   * deterministic scheduler so the 50 ms window does not actually
   * sleep.
   */
  readonly scheduler?: TickScheduler;
}

/**
 * Minimal `setInterval`-style surface so unit tests can drive the
 * coalescing window deterministically without `await sleep(50)`.
 */
export interface TickScheduler {
  setInterval(handler: () => void, ms: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

export type IntervalHandle = ReturnType<typeof globalThis.setInterval>;

const DEFAULT_SCHEDULER: TickScheduler = {
  setInterval(handler, ms) {
    return globalThis.setInterval(handler, ms);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle);
  },
};

/**
 * Test seam for the partition-missing error pattern. Real postgres-js
 * surfaces partition routing failures as PostgreSQL error code 23514
 * ("check_violation") or 0A000 ("feature_not_supported") depending on
 * the exact wording; the substring match here is intentionally broad
 * because the error message is the most stable surface across pg
 * versions (codes occasionally shift). The retry path runs at most once
 * per flush, so a false positive only costs one extra
 * `ensureRollingPartitions` call (which is itself idempotent).
 */
export function isPartitionMissingError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err);
  return /no partition of relation/i.test(message);
}

/**
 * One TickWriter per process. The boot wiring in `src/server.ts`
 * constructs the singleton at module scope and `start()`s it once
 * `DATABASE_URL` is verified present.
 */
export class TickWriter {
  readonly ringCap: number;
  readonly windowMs: number;

  #ring: TickRow[] = [];
  #dropTotal = 0;
  #flushCount = 0;
  #running = false;
  #flushInFlight = false;
  #timer: IntervalHandle | null = null;
  readonly #scheduler: TickScheduler;
  readonly #openCopyStream: OpenCopyStream;
  readonly #ensurePartitions: EnsurePartitions;

  constructor(options: TickWriterOptions = {}) {
    this.ringCap = options.ringCap ?? TICK_BATCH_RING_CAP;
    this.windowMs = options.windowMs ?? TICK_BATCH_WINDOW_MS;
    this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.#openCopyStream = options.openCopyStream ?? defaultOpenCopyStream;
    this.#ensurePartitions =
      options.ensurePartitions ?? ensureRollingPartitions;
  }

  /**
   * Open the coalescing timer. Idempotent — repeat calls are a no-op.
   * Does NOT verify `DATABASE_URL` here — the call comes from
   * `src/server.ts` which fail-fasts on missing env per ADR-005.
   */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timer = this.#scheduler.setInterval(() => {
      void this.#flush();
    }, this.windowMs);
  }

  /**
   * Stop the coalescing timer and drain the ring one last time.
   * Tolerant against a transient DB error during the final drain — the
   * error is structured-logged and the ring is cleared regardless, so
   * a SIGTERM handler does not hang on a stuck DB.
   */
  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timer !== null) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = null;
    }
    try {
      await this.#flush();
    } catch (err) {
      console.error('[tick-writer] final flush failed:', err);
      this.#ring = [];
    }
  }

  /**
   * Non-blocking enqueue. On ring overflow, drops the OLDEST tick (a
   * shift) and increments `dropTotal`. Returns synchronously so the
   * ingest path stays decoupled from DB latency.
   */
  enqueue(row: TickRow): void {
    if (this.#ring.length >= this.ringCap) {
      this.#ring.shift();
      this.#dropTotal += 1;
    }
    this.#ring.push(row);
  }

  /**
   * Cumulative drop-oldest count since process start. Public for tests
   * and for a future ops dashboard.
   */
  get dropTotal(): number {
    return this.#dropTotal;
  }

  /**
   * Cumulative successful flushes since process start. Read by
   * `/health.db.tickBatchFlushCount`. A flush counts as one even if it
   * carries multiple ticks; a flush is not counted if the ring was
   * empty (no work done).
   */
  get flushCount(): number {
    return this.#flushCount;
  }

  /**
   * Current pending count. Public for tests; not exposed on `/health`
   * (the cap is small enough that the ring depth is uninteresting).
   */
  get pendingCount(): number {
    return this.#ring.length;
  }

  /**
   * Whether the coalescing timer is running. Public for tests.
   */
  get running(): boolean {
    return this.#running;
  }

  /**
   * Force a flush right now. The coalescing timer also calls this
   * internally; the public surface lets tests skip the timer.
   *
   * Internally re-entrant against itself — if a flush is already in
   * flight, additional `flushNow()` calls return immediately. This
   * matters because the timer fires every 50 ms regardless of whether
   * the previous flush has completed; without the guard, a slow DB
   * could stack overlapping COPY streams on the same connection.
   */
  async flushNow(): Promise<void> {
    await this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#flushInFlight) return;
    if (this.#ring.length === 0) return;
    this.#flushInFlight = true;
    // Snapshot the ring and clear it. Any tick enqueued during the
    // COPY round-trip lands in the next flush — keeps the writer
    // simple and avoids the "buffer-of-buffers" anti-pattern.
    const batch = this.#ring;
    this.#ring = [];
    try {
      await this.#copyBatch(batch);
      this.#flushCount += 1;
    } catch (err) {
      if (isPartitionMissingError(err)) {
        // Paranoia path: the create-ahead loop fell behind. Run the
        // bootstrap once, then retry the same batch. ADR-005 § Negative
        // point 1 documents this as a known one-shot recovery — log
        // loudly so a sustained occurrence surfaces.
        console.warn(
          '[tick-writer] partition missing during COPY, recovering via ensureRollingPartitions:',
          err,
        );
        try {
          await this.#ensurePartitions(2);
          await this.#copyBatch(batch);
          this.#flushCount += 1;
        } catch (retryErr) {
          // Re-throw so an outer handler sees the persistent failure.
          // The batch is already dropped from the ring — a second
          // retry would loop the same batch indefinitely.
          console.error(
            '[tick-writer] partition recovery retry failed, batch dropped:',
            retryErr,
          );
        }
      } else {
        console.error('[tick-writer] flush failed, batch dropped:', err);
      }
    } finally {
      this.#flushInFlight = false;
    }
  }

  async #copyBatch(batch: readonly TickRow[]): Promise<void> {
    if (batch.length === 0) return;
    const writable = await this.#openCopyStream();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onError = (err: unknown): void => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      writable.once('error', onError);
      writable.once('finish', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      // Build the payload synchronously — at 500 rows × ~80 bytes the
      // total stays under ~40 KB which is well under any reasonable
      // single-chunk write budget. The Postgres COPY text format wants
      // tab-separated columns and \n-terminated rows, NULL as \N.
      // We have no NULLs in `ticks` (every column is NOT NULL), so the
      // serializer is straight-line.
      const payload = serializeBatchToCopyText(batch);
      const ok = writable.write(payload);
      const finalize = (): void => {
        Promise.resolve(writable.end()).catch(onError);
      };
      if (ok) {
        finalize();
      } else {
        writable.once('drain', finalize);
      }
    });
  }
}

/**
 * Build the `COPY ticks FROM STDIN` text payload for one batch.
 *
 * Column order: `ts_ms, symbol, price, qty, aggressor, session_id`.
 * Matches both the Drizzle table declaration and the COPY column list
 * in `defaultOpenCopyStream` below. Tab-separated; \n-terminated rows;
 * no escaping needed for our column set (text fields are constrained
 * to `'buy' | 'sell'` for `aggressor` and Binance-emitted symbol
 * strings for `symbol` — neither contains tab or newline; uuid strings
 * for `session_id` are ASCII hex with dashes).
 *
 * Exported for unit testing only.
 */
export function serializeBatchToCopyText(batch: readonly TickRow[]): string {
  // Pre-size the buffer roughly to avoid repeated allocator growth.
  // 80 bytes per row is a generous upper bound at our shape. `for-of`
  // sidesteps the noUncheckedIndexedAccess hazard a numeric loop would
  // hit (`batch[i]` would be `TickRow | undefined` even when bounds-
  // checked) without a non-null assertion.
  const parts: string[] = [];
  for (const row of batch) {
    parts.push(
      `${String(row.tsMs)}\t${row.symbol}\t${String(row.price)}\t${String(row.qty)}\t${row.aggressor}\t${row.sessionId}\n`,
    );
  }
  return parts.join('');
}

/**
 * Default copy-stream opener — uses the process-singleton postgres-js
 * client. Lifted out so the constructor can swap it for a mock without
 * pulling in `getSql` into test setup.
 *
 * Column list MUST match `serializeBatchToCopyText` in order.
 */
async function defaultOpenCopyStream(): Promise<CopyWritable> {
  const sql = getSql();
  // postgres-js exposes COPY as a tagged-template surface: the leading
  // template produces a Query whose `.writable()` returns a Node
  // Writable wired to the server's COPY stream. The column list pins
  // the order so the text payload aligns positionally.
  const query = sql`copy ticks (ts_ms, symbol, price, qty, aggressor, session_id) from stdin`;
  // The return type from postgres-js is a Node Writable; the narrow
  // `CopyWritable` shape above models the methods the writer actually
  // touches.
  return (await (query as unknown as { writable(): Promise<CopyWritable> }).writable());
}

/**
 * Process-singleton accessor. The boot wiring in `src/server.ts` reaches
 * for this, never constructs a TickWriter directly — keeps the lifecycle
 * single-instance and the `/health.db` reader honest.
 */
let singleton: TickWriter | null = null;

export function getTickWriter(): TickWriter {
  singleton ??= new TickWriter();
  return singleton;
}

/**
 * Test-only reset hook. Clears the singleton so a fresh TickWriter is
 * constructed on the next `getTickWriter()` call. Not exported from the
 * public boundary — tests import this module directly.
 */
export function __resetTickWriterSingletonForTests(): void {
  singleton = null;
}

