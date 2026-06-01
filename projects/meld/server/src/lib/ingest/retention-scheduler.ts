/**
 * Inactive-board retention scheduler — Task 1.5 per ADR-003.
 *
 * Two responsibilities in one daily 03:00 UTC sweep:
 *
 *   1. SELECT every `boards.id` where `last_active_at < NOW() - INTERVAL
 *      '${BOARD_RETENTION_DAYS} days'`.
 *   2. For each id, if the Hocuspocus room registry has a live `Document`
 *      for that id, emit a `control.board-deleted` TEXT frame to every
 *      connection in the room (`reason: 'retention-expired'`) and then
 *      close each connection with code 4404 ("board deleted").
 *   3. `DELETE FROM boards WHERE id IN (...)` inside the same transaction.
 *      The FK `ON DELETE CASCADE` on `board_ops.board_id` removes the
 *      associated ops in the same transaction — no separate ops cleanup
 *      pass needed.
 *
 * The full sweep is wrapped in ONE Drizzle transaction. A broadcast error
 * to ONE connection does NOT abort the sweep: we record the per-connection
 * failure on the WS metrics and continue with the remaining ids and the
 * DELETE statement. ADR-003 retention is correctness-critical for the
 * 30-day inactivity contract; a stuck broadcast must not foreclose the
 * delete.
 *
 * Cadence — daily 03:00 UTC:
 *
 *   `setTimeout`-rescheduling pattern verbatim from
 *   `tape-server/src/lib/ingest/retention-scheduler.ts`. On `start()` the
 *   scheduler runs ONE sweep immediately (catches up since last process
 *   boot — a container restart at 04:00 UTC should not skip the 03:00 UTC
 *   sweep that fell into the gap), then arms a `setTimeout` for the next
 *   03:00 UTC. After each fire it re-arms for the next 24 h boundary; the
 *   "run then reschedule" pattern is what keeps the cadence anchored on
 *   the wall clock if a sweep drifts past 03:00 UTC by a few ms.
 *
 *   The 03:00 UTC slot matches tape's choice (low-traffic hour for both
 *   BTC ingest and a portfolio demo).
 *
 * Idempotency:
 *
 *   Re-running mid-day is safe — the SELECT just picks any boards still
 *   over the 30-day threshold. The DELETE is a no-op on an empty id set.
 *
 * Recovery semantics if the transaction fails:
 *
 *   A throw inside the transaction rolls back the DELETE (Drizzle's
 *   `db.transaction(...)` wrapper handles it). The next sweep retries
 *   the same boards. We log the failure but do NOT retry inline — the
 *   bounded-blocking promise is what keeps the boot-sweep from blocking
 *   the listen() call for too long.
 */

import type { Hocuspocus, Connection } from '@hocuspocus/server';
import { sql as dsql } from 'drizzle-orm';

import { getDb } from '../../db';
import { boards } from '../../db/schema';
import { wsBoardDeletedFrameSchema } from '../schemas/ws/board-deleted';
import { wsMetrics } from '../ws/metrics';
import {
  WS_CLOSE_BOARD_DELETED,
  type MeldConnectionContext,
} from '../ws/server';
import { retentionMetrics } from './retention-metrics';

/**
 * Sweep hour, UTC. Verbatim from ADR-003 nightly cadence.
 */
export const RETENTION_SWEEP_HOUR_UTC = 3;

/**
 * Default retention horizon in whole days, per ADR-003. Overridable via
 * the `BOARD_RETENTION_DAYS` env var (parsed inside
 * `createRetentionScheduler` rather than at module load so a `.env`
 * change between test runs is respected without reloading the module).
 */
export const DEFAULT_BOARD_RETENTION_DAYS = 30;

/**
 * One day in milliseconds. Used by the next-fire calculator. Mirrors
 * tape's constant — kept local rather than imported to keep meld
 * self-contained.
 */
export const MS_PER_DAY = 86_400_000;

/**
 * Compute the next 03:00 UTC moment strictly after `now`. Pure function —
 * exposed for unit testing. Deterministic against the calendar via
 * `Date.UTC(year, monthIndex, day, hour)`.
 *
 *   - If `now` is strictly before today's 03:00 UTC → return today's.
 *   - If `now` is at or after today's 03:00 UTC → return tomorrow's.
 *
 * `Date.UTC(... day + 1 ...)` handles end-of-month and end-of-year
 * rollovers natively per spec — `Date.UTC(2026, 11, 32)` returns
 * `2027-01-01`.
 */
export function computeNext3amUtc(now: Date): Date {
  const todayThreeAmMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    RETENTION_SWEEP_HOUR_UTC,
    0,
    0,
    0,
  );
  if (now.getTime() < todayThreeAmMs) {
    return new Date(todayThreeAmMs);
  }
  const tomorrowThreeAmMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    RETENTION_SWEEP_HOUR_UTC,
    0,
    0,
    0,
  );
  return new Date(tomorrowThreeAmMs);
}

/**
 * Read `BOARD_RETENTION_DAYS` from the environment with a sane default.
 * Exposed for tests + the scheduler constructor. Non-numeric values fall
 * back to the default with a warn-level log.
 */
export function readBoardRetentionDaysFromEnv(): number {
  const raw = process.env.BOARD_RETENTION_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_BOARD_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[retention-scheduler] BOARD_RETENTION_DAYS=${raw} is not a positive number — falling back to ${String(DEFAULT_BOARD_RETENTION_DAYS)}`,
    );
    return DEFAULT_BOARD_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}

/**
 * Result of one sweep run. Exposed for the run-now path and for tests.
 *
 *  - `deletedCount` — number of `boards` rows the sweep removed in this
 *                     run. Zero in the happy steady state.
 *  - `emittedCount` — number of `control.board-deleted` TEXT frames the
 *                     sweep successfully sent BEFORE the DELETE. May be
 *                     less than the total connections-on-deleted-boards
 *                     if some sends threw — see `emitFailureCount`.
 *  - `emitFailureCount` — frames that failed to serialise or send
 *                          (socket already closed mid-sweep, send threw).
 */
export interface RetentionSweepResult {
  deletedCount: number;
  emittedCount: number;
  emitFailureCount: number;
}

/**
 * Minimal Hocuspocus surface the sweep relies on. Lets tests inject a
 * stub without constructing a real WS server.
 */
export interface RetentionRoomRegistry {
  /** Mirrors `Hocuspocus.documents.get(boardId)`. */
  getDocument(boardId: string): RetentionDocument | undefined;
}

/**
 * Subset of a Hocuspocus `Document` the sweep touches. We use only the
 * connection iteration + per-connection close — nothing else.
 */
export interface RetentionDocument {
  getConnections(): RetentionConnection[];
}

/**
 * Subset of a Hocuspocus `Connection` the sweep touches.
 */
export interface RetentionConnection {
  /**
   * Underlying `ws` send — passing a string produces a TEXT frame per
   * RFC 6455. ADR-004 TEXT/BINARY split for control frames.
   */
  webSocket: { send(data: string): void };
  /**
   * Hocuspocus's graceful close wrapper. Code 4404 = board deleted per
   * ADR-003 retention sweep / ADR-004 close-code policy.
   */
  close(event?: { code?: number; reason?: string }): void;
}

function wrapHocuspocusRegistry(
  hocuspocus: Hocuspocus<MeldConnectionContext>,
): RetentionRoomRegistry {
  return {
    getDocument(boardId: string): RetentionDocument | undefined {
      const doc = hocuspocus.documents.get(boardId);
      if (!doc) return undefined;
      return {
        getConnections(): RetentionConnection[] {
          return doc.getConnections() as Connection<MeldConnectionContext>[];
        },
      };
    },
  };
}

/**
 * Drizzle-shaped subset the sweep needs — kept small so tests can mock
 * without pulling in real Postgres. Returns the deleted ids so tests can
 * assert the exact set rather than a count.
 */
export interface RetentionDb {
  /**
   * Run the full SELECT + DELETE inside one transaction. The implementor
   * is responsible for the BEGIN/COMMIT envelope; the sweep body is
   * invoked from inside the transaction with `findIds` and `deleteIds`
   * already bound to the transaction handle.
   *
   * The `broadcast` callback runs BETWEEN `findIds` and `deleteIds` —
   * see `runSweepImpl` for the ordering invariant.
   */
  runSweepTransaction<T>(
    body: (tx: RetentionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface RetentionTransaction {
  findInactiveBoardIds(retentionDays: number): Promise<string[]>;
  deleteBoardsById(ids: readonly string[]): Promise<number>;
}

/**
 * Default DB shape — opens a Drizzle transaction and threads `boards`
 * SELECT/DELETE through it.
 */
function defaultRetentionDb(): RetentionDb {
  return {
    async runSweepTransaction(body) {
      const db = getDb();
      return db.transaction(async (tx) => {
        return body({
          async findInactiveBoardIds(retentionDays: number): Promise<string[]> {
            // Parameterising the INTERVAL as a string literal is required
            // — Postgres rejects bound parameters inside an INTERVAL
            // expression. The cast `${retentionDays}::text` is safe
            // because we floor to an integer in
            // `readBoardRetentionDaysFromEnv`.
            const rows = await tx.execute<{ id: string }>(dsql`
              SELECT id::text AS id
              FROM ${boards}
              WHERE last_active_at < NOW() - (${String(retentionDays)} || ' days')::interval
            `);
            // postgres-js returns an iterable-of-objects shape; iterate
            // defensively so a future driver upgrade does not silently
            // change the result row shape.
            const ids: string[] = [];
            for (const row of rows as unknown as Iterable<{ id: string }>) {
              ids.push(row.id);
            }
            return ids;
          },
          async deleteBoardsById(ids: readonly string[]): Promise<number> {
            if (ids.length === 0) return 0;
            // Use a raw IN clause because Drizzle's typed `inArray` would
            // emit per-id parameters; the raw shape is one query
            // round-trip with a single array parameter passed as
            // `text[]::uuid[]`. The cast catches any non-uuid string at
            // the boundary.
            const result = await tx.execute(dsql`
              DELETE FROM ${boards}
              WHERE id = ANY(${ids}::uuid[])
            `);
            // postgres-js exposes a row-count-like `count` field on the
            // result; defensively fall back to the ids length, which is
            // the upper bound.
            const count =
              (result as unknown as { count?: number }).count ?? ids.length;
            return count;
          },
        });
      });
    },
  };
}

/**
 * Hooks the scheduler reaches for. Defaults route through real DB + WS
 * registry; tests inject stubs.
 */
export interface RetentionSchedulerOptions {
  /** DB transaction surface. Defaults to a Drizzle-backed implementation. */
  readonly db?: RetentionDb;
  /** Room registry — defaults to the live Hocuspocus instance below. */
  readonly registry?: RetentionRoomRegistry;
  /**
   * The live Hocuspocus instance. Used to derive the default registry
   * when one is not injected. Tests typically inject `registry` directly
   * and skip this entirely.
   */
  readonly hocuspocus?: Hocuspocus<MeldConnectionContext>;
  /**
   * Retention horizon in whole days. Defaults to
   * `readBoardRetentionDaysFromEnv()`.
   */
  readonly retentionDays?: number;
  /** Test seam — `setTimeout` / `clearTimeout`. */
  readonly scheduler?: TimeoutScheduler;
  /** Test seam — clock source. */
  readonly now?: () => number;
}

export interface TimeoutScheduler {
  setTimeout(handler: () => void, ms: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle): void;
}

export type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

const DEFAULT_TIMEOUT_SCHEDULER: TimeoutScheduler = {
  setTimeout(handler, ms) {
    return globalThis.setTimeout(handler, ms);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  },
};

/**
 * The retention scheduler. One per process — constructed at boot in
 * `src/server.ts` and started after `meldWs.attach(httpServer)`.
 */
export class RetentionScheduler {
  #running = false;
  #timer: TimeoutHandle | null = null;
  #lastSweepAt: number | null = null;
  #lastResult: RetentionSweepResult | null = null;

  readonly #db: RetentionDb;
  readonly #registry: RetentionRoomRegistry | null;
  readonly #retentionDays: number;
  readonly #scheduler: TimeoutScheduler;
  readonly #now: () => number;

  constructor(options: RetentionSchedulerOptions = {}) {
    this.#db = options.db ?? defaultRetentionDb();
    this.#registry =
      options.registry ??
      (options.hocuspocus ? wrapHocuspocusRegistry(options.hocuspocus) : null);
    this.#retentionDays =
      options.retentionDays ?? readBoardRetentionDaysFromEnv();
    this.#scheduler = options.scheduler ?? DEFAULT_TIMEOUT_SCHEDULER;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Idempotent. On first call: runs ONE sweep immediately to catch up
   * since last process boot, then arms the timer for the next 03:00 UTC.
   * Subsequent calls are no-ops.
   *
   * The boot sweep is awaited so the boot wiring in `src/server.ts` can
   * surface a startup-time failure (e.g. DB unreachable) on the listen
   * path rather than at the first 03:00 UTC. Tape's pattern.
   */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.#runSweep();
    this.#scheduleNext();
  }

  /**
   * Cancel the pending timer. Does NOT await an in-flight sweep — the
   * caller awaits a separate flush on the SIGTERM path. A second `stop()`
   * is a no-op.
   */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Force a sweep right now. Exposed for tests and a future ops endpoint;
   * not called by the public boot wiring.
   */
  async runSweepNow(): Promise<RetentionSweepResult> {
    return this.#runSweep();
  }

  /** Wall-clock timestamp (ms) of the last successful sweep. */
  get lastSweepAt(): number | null {
    return this.#lastSweepAt;
  }

  /** Result of the most recent sweep, or null before the first run. */
  get lastResult(): RetentionSweepResult | null {
    return this.#lastResult;
  }

  /** Whether the scheduler timer is armed. */
  get running(): boolean {
    return this.#running;
  }

  /** Effective retention horizon (days). */
  get retentionDays(): number {
    return this.#retentionDays;
  }

  async #runSweep(): Promise<RetentionSweepResult> {
    let result: RetentionSweepResult = {
      deletedCount: 0,
      emittedCount: 0,
      emitFailureCount: 0,
    };
    try {
      result = await runSweepImpl(this.#db, this.#registry, this.#retentionDays);
    } catch (err) {
      console.error('[retention-scheduler] sweep failed:', err);
    }
    this.#lastSweepAt = this.#now();
    this.#lastResult = result;
    retentionMetrics.recordSweep(
      result.deletedCount,
      result.emittedCount,
      this.#lastSweepAt,
    );
    return result;
  }

  #scheduleNext(): void {
    if (!this.#running) return;
    const nowMs = this.#now();
    const nextMs = computeNext3amUtc(new Date(nowMs)).getTime();
    const delayMs = Math.max(1, nextMs - nowMs);
    this.#timer = this.#scheduler.setTimeout(() => {
      void this.#runSweep().finally(() => {
        // "Run then reschedule" — if a sweep drifts past 03:00 UTC, the
        // next fire still anchors on the next 03:00 UTC, not on
        // now+24h.
        this.#scheduleNext();
      });
    }, delayMs);
  }
}

/**
 * The full sweep body — SELECT → broadcast → CLOSE → DELETE — wrapped in
 * one transaction. Pure helper exposed for tests; takes a DB + registry
 * and returns a structured result.
 *
 * Order of operations (load-bearing):
 *
 *   1. Open transaction.
 *   2. SELECT the inactive board ids.
 *   3. For each id, look up the live Hocuspocus `Document`; if present
 *      iterate connections and (a) emit `control.board-deleted` TEXT
 *      frame, (b) close with code 4404. A per-connection broadcast
 *      failure increments `emitFailureCount` and the sweep continues —
 *      it does NOT abort.
 *   4. DELETE the boards by id (cascade removes board_ops).
 *   5. Commit.
 *
 * The broadcast happens BEFORE the DELETE so the client receives the
 * control frame on a still-existing board row (matters only for client
 * UX consistency — the cascade does not race the broadcast because both
 * are inside the transaction envelope from Postgres's perspective).
 */
export async function runSweepImpl(
  db: RetentionDb,
  registry: RetentionRoomRegistry | null,
  retentionDays: number,
): Promise<RetentionSweepResult> {
  return db.runSweepTransaction(async (tx) => {
    const ids = await tx.findInactiveBoardIds(retentionDays);
    if (ids.length === 0) {
      return { deletedCount: 0, emittedCount: 0, emitFailureCount: 0 };
    }
    let emittedCount = 0;
    let emitFailureCount = 0;
    if (registry !== null) {
      for (const id of ids) {
        const doc = registry.getDocument(id);
        if (!doc) continue;
        const connections = doc.getConnections();
        for (const connection of connections) {
          const sent = emitBoardDeletedFrame(connection, id);
          if (sent) {
            emittedCount += 1;
          } else {
            emitFailureCount += 1;
          }
          // Close after the (best-effort) send. Code 4404 = board
          // deleted per ADR-003 / ADR-004 close-code policy.
          try {
            connection.close({
              code: WS_CLOSE_BOARD_DELETED,
              reason: 'retention-expired',
            });
          } catch (err) {
            console.warn(
              '[retention-scheduler] connection close threw:',
              err,
            );
          }
        }
      }
    }
    const deletedCount = await tx.deleteBoardsById(ids);
    return { deletedCount, emittedCount, emitFailureCount };
  });
}

/**
 * Build + validate + send the `control.board-deleted` TEXT frame to a
 * single connection. Returns true on a successful send, false on any
 * failure (Zod parse, JSON.stringify, socket throw). Failures are logged
 * and recorded on `wsMetrics.controlFramesDropped` — they NEVER throw out
 * of the sweep.
 */
function emitBoardDeletedFrame(
  connection: RetentionConnection,
  boardId: string,
): boolean {
  let payload: string;
  try {
    const parsed = wsBoardDeletedFrameSchema.parse({
      kind: 'control.board-deleted',
      boardId,
      reason: 'retention-expired',
    });
    payload = JSON.stringify(parsed);
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error(
      '[retention-scheduler] board-deleted frame build failed:',
      err,
    );
    return false;
  }
  try {
    connection.webSocket.send(payload);
    wsMetrics.recordControlFrameOut();
    return true;
  } catch (err) {
    wsMetrics.recordControlFrameDropped();
    console.error(
      '[retention-scheduler] board-deleted frame send failed:',
      err,
    );
    return false;
  }
}

/**
 * Process-singleton accessor. Constructed lazily so tests that import
 * the module without booting the scheduler do not trigger DB resolution.
 * Production callers (boot wiring in `src/server.ts`) pass the live
 * Hocuspocus instance once and reuse.
 */
let singleton: RetentionScheduler | null = null;

export function getRetentionScheduler(
  hocuspocus?: Hocuspocus<MeldConnectionContext>,
): RetentionScheduler {
  // `exactOptionalPropertyTypes: true` rejects passing `undefined`
  // through to a non-undefinable optional, so only spread the option
  // when the caller actually provided one.
  singleton ??=
    hocuspocus === undefined
      ? new RetentionScheduler()
      : new RetentionScheduler({ hocuspocus });
  return singleton;
}

/**
 * Test-only reset hook. Mirrors tape's pattern.
 */
export function __resetRetentionSchedulerSingletonForTests(): void {
  singleton = null;
}
