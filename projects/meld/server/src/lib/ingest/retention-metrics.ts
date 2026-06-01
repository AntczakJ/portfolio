/**
 * Process-lifetime counters for the meld retention scheduler (Task 1.5 —
 * ADR-003 nightly retention sweep + ADR-004 control.board-deleted emit).
 *
 * Exposed via `/health` under the `db.retention` sub-shape. Distinct from
 * `wsMetrics` (which counts the WS surface broadly) and
 * `storageMetrics` (which counts the Hocuspocus Storage adapter's
 * snapshot/ops path) so a `/health` reader can attribute a
 * `controlFramesOut` jump to either the welcome-frame emit (Task
 * 1.X-control) or the retention sweep without ambiguity.
 *
 * What is counted:
 *
 *  - `retentionDeletedCount` — process-lifetime total of `boards` rows
 *                              the sweep has deleted (sum across all
 *                              sweep runs since process start).
 *  - `retentionEmittedCount` — process-lifetime total of
 *                              `control.board-deleted` TEXT frames the
 *                              sweep has successfully sent before
 *                              closing the connection.
 *  - `retentionLastRunMs`    — wall-clock ms epoch of the last sweep
 *                              run (boot or daily). `null` before the
 *                              first sweep.
 *
 * In-memory only. Resets on process restart. v1 is single-instance per
 * ADR-001 so a multi-instance counter store is out of scope. Concurrency:
 * Node is single-threaded.
 *
 * Schema pinned in `src/lib/schemas/health.ts` as `retentionHealthSchema`.
 */

export interface RetentionMetricsSnapshot {
  retentionDeletedCount: number;
  retentionEmittedCount: number;
  retentionLastRunMs: number | null;
}

interface MetricsState {
  retentionDeletedCount: number;
  retentionEmittedCount: number;
  retentionLastRunMs: number | null;
}

const state: MetricsState = {
  retentionDeletedCount: 0,
  retentionEmittedCount: 0,
  retentionLastRunMs: null,
};

export const retentionMetrics = {
  /**
   * Record one completed sweep. Adds the per-sweep deletedCount and
   * emittedCount to the running totals and writes the run timestamp.
   * Zero-result sweeps still update `retentionLastRunMs` so a viewer can
   * tell "the sweep ran and found nothing" from "the sweep never ran".
   */
  recordSweep(
    deletedCount: number,
    emittedCount: number,
    runAtMs: number,
  ): void {
    state.retentionDeletedCount += deletedCount;
    state.retentionEmittedCount += emittedCount;
    state.retentionLastRunMs = runAtMs;
  },

  snapshot(): RetentionMetricsSnapshot {
    return {
      retentionDeletedCount: state.retentionDeletedCount,
      retentionEmittedCount: state.retentionEmittedCount,
      retentionLastRunMs: state.retentionLastRunMs,
    };
  },

  /** Test-only. Mirrors `wsMetrics.reset`. */
  reset(): void {
    state.retentionDeletedCount = 0;
    state.retentionEmittedCount = 0;
    state.retentionLastRunMs = null;
  },
};
