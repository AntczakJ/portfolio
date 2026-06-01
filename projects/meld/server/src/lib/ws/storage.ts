import type {
  Extension,
  Hocuspocus,
  onChangePayload,
  onConnectPayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

import { getDb } from '../../db';
import { boardOps, boards } from '../../db/schema';
import { storageMetrics } from './storage-metrics';

/**
 * Hocuspocus Storage adapter (Task 1.3 — ADR-003 hybrid ops-log +
 * debounced snapshot persistence).
 *
 * This file replaces `storage-stub.ts` (the no-op placeholder Task 1.4
 * shipped) with the real persistence path.
 *
 * Why an Extension (not a separate `Storage` class):
 *
 *   Hocuspocus 4.1 does not export a `Storage` interface as ADR-002's
 *   planning brief suggested. The persistence injection points ARE the
 *   `onLoadDocument` and `onStoreDocument` extension hooks per
 *   `node_modules/@hocuspocus/server/dist/index.d.ts` lines 363 / 382.
 *   ADR-002's "Storage adapter shape" is a logical name for what this
 *   extension implements; the concrete shape on the framework side is
 *   four hooks: `onLoadDocument`, `onChange`, `onStoreDocument`,
 *   `onConnect`.
 *
 * Hook surface and the ADR-003 mapping:
 *
 *   `onLoadDocument` (load path)
 *     1. SELECT `state, last_compacted_op_seq` FROM `boards` WHERE id =
 *        documentName. If the row is missing, return `null` — Hocuspocus
 *        treats this as "fresh board, start from empty `Y.Doc`".
 *     2. If `state` is non-null, decode it onto a fresh `Y.Doc` via
 *        `Y.applyUpdate`. Otherwise start with an empty `Y.Doc`.
 *     3. SELECT `update` FROM `board_ops` WHERE board_id = X AND
 *        op_seq > last_compacted_op_seq ORDER BY op_seq ASC. Apply each
 *        op to the same `Y.Doc`. This is the durable-ops replay that
 *        bounds the crash-recovery loss to a sub-second window
 *        (ADR-003 — see the "Recovery semantics" comment block on
 *        `loadDocumentImpl` below).
 *     4. Encode the rehydrated `Y.Doc` as a single `Uint8Array` and
 *        return it. Hocuspocus calls `Y.applyUpdate(document, returned)`
 *        on top of the in-memory empty `Y.Doc`, producing the same
 *        state vector as the snapshot-plus-replay run.
 *     5. Seed the per-board in-memory ops counter at MAX(op_seq) so the
 *        100-ops early-flush trigger picks up from the right starting
 *        point.
 *
 *   `onChange` (per-edit durability path)
 *     Append a `board_ops` row with the next per-board `op_seq`. The
 *     ADR-003 recovery bound depends on this — every Yjs sync-update
 *     frame the framework decodes commits an ops row before any client
 *     ACK can complete the round trip. If the early-flush counter
 *     crosses the 100-ops threshold, schedule an immediate
 *     `instance.storeDocumentHooks(document, ..., true)` to trigger an
 *     out-of-debounce snapshot write.
 *
 *   `onStoreDocument` (snapshot + compaction)
 *     Single transaction:
 *       1. SELECT MAX(op_seq) for the board (the new
 *          `last_compacted_op_seq` value).
 *       2. UPDATE / INSERT `boards` with the freshly-encoded snapshot
 *          state, new `last_compacted_op_seq`, refreshed
 *          `last_active_at`.
 *       3. DELETE `board_ops` rows with `op_seq <= last_compacted_op_seq`
 *          for the board. This is the compaction; superseded ops are
 *          removed in the same transaction that bumps the high-water
 *          mark, so readers either see the pre-flush chain OR the
 *          post-flush snapshot — never a torn state. We use the
 *          default Postgres READ COMMITTED isolation; the BEGIN/COMMIT
 *          envelope is what guarantees atomicity, not a higher
 *          isolation level (the load path only reads
 *          `op_seq > last_compacted_op_seq` which makes the snapshot
 *          UPDATE + ops DELETE pair race-free under READ COMMITTED).
 *       4. Reset the in-memory ops counter back to zero (next flush
 *          starts fresh).
 *
 *   `onConnect` (presence touch)
 *     UPDATE `boards.last_active_at = NOW()` so the ADR-003 30-day
 *     retention sweep sees a fresh signal. Falls open silently if the
 *     board row does not yet exist — `POST /api/boards` (Task 1.6) is
 *     the only insert path, and a connect against an unknown board id
 *     is a deliberate edge that the WS path tolerates.
 *
 * Atomic-write isolation level: PostgreSQL default (READ COMMITTED).
 * The snapshot UPDATE + ops DELETE pair is wrapped in a single
 * `db.transaction(...)` — that BEGIN/COMMIT envelope is what guarantees
 * the load path never observes a torn state, NOT a SERIALIZABLE escalation.
 * The reason READ COMMITTED suffices: the load path's filter is
 * `op_seq > last_compacted_op_seq`, and inside the transaction we first
 * UPDATE `last_compacted_op_seq` and THEN DELETE ops up to and including
 * the new value. A reader who races inside the transaction window sees
 * either the pre-UPDATE `boards` row (old `last_compacted_op_seq`, ops
 * still in `board_ops`) or the post-COMMIT state (new
 * `last_compacted_op_seq`, deleted ops). Either is internally consistent.
 *
 * Per-board op_seq concurrency strategy: the next op_seq is assigned
 * inside the SAME INSERT statement via
 *   INSERT ... SELECT COALESCE(MAX(op_seq), 0) + 1 FROM board_ops
 *   WHERE board_id = $1
 * which is race-free for v1's single-instance Node deployment because
 * (a) Postgres serializes statements against the same `board_ops`
 * partition of the unique `(board_id, op_seq)` index and (b) the unique
 * index causes a second concurrent insert at the same seq to ROLLBACK
 * cleanly. If a future deployment moves to multi-instance Hocuspocus,
 * this counter becomes a shared-state hazard (AGENT_NOTES.md "Per-board
 * board_ops.seq is in-memory monotonic" already pins this) and a
 * distributed sequence (Redis INCR keyed by boardId or a per-board
 * advisory lock) becomes load-bearing — out of scope for v1.
 *
 * Per-board ops counter (the 100-ops early-flush trigger): an in-memory
 * `Map<boardId, number>` is seeded on `onLoadDocument` from
 * `MAX(op_seq) - last_compacted_op_seq` (the count of un-flushed ops).
 * Every `onChange` increments; crossing 100 schedules
 * `instance.storeDocumentHooks(document, storePayload, true)` which
 * Hocuspocus debounces with `debounce: 0` (immediate). The counter is
 * reset to zero inside the `onStoreDocument` transaction. AGENT_NOTES.md
 * "Hocuspocus extension-hook quirks" already pins the
 * `instance.storeDocumentHooks(...)` API as the framework's documented
 * early-flush mechanism — `Document.save()` does not exist in 4.1.
 */

/**
 * Configuration. v1 reads the env var once at module load via `server.ts`
 * and threads it through to `createStorageExtension`. Tests can inject
 * their own values.
 */
export interface StorageExtensionOptions {
  /**
   * Early-flush threshold: an `onChange` that crosses this op-count
   * (relative to the last flush) schedules an immediate
   * `storeDocumentHooks(..., true)` to drain the snapshot ahead of the
   * debounce window. ADR-003 pins this at 100; env var
   * `WS_OPS_FLUSH_THRESHOLD` overrides it for load testing.
   */
  opsFlushThreshold?: number;
}

/** Default early-flush threshold per ADR-003. */
const DEFAULT_OPS_FLUSH_THRESHOLD = 100;

/**
 * Mapping from `documentName` (the board uuid string) to the number of
 * un-flushed ops since the last `onStoreDocument` commit. Seeded on
 * `onLoadDocument`, incremented on `onChange`, reset on
 * `onStoreDocument`.
 *
 * Module-level scope is correct: there is one Storage extension per
 * Hocuspocus instance and one Hocuspocus instance per Node process per
 * ADR-001. If a future test wants isolation it constructs a fresh
 * extension via `createStorageExtension({ opsFlushThreshold })` — the
 * counter map is closed over in that case (see the factory below).
 */
function createStorageExtension(
  options: StorageExtensionOptions = {},
): Extension {
  const opsFlushThreshold = options.opsFlushThreshold ?? DEFAULT_OPS_FLUSH_THRESHOLD;

  /**
   * Un-flushed ops per board. Reset to 0 inside `onStoreDocument` after
   * the transaction commits.
   */
  const pendingOpsCount = new Map<string, number>();

  /**
   * UUID v4 regex. We only ever attempt persistence for documentName
   * strings that look like a board uuid; anything else short-circuits
   * with a structured log so a malformed `/ws/board/:boardId` path does
   * not blow up the load path. The path filter in `server.ts` already
   * narrows `boardId` to `[A-Za-z0-9_-]+`; this is belt-and-braces.
   */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isPersistableBoardId(documentName: string): boolean {
    return UUID_RE.test(documentName);
  }

  /**
   * Recovery semantics — the load path documented in code.
   *
   * Recovery bound is per-edit-durability: each `board_ops` row is
   * COMMITted inside `onChange` BEFORE the framework's `handleUpdate`
   * pipeline broadcasts the update to the other peers and before any
   * client could observe an ack via the y-websocket sync handshake.
   * On server crash mid-debounce, the snapshot is at most
   * `maxDebounce` (30 s) stale, but `board_ops` is durable through
   * every op the server received. The cold-start load path replays
   * snapshot + ops to reconstruct the live state vector exactly.
   *
   * Subtle ordering note: Hocuspocus calls `onChange` AFTER it has
   * already applied the update to the in-memory `Y.Doc` (see upstream
   * `handleDocumentUpdate` ESM line 1185 — `this.hooks("onChange", ...)`
   * fires after the framework's own listeners have written into the
   * document). The per-edit durability claim is therefore "every op
   * the in-memory `Y.Doc` has integrated is durable iff `onChange`
   * resolved" — there is a sub-millisecond window between the
   * framework's `applyUpdate` and the `onChange` resolution where a
   * crash would leave the just-applied update only in the (lost)
   * in-memory `Y.Doc`. But surviving clients re-broadcast their
   * unack'd local ops on reconnect via the y-websocket sync handshake,
   * so any op the in-memory doc had absorbed but not yet durably
   * acked to Postgres re-arrives from the originating client. The
   * effective recovery bound is therefore: "edits the server received
   * AND whose originating client also crashed/disconnected without
   * buffer flush in the same sub-millisecond window" — the same bound
   * ADR-003 promised.
   */
  async function loadDocumentImpl(
    payload: onLoadDocumentPayload,
  ): Promise<Uint8Array | null> {
    const { documentName } = payload;
    if (!isPersistableBoardId(documentName)) {
      // Not a persistable board id — let Hocuspocus start with an
      // empty `Y.Doc`. The path filter in `server.ts` shapes the wire
      // to only let through `[A-Za-z0-9_-]+` strings; non-uuid strings
      // arriving here are test boards or future namespaces. We log
      // once at debug level so it's grep-able but do NOT throw.
      console.log(
        `[meld-storage] onLoadDocument: documentName ${documentName} is not a uuid — starting fresh`,
      );
      return null;
    }

    const db = getDb();
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, documentName),
      columns: { state: true, lastCompactedOpSeq: true },
    });
    if (!board) {
      // Brand-new board — no row in `boards`. Hocuspocus's
      // `null`-handling branch starts the document from the empty
      // `Y.Doc` it just instantiated. The first `onChange` will
      // append the first op against a board_id with no `boards` row
      // — that path is owned by Task 1.6's `POST /api/boards`, which
      // inserts the `boards` row before any client connects. A
      // direct WS connection to an unknown board id (no
      // `POST /api/boards` first) will surface as a missing
      // `boards` row on `onChange`'s FK constraint and the transaction
      // rolls back. v1.6+ flows always insert the board first.
      pendingOpsCount.set(documentName, 0);
      return null;
    }

    // Rehydrate the Y.Doc inside the adapter so we can run the ops
    // replay through a single deterministic encoder pass — the
    // upstream framework would otherwise call `applyUpdate(doc, ...)`
    // on the snapshot but not on the ops chain. We do BOTH here and
    // return a single encoded blob.
    const doc = new Doc();
    if (board.state) {
      applyUpdate(doc, board.state);
    }

    const opsRows = await db
      .select({ update: boardOps.update })
      .from(boardOps)
      .where(
        and(
          eq(boardOps.boardId, documentName),
          gt(boardOps.opSeq, board.lastCompactedOpSeq),
        ),
      )
      .orderBy(asc(boardOps.opSeq));

    if (opsRows.length > 0) {
      for (const row of opsRows) {
        applyUpdate(doc, row.update);
      }
      storageMetrics.recordReplayFromOps();
    }

    // Seed the per-board ops counter at the current un-flushed count
    // so the 100-ops early-flush trigger picks up exactly where the
    // last crash left off. For a clean shutdown this is zero; for a
    // crash mid-debounce the seed may be positive and the next
    // `onChange` may immediately trigger an early-flush — which is
    // the correct behaviour, the framework just missed the deadline.
    pendingOpsCount.set(documentName, opsRows.length);

    return encodeStateAsUpdate(doc);
  }

  async function changeImpl(payload: onChangePayload): Promise<void> {
    const { documentName, update } = payload;
    if (!isPersistableBoardId(documentName)) return;

    const db = getDb();

    // Atomic per-board next-seq insert. The MAX(op_seq) subquery sees
    // the post-commit state of any concurrent insert on the same
    // board_id partition under READ COMMITTED, and the unique
    // `(board_id, op_seq)` index catches the unlikely race. v1
    // single-instance Node makes that race statistically near-zero
    // anyway — see the per-board op_seq concurrency note in the
    // file-level docblock above.
    //
    // The INSERT is a raw `sql` because Drizzle's typed builder does
    // not expose the SELECT-into-INSERT form natively for
    // self-referential MAX. Using `sql` here is intentional and
    // documented.
    await db.execute(sql`
      INSERT INTO ${boardOps} (board_id, op_seq, update)
      SELECT ${documentName}::uuid,
             COALESCE(MAX(op_seq), 0) + 1,
             ${update}
      FROM ${boardOps}
      WHERE board_id = ${documentName}::uuid
    `);
    storageMetrics.recordOpAppended();

    const current = pendingOpsCount.get(documentName) ?? 0;
    const next = current + 1;
    pendingOpsCount.set(documentName, next);

    if (next >= opsFlushThreshold) {
      // Schedule an immediate flush. The framework's debouncer keys on
      // `onStoreDocument-${document.name}`; passing `immediately =
      // true` rebinds the debounce delay to 0 and the snapshot write
      // fires on the next tick. Resetting the counter here would
      // race with the asynchronous flush — instead the counter is
      // reset inside `onStoreDocument` after the transaction commits.
      const storePayload: onStoreDocumentPayload = {
        instance: payload.instance,
        clientsCount: payload.clientsCount,
        document: payload.document,
        documentName: payload.documentName,
        // `payload.context` is typed `any` by the framework; the
        // Hocuspocus `onStoreDocument` shape accepts `unknown` here.
        // The cast erases the `any` so ESLint's
        // `no-unsafe-assignment` rule does not flag the field.
        lastContext: payload.context as unknown,
        lastTransactionOrigin: payload.transactionOrigin,
      };
      // storeDocumentHooks is async but onChange is fire-and-forget
      // per the framework's own usage pattern (ESM line 1185 —
      // `this.hooks("onChange", changePayload)` is not awaited).
      // Detach via `void` so the onChange hook returns immediately;
      // any error inside the early-flush path is caught by Hocuspocus's
      // own try/catch in `storeDocumentHooks`.
      void payload.instance.storeDocumentHooks(
        payload.document,
        storePayload,
        true,
      );
    }
  }

  async function storeDocumentImpl(
    payload: onStoreDocumentPayload,
  ): Promise<void> {
    const { documentName, document } = payload;
    if (!isPersistableBoardId(documentName)) return;

    // Encode OUTSIDE the transaction — encoding is pure-CPU and we do
    // not want to hold the row lock across it.
    const stateBytes = encodeStateAsUpdate(document);

    const db = getDb();

    const opsCompacted = await db.transaction(async (tx) => {
      // 1. Compute the new high-water mark INSIDE the transaction so
      //    any op that landed via `onChange` between the encode above
      //    and this SELECT is correctly merged into the snapshot
      //    (the framework's `saveMutex` per-document ensures that
      //    encoding and the next round of `onChange` updates are
      //    serialized against the same Y.Doc anyway, but the SELECT
      //    inside the transaction is the load-bearing guarantee).
      const maxResult = await tx
        .select({
          max: sql<number | null>`MAX(${boardOps.opSeq})`.as('max'),
        })
        .from(boardOps)
        .where(eq(boardOps.boardId, documentName));
      const newHighWater = maxResult[0]?.max ?? 0;

      // 2. UPSERT `boards`. The board row should already exist (it was
      //    inserted by `POST /api/boards` before the first WS
      //    connect), but the test/demo path may hit `onStoreDocument`
      //    against a board the test author bypassed the HTTP creation
      //    flow for. The `INSERT ... ON CONFLICT` shape covers both.
      //
      //    `last_active_at` is bumped on every snapshot so a quiet
      //    snapshot loop on an open tab keeps the retention sweep
      //    away.
      await tx
        .insert(boards)
        .values({
          id: documentName,
          name: 'Untitled board',
          state: stateBytes,
          lastCompactedOpSeq: newHighWater,
          lastActiveAt: new Date(),
        })
        .onConflictDoUpdate({
          target: boards.id,
          set: {
            state: stateBytes,
            lastCompactedOpSeq: newHighWater,
            lastActiveAt: new Date(),
          },
        });

      // 3. DELETE ops that have been merged into the snapshot. The
      //    `lte` is inclusive — ops with `op_seq == newHighWater` are
      //    now durably represented in `boards.state`. Return the
      //    deleted-rows count out of the transaction so the metrics
      //    accounting can run AFTER COMMIT — a rolled-back transaction
      //    inflates no counters.
      if (newHighWater > 0) {
        const deleted = await tx
          .delete(boardOps)
          .where(
            and(
              eq(boardOps.boardId, documentName),
              lte(boardOps.opSeq, newHighWater),
            ),
          )
          .returning({ id: boardOps.id });
        return deleted.length;
      }
      return 0;
    });

    // 4. Update metrics OUTSIDE the transaction so a failure inside
    //    the BEGIN/COMMIT doesn't inflate counters. The reset is in
    //    a finally-like place — on the success path only — so a
    //    rolled-back transaction leaves the in-memory counter
    //    unchanged and the next onChange will see the same un-flushed
    //    count.
    storageMetrics.recordSnapshot(stateBytes.byteLength);
    if (opsCompacted > 0) {
      storageMetrics.recordCompaction();
    }
    pendingOpsCount.set(documentName, 0);
  }

  async function connectImpl(payload: onConnectPayload): Promise<void> {
    const { documentName } = payload;
    if (!isPersistableBoardId(documentName)) return;
    // `touch` is a single UPDATE; we do not insert a row if missing.
    // A connect-then-edit against an unknown board id is a deliberate
    // edge — the FK on `board_ops.board_id` will reject the first
    // `onChange` write inside the same connection if `POST /api/boards`
    // never ran, and we want that loud failure rather than a silent
    // implicit board create here.
    try {
      const db = getDb();
      await db
        .update(boards)
        .set({ lastActiveAt: new Date() })
        .where(eq(boards.id, documentName));
    } catch (err) {
      // touch failure is not fatal — the connection should still
      // proceed; we only log so a Postgres outage surfaces.
      console.error('[meld-storage] onConnect touch failed:', err);
    }
  }

  return {
    extensionName: 'meld-storage',
    priority: 1000,

    onLoadDocument(payload: onLoadDocumentPayload): Promise<Uint8Array | null> {
      return loadDocumentImpl(payload);
    },

    onChange(payload: onChangePayload): Promise<void> {
      return changeImpl(payload);
    },

    onStoreDocument(payload: onStoreDocumentPayload): Promise<void> {
      return storeDocumentImpl(payload);
    },

    onConnect(payload: onConnectPayload): Promise<void> {
      return connectImpl(payload);
    },
  };
}

/**
 * The Storage extension used by the live `server.ts` boot. Constructed
 * with the env-var-resolved ops flush threshold so a `.env`-driven
 * override applies without recompilation.
 */
export const storageExtension: Extension = createStorageExtension(
  process.env.WS_OPS_FLUSH_THRESHOLD === undefined
    ? {}
    : { opsFlushThreshold: Number(process.env.WS_OPS_FLUSH_THRESHOLD) },
);

/**
 * Factory exposed for tests + the smoke script that want to construct
 * a fresh extension with its own counter map. Production code uses the
 * module-level `storageExtension`.
 */
export { createStorageExtension };

/**
 * Indirectly imports the Hocuspocus type for downstream consumers that
 * want the extension's hook surface explicitly. Not used at runtime; the
 * `Hocuspocus` import above is a type-only re-export anchor so a future
 * generic typing of `Extension<Context>` can reference it.
 */
export type { Hocuspocus };
