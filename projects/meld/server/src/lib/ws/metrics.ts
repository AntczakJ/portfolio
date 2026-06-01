/**
 * Process-lifetime counters for the meld WS surface, exposed via
 * `/health.ws` per ADR-002 and ADR-004.
 *
 * The metric set in Task 1.4 covers ONLY the observability fields ADR-002
 * named — `controlFramesOut`, `controlFramesDropped`, `rateLimitedCount`.
 * ADR-004's three additional control-frame counters (overruns total,
 * protocol-version mismatches, sent vs dropped split) land in Task
 * 1.X-control-observability once the control-frame emit path is wired.
 *
 * In-memory only. Resets on process restart. No Postgres, no Redis — v1
 * is single-instance per ADR-001 and a multi-instance shape would need an
 * external counter store anyway. The route handler doc-comment on
 * `/health.ws` reminds operators that a Prometheus scrape later would
 * read the same in-memory snapshot.
 *
 * Concurrency: Node is single-threaded, so the increment+read pattern is
 * race-free without a mutex.
 */

/**
 * Outbound shape of {@link wsMetrics.snapshot}. Counters are
 * monotonic-increasing process-lifetime totals; consumers compute rates
 * by sampling the delta over a window.
 *
 * Shape pinned by `/health.ws` Zod schema in
 * `src/lib/schemas/health.ts` — see {@link wsHealthSchema}.
 */
export interface WsMetricsSnapshot {
  controlFramesOut: number;
  controlFramesDropped: number;
  rateLimitedCount: number;
  overrunDisconnectCount: number;
}

interface MetricsState {
  controlFramesOut: number;
  controlFramesDropped: number;
  rateLimitedCount: number;
  overrunDisconnectCount: number;
}

const state: MetricsState = {
  controlFramesOut: 0,
  controlFramesDropped: 0,
  rateLimitedCount: 0,
  overrunDisconnectCount: 0,
};

export const wsMetrics = {
  /**
   * Increment after a successful `connection.send(controlFrame)`. Task
   * 1.X-control wires this to the welcome / overrun / board-deleted
   * emit sites.
   */
  recordControlFrameOut(): void {
    state.controlFramesOut += 1;
  },

  /**
   * Increment when a control frame cannot be sent — serialization throw,
   * socket already closed, etc. Task 1.X-control wires this in.
   */
  recordControlFrameDropped(): void {
    state.controlFramesDropped += 1;
  },

  /**
   * Increment when an upgrade is rejected for an origin-allowlist or
   * other rate / abuse boundary. Wired in Task 1.4's `onConnect`
   * Origin-reject path.
   */
  recordRateLimited(): void {
    state.rateLimitedCount += 1;
  },

  /**
   * Increment when the server forces a WS close because a control.overrun
   * frame fired (rate limit exhausted, message too large, queue
   * overflow). Distinct from `rateLimitedCount` which counts upgrade
   * rejects at the Origin allowlist boundary — `overrunDisconnectCount`
   * is the in-session disconnect count tied to the close-code-4290
   * path. Wired by Task 1.X-control's `emitOverrunAndClose`.
   */
  recordOverrunDisconnect(): void {
    state.overrunDisconnectCount += 1;
  },

  /**
   * Return a copy of the current counter values. The returned object is
   * a fresh allocation each call — callers may mutate it freely without
   * affecting the source-of-truth state.
   */
  snapshot(): WsMetricsSnapshot {
    return {
      controlFramesOut: state.controlFramesOut,
      controlFramesDropped: state.controlFramesDropped,
      rateLimitedCount: state.rateLimitedCount,
      overrunDisconnectCount: state.overrunDisconnectCount,
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
    state.controlFramesOut = 0;
    state.controlFramesDropped = 0;
    state.rateLimitedCount = 0;
    state.overrunDisconnectCount = 0;
  },
};
