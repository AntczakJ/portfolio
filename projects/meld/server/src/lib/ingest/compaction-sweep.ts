/**
 * Periodic snapshot-chain compaction trigger sweep — Task 1.5 per ADR-003.
 *
 * Walks every Hocuspocus room currently in memory and, for any room
 * whose un-flushed ops count exceeds the threshold, triggers an
 * out-of-debounce snapshot flush via Hocuspocus's
 * `instance.storeDocumentHooks(document, payload, true)` early-flush
 * path. The actual compaction (snapshot UPSERT + ops DELETE inside one
 * transaction) lives in Task 1.3's Storage extension; this sweep only
 * TRIGGERS it. The framework's per-document `saveMutex` serialises
 * concurrent flushes on the same room, so an early-flush triggered here
 * cannot race with the debounce-driven flush.
 *
 * Cadence — every 6 hours:
 *
 *   ADR-003 named hourly as the upper bound for the compaction cadence;
 *   ADR-003's "1000-ops threshold" half is enforced in-line in the
 *   Storage adapter (Task 1.3's 100-ops early-flush trigger is the
 *   tighter sibling). The 6-hour sweep is a backstop for the rare case
 *   where a board accumulates ops without ever crossing the in-adapter
 *   threshold (a hand-rolled writer that streams updates at < 100/hour).
 *   v1 demo traffic does not hit this; the sweep keeps the contract
 *   intact for v1.1's load profile.
 *
 *   `setInterval` is the right primitive here (NOT `setTimeout`-
 *   rescheduling): the cadence is a fixed rolling 6 h window, not a
 *   wall-clock-anchored 03:00 UTC slot, so missing one fire by a few
 *   seconds is acceptable.
 *
 * Threshold — 100 un-flushed ops per room:
 *
 *   ADR-003 names 1000 as the per-board compaction-trigger threshold for
 *   the background sweep, and 100 for the in-adapter early-flush
 *   counter (Task 1.3). v1 uses 100 here too because (a) the Storage
 *   adapter already debounces snapshots at 5 s idle / 30 s ceiling, so
 *   most ops chains shorter than 100 between snapshots are coalesced
 *   inside the framework's own debounce, and (b) the sweep is a backstop
 *   for rooms that fall outside the framework's debounce window — at
 *   that point even 100 ops is "old enough to deserve a flush" from a
 *   cold-start-latency standpoint. Overrideable via the
 *   `WS_COMPACTION_OPS_THRESHOLD` env var for load testing.
 *
 * Non-blocking:
 *
 *   The sweep fires `storeDocumentHooks(..., immediately = true)` and
 *   does NOT await it. Each early-flush runs through the framework's
 *   debounce machinery (which awaits its own DB transaction inside
 *   Hocuspocus's `flushDocument` path); awaiting here would serialise
 *   the whole sweep behind the slowest flush, which would defeat the
 *   "fire and continue" promise the cadence is built on.
 */

import type {
  Document,
  Hocuspocus,
  onStoreDocumentPayload,
} from '@hocuspocus/server';

import { storageMetrics } from '../ws/storage-metrics';
import type { MeldConnectionContext } from '../ws/server';
import { getDb } from '../../db';
import { boards } from '../../db/schema';
import { sql as dsql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

/** Default cadence — 6 hours. ADR-003 named this. */
export const DEFAULT_COMPACTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Default threshold — 100 un-flushed ops per room. ADR-003 named this. */
export const DEFAULT_COMPACTION_OPS_THRESHOLD = 100;

/**
 * Subset of a Hocuspocus `Document` the sweep touches — just the
 * document name (so we can look up `last_compacted_op_seq` from the DB)
 * and the document itself (so we can pass it to
 * `storeDocumentHooks`).
 */
export interface CompactionDocument {
  name: string;
  document: Document;
}

/**
 * Minimal Hocuspocus surface the sweep relies on. Lets tests inject a
 * stub without constructing a real WS server.
 *
 * `flushRoom` is the only mutation hook — the production wrapper
 * synthesises the `onStoreDocumentPayload` from the live Hocuspocus
 * instance and calls `storeDocumentHooks(document, payload, true)`
 * internally; tests inject a stub that just records the call. Keeping
 * the payload construction INSIDE the wrapper (not inside
 * `runCompactionSweepImpl`) is what lets tests stub a minimal
 * `CompactionDocument` without a real Hocuspocus `Document` instance.
 */
export interface CompactionRoomRegistry {
  /** Iterate every room currently in memory. */
  listRooms(): CompactionDocument[];
  /**
   * Trigger the framework's debounced snapshot flush AT ONCE for the
   * given room — mirrors `Hocuspocus.storeDocumentHooks(document,
   * payload, true)`. Fire-and-forget; the framework's per-document
   * `saveMutex` serialises against concurrent flushes on the same
   * document.
   */
  flushRoom(room: CompactionDocument): void;
}

function wrapHocuspocusRegistry(
  hocuspocus: Hocuspocus<MeldConnectionContext>,
): CompactionRoomRegistry {
  return {
    listRooms(): CompactionDocument[] {
      const out: CompactionDocument[] = [];
      for (const [name, doc] of hocuspocus.documents) {
        out.push({ name, document: doc });
      }
      return out;
    },
    flushRoom(room): void {
      const payload = buildStorePayload(room, hocuspocus);
      // Fire-and-forget: the framework's saveMutex serialises against
      // concurrent flushes on the same document. We deliberately do not
      // `await` here — the sweep moves on to the next room.
      //
      // CRASH SAFETY: attach a `.catch` so a rejected flush promise
      // becomes a logged error instead of an `unhandledRejection` that
      // kills the process. A failed compaction flush is recoverable —
      // the next 6 h sweep (or the in-adapter early-flush) retries it.
      void hocuspocus
        .storeDocumentHooks(room.document, payload, true)
        .catch((err: unknown) => {
          console.error(
            `[compaction-sweep] flushRoom storeDocumentHooks failed for board ${room.name} (compaction delayed, recoverable):`,
            err,
          );
        });
    },
  };
}

/**
 * Reader for a board's `last_compacted_op_seq` + the `MAX(op_seq)` so the
 * sweep knows the un-flushed ops count without iterating `board_ops` per
 * room. Default reads through `getDb`; tests inject a stub.
 *
 * Returns `null` if the board row is missing (a smoke / test room with
 * no DB persistence). The sweep skips such rooms.
 */
export interface CompactionBacklogReader {
  readBacklog(boardId: string): Promise<number | null>;
}

function defaultBacklogReader(): CompactionBacklogReader {
  return {
    async readBacklog(boardId: string): Promise<number | null> {
      // SELECT MAX(op_seq) - last_compacted_op_seq AS backlog FROM
      // boards LEFT JOIN board_ops … but in v1 single-instance the
      // simplest form is a 2-row read: pull `last_compacted_op_seq` from
      // `boards` and `MAX(op_seq)` from `board_ops`. Keep them as two
      // round-trips to keep the typed Drizzle path tight; this runs at
      // most once per 6 h per room.
      const db = getDb();
      const board = await db.query.boards.findFirst({
        where: eq(boards.id, boardId),
        columns: { lastCompactedOpSeq: true },
      });
      if (!board) return null;
      const maxResult = await db.execute<{ max: number | null }>(dsql`
        SELECT MAX(op_seq) AS max FROM board_ops
        WHERE board_id = ${boardId}::uuid
      `);
      let maxOpSeq = 0;
      for (const row of maxResult as unknown as Iterable<{ max: number | null }>) {
        if (row.max !== null) maxOpSeq = row.max;
        break;
      }
      const backlog = maxOpSeq - board.lastCompactedOpSeq;
      return backlog > 0 ? backlog : 0;
    },
  };
}

/**
 * Result of one sweep run — exposed for tests and a future ops endpoint.
 */
export interface CompactionSweepResult {
  /** Number of rooms inspected (Hocuspocus.documents.size at sweep time). */
  roomsInspected: number;
  /** Number of rooms that crossed the threshold and got flushed. */
  roomsCompacted: number;
}

export interface CompactionSweepOptions {
  readonly registry?: CompactionRoomRegistry;
  readonly hocuspocus?: Hocuspocus<MeldConnectionContext>;
  readonly backlogReader?: CompactionBacklogReader;
  readonly intervalMs?: number;
  readonly opsThreshold?: number;
  readonly scheduler?: IntervalScheduler;
  readonly now?: () => number;
}

export interface IntervalScheduler {
  setInterval(handler: () => void, ms: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

export type IntervalHandle = ReturnType<typeof globalThis.setInterval>;

const DEFAULT_INTERVAL_SCHEDULER: IntervalScheduler = {
  setInterval(handler, ms) {
    return globalThis.setInterval(handler, ms);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle);
  },
};

/**
 * Read `WS_COMPACTION_OPS_THRESHOLD` from the environment. Non-numeric
 * or absent values fall back to the default.
 */
export function readCompactionOpsThresholdFromEnv(): number {
  const raw = process.env.WS_COMPACTION_OPS_THRESHOLD;
  if (raw === undefined || raw === '') return DEFAULT_COMPACTION_OPS_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[compaction-sweep] WS_COMPACTION_OPS_THRESHOLD=${raw} is not a positive number — falling back to ${String(DEFAULT_COMPACTION_OPS_THRESHOLD)}`,
    );
    return DEFAULT_COMPACTION_OPS_THRESHOLD;
  }
  return Math.floor(parsed);
}

/**
 * One CompactionSweep per process. Started in `src/server.ts` after
 * `meldWs.attach(httpServer)` so the room registry is live.
 */
export class CompactionSweep {
  #running = false;
  #timer: IntervalHandle | null = null;
  #lastRunMs: number | null = null;
  #lastResult: CompactionSweepResult | null = null;

  readonly #registry: CompactionRoomRegistry | null;
  readonly #backlogReader: CompactionBacklogReader;
  readonly #intervalMs: number;
  readonly #opsThreshold: number;
  readonly #scheduler: IntervalScheduler;
  readonly #now: () => number;

  constructor(options: CompactionSweepOptions = {}) {
    this.#registry =
      options.registry ??
      (options.hocuspocus ? wrapHocuspocusRegistry(options.hocuspocus) : null);
    this.#backlogReader = options.backlogReader ?? defaultBacklogReader();
    this.#intervalMs = options.intervalMs ?? DEFAULT_COMPACTION_SWEEP_INTERVAL_MS;
    this.#opsThreshold =
      options.opsThreshold ?? readCompactionOpsThresholdFromEnv();
    this.#scheduler = options.scheduler ?? DEFAULT_INTERVAL_SCHEDULER;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Idempotent. Arms a `setInterval` at the configured cadence. Does NOT
   * run a sweep on `start()` — the cadence is rolling and the first fire
   * happens after one interval. (Retention is anchored on a wall clock
   * and needs the boot sweep; compaction is a rolling backstop and does
   * not.) A `runSweepNow()` is exposed for tests + future ops endpoints.
   */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timer = this.#scheduler.setInterval(() => {
      void this.#runSweep();
    }, this.#intervalMs);
  }

  /** Cancel the interval. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timer !== null) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async runSweepNow(): Promise<CompactionSweepResult> {
    return this.#runSweep();
  }

  get running(): boolean {
    return this.#running;
  }

  get lastRunMs(): number | null {
    return this.#lastRunMs;
  }

  get lastResult(): CompactionSweepResult | null {
    return this.#lastResult;
  }

  /** Effective ops threshold (overrides + env). */
  get opsThreshold(): number {
    return this.#opsThreshold;
  }

  async #runSweep(): Promise<CompactionSweepResult> {
    let result: CompactionSweepResult = {
      roomsInspected: 0,
      roomsCompacted: 0,
    };
    try {
      result = await runCompactionSweepImpl(
        this.#registry,
        this.#backlogReader,
        this.#opsThreshold,
      );
    } catch (err) {
      console.error('[compaction-sweep] sweep failed:', err);
    }
    this.#lastRunMs = this.#now();
    this.#lastResult = result;
    storageMetrics.recordCompactionSweep(result.roomsCompacted);
    return result;
  }
}

/**
 * Pure sweep body — iterates rooms, reads backlog per room, flushes any
 * room above threshold via the registry's `flushRoom`. Exposed for
 * tests; production callers go through `CompactionSweep.start`.
 */
export async function runCompactionSweepImpl(
  registry: CompactionRoomRegistry | null,
  backlogReader: CompactionBacklogReader,
  opsThreshold: number,
): Promise<CompactionSweepResult> {
  if (registry === null) {
    return { roomsInspected: 0, roomsCompacted: 0 };
  }
  const rooms = registry.listRooms();
  let roomsCompacted = 0;
  for (const room of rooms) {
    const backlog = await backlogReader.readBacklog(room.name);
    if (backlog === null) continue;
    if (backlog < opsThreshold) continue;
    registry.flushRoom(room);
    roomsCompacted += 1;
  }
  return { roomsInspected: rooms.length, roomsCompacted };
}

/**
 * Build the `onStoreDocumentPayload` the framework's
 * `storeDocumentHooks` accepts. Mirrors the shape Task 1.3's Storage
 * adapter constructs inside `onChange` for the in-adapter early-flush
 * trigger.
 */
function buildStorePayload(
  room: CompactionDocument,
  hocuspocus: Hocuspocus<MeldConnectionContext> | null,
): onStoreDocumentPayload {
  // The Storage adapter (Task 1.3) only reads `document`, `documentName`,
  // and `instance` from the payload — `lastContext` and
  // `lastTransactionOrigin` are framework forwards that the snapshot
  // path ignores. We synthesise a minimal-shape payload here and cast
  // through `unknown` because (a) `Hocuspocus<MeldConnectionContext>`
  // narrows the framework's `any`-typed `instance` field but the assignable
  // shape (`unknown` for `lastContext`) is not type-equal to what the
  // structural `onStoreDocumentPayload` interface expects on either side.
  const payload = {
    instance: hocuspocus,
    clientsCount: room.document.getConnectionsCount(),
    document: room.document,
    documentName: room.name,
    lastContext: null,
    lastTransactionOrigin: null,
  };
  return payload as unknown as onStoreDocumentPayload;
}

let singleton: CompactionSweep | null = null;

export function getCompactionSweep(
  hocuspocus?: Hocuspocus<MeldConnectionContext>,
): CompactionSweep {
  singleton ??=
    hocuspocus === undefined
      ? new CompactionSweep()
      : new CompactionSweep({ hocuspocus });
  return singleton;
}

/** Test-only. */
export function __resetCompactionSweepSingletonForTests(): void {
  singleton = null;
}
