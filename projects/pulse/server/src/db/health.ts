import { sql as dsql } from 'drizzle-orm';

import type { PulseDb } from './drizzle';
import type { DependencyHealth } from '../lib/schemas/health';

const DB_PING_TIMEOUT_MS = 200;

/**
 * Ping Postgres with a bounded-latency `SELECT 1` (Task 1.2).
 *
 * Tolerant by design (mirrors meld's `pingDb`): `/health` reports state, it
 * never refuses. Never throws — returns `{ connected: false, latencyMs }` on
 * timeout or error. We measure latency even on the failure path so a slow DB
 * reads differently from a gone DB.
 */
export async function pingDb(
  db: PulseDb,
  timeoutMs: number = DB_PING_TIMEOUT_MS,
): Promise<DependencyHealth> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(dsql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('db ping timed out'));
        }, timeoutMs);
      }),
    ]);
    return { connected: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { connected: false, latencyMs: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(timer);
  }
}
