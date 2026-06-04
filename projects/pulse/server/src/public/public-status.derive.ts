import type { MonitorStatus } from '../lib/schemas/events';
import type {
  PublicMonitor,
  PublicOverallStatus,
} from '../lib/schemas/public-status';

/**
 * Pure derivations for the public status page (Task 6.3) — unit-tested in
 * isolation (no IO). The service is the DB boundary; this is the logic.
 */

/**
 * Derive the page-level banner status from the public monitors' current
 * statuses (worst wins):
 *   - any `down`            -> `outage`
 *   - else any `degraded`   -> `degraded`
 *   - else (all up / null)  -> `operational`
 *
 * A `null` (never-checked) monitor does NOT downgrade the banner — it is simply
 * not yet contributing a status, the same neutral treatment the board uses.
 */
export function deriveOverallStatus(
  monitors: readonly { status: MonitorStatus | null }[],
): PublicOverallStatus {
  let sawDegraded = false;
  for (const m of monitors) {
    if (m.status === 'down') return 'outage';
    if (m.status === 'degraded') sawDegraded = true;
  }
  return sawDegraded ? 'degraded' : 'operational';
}

/**
 * Assert (at the type level + at runtime in tests) that a public monitor row
 * carries ONLY the published-safe fields. This is a belt-and-braces guard the
 * redaction test calls to prove no private key (responseTime, targetUrl,
 * userId, secret, error, interval, ...) ever appears on the public shape.
 *
 * Returns the list of UNEXPECTED keys (empty = clean).
 */
export function publicMonitorLeakedKeys(row: Record<string, unknown>): string[] {
  const allowed = new Set<keyof PublicMonitor>(['id', 'name', 'status', 'uptimePercent']);
  return Object.keys(row).filter((k) => !allowed.has(k as keyof PublicMonitor));
}
