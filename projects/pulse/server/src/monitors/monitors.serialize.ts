import type { Monitor } from '../db/schema';
import type { MonitorResponse } from '../lib/schemas/monitor';

/**
 * Map a `monitors` DB row to the wire `MonitorResponse` shape (timestamps as
 * ISO strings, the exact field set the shared schema declares). Centralised so
 * every endpoint returns the identical, schema-valid shape.
 */
export function serializeMonitor(row: Monitor): MonitorResponse {
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.targetUrl,
    method: row.method,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    expectedStatus: row.expectedStatus,
    expectedKeyword: row.expectedKeyword,
    degradedThresholdMs: row.degradedThresholdMs,
    failureThreshold: row.failureThreshold,
    recoveryThreshold: row.recoveryThreshold,
    isPublic: row.isPublic,
    isPaused: row.isPaused,
    currentStatus: row.currentStatus,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
