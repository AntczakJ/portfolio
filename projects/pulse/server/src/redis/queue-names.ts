/**
 * BullMQ queue + Redis channel names (ADR-002 / ADR-003). Centralised so the
 * scheduler producer, the workers (Phase 2), and the SSE bridge (Phase 3)
 * agree on one vocabulary.
 */

/** The probe queue — one repeatable job per monitor (`probe:<monitorId>`). */
export const PROBE_QUEUE = 'probe';

/**
 * The hourly-rollup queue (ADR-005). Declared now; its repeatable job + worker
 * are wired in Phase 2. A trivial round-trip job verifies BullMQ today.
 */
export const ROLLUP_QUEUE = 'rollup';

/** The retention GC queue (ADR-005). Declared now; wired in Phase 2. */
export const GC_QUEUE = 'gc';

/**
 * The deterministic scheduler-id prefix for a monitor's repeatable probe job
 * (ADR-002). `reconcileMonitorSchedule` removes-then-adds by this id so the
 * remove is idempotent and the boot orphan-sweep is possible. Do NOT key the
 * job by `monitorId + interval` (the churn trap, AGENT_NOTES).
 */
export function probeJobSchedulerId(monitorId: string): string {
  return `probe:${monitorId}`;
}

/** The Redis Pub/Sub channel the worker publishes domain events to (ADR-003,
 * Phase 2/3). Declared here so the eventual bridge and worker share it. */
export const EVENTS_CHANNEL = 'pulse:events';
