/**
 * Process-lifetime counters for the meld Storage adapter (Task 1.3 —
 * ADR-003 hybrid ops-log + debounced snapshot persistence).
 *
 * Exposed via the existing `/health` endpoint under `db.storage`. ADR-003
 * explicitly deferred the question of a dedicated `/health.db` endpoint
 * with snapshot-bytes / ops-bytes / oldest-op-age aggregates to v1.1; for
 * v1 the nested `db.storage` key on the existing envelope is the right
 * surface — one curl, one parser, no new route to wire into the cors
 * allowlist or rate limiter later.
 *
 * What is counted:
 *
 *  - `snapshotCount`        — process-lifetime total of successful
 *                             `onStoreDocument` flushes (one per debounce
 *                             window OR one per 100-ops early-flush).
 *                             A value > rooms*duration_in_5s_chunks hints
 *                             at over-eager early flushes.
 *  - `snapshotBytes`        — running total of bytes written via
 *                             `Y.encodeStateAsUpdate` across all flushes.
 *                             Divide by `snapshotCount` for the running
 *                             average snapshot size — used during smoke
 *                             testing as the byte-size baseline ADR-003
 *                             named (200 shapes / 1000 edits ~= 25 KB).
 *  - `opsAppended`          — process-lifetime total of `onChange` ops
 *                             appended to `board_ops`. Per-edit durability
 *                             counter — see ADR-003 recovery bound.
 *  - `compactionRuns`       — process-lifetime total of in-store
 *                             compactions (the DELETE of superseded ops
 *                             happens INSIDE the snapshot transaction per
 *                             Task 1.3 — there is no separate compaction
 *                             sweep in v1.3; Task 1.5 owns the hourly
 *                             background sweep). A value equal to
 *                             `snapshotCount` means every snapshot also
 *                             compacted at least one op; a value of zero
 *                             with non-zero snapshotCount means every
 *                             snapshot ran against a board with no ops
 *                             since last flush (debounce coalesced).
 *  - `replayFromOpsCount`   — process-lifetime total of `onLoadDocument`
 *                             calls that replayed at least one op on top
 *                             of the snapshot. Drives the cold-start
 *                             observation: ideally the snapshot is
 *                             current and replay is zero ops; a non-zero
 *                             value matching `snapshotCount` indicates
 *                             the server crashed between an `onChange`
 *                             flush and the next `onStoreDocument`
 *                             flush — exactly the recovery scenario
 *                             ADR-003 cited.
 *
 * In-memory only. Resets on process restart. No Postgres, no Redis — v1
 * is single-instance per ADR-001. Concurrency: Node is single-threaded,
 * so the increment+read pattern is race-free without a mutex.
 *
 * Shape pinned by the `db.storage` sub-shape of `healthResponseSchema`
 * in `src/lib/schemas/health.ts`.
 */

/**
 * Outbound shape of {@link storageMetrics.snapshot}. Counters are
 * monotonic-increasing process-lifetime totals; consumers compute rates
 * by sampling the delta over a window.
 */
export interface StorageMetricsSnapshot {
  snapshotCount: number;
  snapshotBytes: number;
  opsAppended: number;
  compactionRuns: number;
  replayFromOpsCount: number;
  compactionSweepRuns: number;
  roomsCompactedThisSweep: number;
  /**
   * Process-lifetime total of `op_seq` collisions (SQLSTATE 23505 on the
   * `board_ops_board_id_op_seq_unique` index) that the `onChange` append
   * retried. Each increment is one retried INSERT attempt, NOT one op —
   * an op that collided twice before succeeding counts 2 here. Under the
   * advisory-lock serialization (see `changeImpl`) this should sit at or
   * near zero; a sustained non-zero rate means same-board inserts are
   * racing past the lock (a regression) and deserves investigation.
   */
  opSeqRetries: number;
  /**
   * Process-lifetime total of `onChange` op appends that THREW and were
   * swallowed by the crash-safety wrapper rather than propagated as an
   * unhandled rejection. A lost op is recoverable via the client's
   * y-websocket re-sync; a crashed process is not — see the resilience
   * note on `changeImpl`. Any non-zero value here is a real durability
   * miss worth alerting on, distinct from a transient retry.
   */
  opWriteErrors: number;
}

interface MetricsState {
  snapshotCount: number;
  snapshotBytes: number;
  opsAppended: number;
  compactionRuns: number;
  replayFromOpsCount: number;
  compactionSweepRuns: number;
  roomsCompactedThisSweep: number;
  opSeqRetries: number;
  opWriteErrors: number;
}

const state: MetricsState = {
  snapshotCount: 0,
  snapshotBytes: 0,
  opsAppended: 0,
  compactionRuns: 0,
  replayFromOpsCount: 0,
  compactionSweepRuns: 0,
  roomsCompactedThisSweep: 0,
  opSeqRetries: 0,
  opWriteErrors: 0,
};

export const storageMetrics = {
  /**
   * Increment after a successful `onStoreDocument` UPSERT into `boards`.
   * Pass the byte length of the snapshot for the rolling-size accumulator.
   */
  recordSnapshot(byteLength: number): void {
    state.snapshotCount += 1;
    state.snapshotBytes += byteLength;
  },

  /**
   * Increment after a successful `onChange` INSERT into `board_ops`.
   */
  recordOpAppended(): void {
    state.opsAppended += 1;
  },

  /**
   * Increment when a snapshot UPSERT also deleted at least one
   * superseded op in the same transaction. Distinct from
   * `snapshotCount` because a debounce-window flush against an
   * unchanged board would compact zero ops.
   */
  recordCompaction(): void {
    state.compactionRuns += 1;
  },

  /**
   * Increment when `onLoadDocument` replayed at least one op on top of
   * the snapshot. The zero-op case (clean cold start after a recent
   * snapshot) does NOT increment.
   */
  recordReplayFromOps(): void {
    state.replayFromOpsCount += 1;
  },

  /**
   * Record one completed compaction-sweep run (Task 1.5 — the periodic
   * 6 h backstop that triggers `storeDocumentHooks(..., immediately)`
   * for rooms above the un-flushed-ops threshold). Pass the number of
   * rooms flushed in this sweep; `roomsCompactedThisSweep` is overwritten
   * (NOT accumulated) so a reader sees the LAST sweep's room count
   * rather than a process-lifetime sum. The lifetime sum lives on
   * `compactionRuns` already — that counter increments per snapshot
   * UPSERT that ALSO deleted at least one op, regardless of whether
   * the trigger was the sweep or the in-adapter early-flush.
   */
  recordCompactionSweep(roomsCompactedThisSweep: number): void {
    state.compactionSweepRuns += 1;
    state.roomsCompactedThisSweep = roomsCompactedThisSweep;
  },

  /**
   * Increment once per retried `board_ops` INSERT after a unique-violation
   * (SQLSTATE 23505) on the `(board_id, op_seq)` index. Counts attempts,
   * not ops — see {@link StorageMetricsSnapshot.opSeqRetries}.
   */
  recordOpSeqRetry(): void {
    state.opSeqRetries += 1;
  },

  /**
   * Increment once per `onChange` append that threw and was swallowed by
   * the crash-safety wrapper. See
   * {@link StorageMetricsSnapshot.opWriteErrors}.
   */
  recordOpWriteError(): void {
    state.opWriteErrors += 1;
  },

  /**
   * Return a copy of the current counter values. The returned object is
   * a fresh allocation each call — callers may mutate it freely without
   * affecting the source-of-truth state.
   */
  snapshot(): StorageMetricsSnapshot {
    return {
      snapshotCount: state.snapshotCount,
      snapshotBytes: state.snapshotBytes,
      opsAppended: state.opsAppended,
      compactionRuns: state.compactionRuns,
      replayFromOpsCount: state.replayFromOpsCount,
      compactionSweepRuns: state.compactionSweepRuns,
      roomsCompactedThisSweep: state.roomsCompactedThisSweep,
      opSeqRetries: state.opSeqRetries,
      opWriteErrors: state.opWriteErrors,
    };
  },

  /**
   * Reset all counters. Test-only — production code must not call this
   * (a Prometheus scrape would see a fictional dip if counters reset
   * mid-life). Kept here rather than in a separate test helper because
   * Vitest co-location is the repo convention and the export surface is
   * already small.
   */
  reset(): void {
    state.snapshotCount = 0;
    state.snapshotBytes = 0;
    state.opsAppended = 0;
    state.compactionRuns = 0;
    state.replayFromOpsCount = 0;
    state.compactionSweepRuns = 0;
    state.roomsCompactedThisSweep = 0;
    state.opSeqRetries = 0;
    state.opWriteErrors = 0;
  },
};
