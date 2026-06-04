import type { Redis } from 'ioredis';

import type { DependencyHealth } from '../lib/schemas/health';

const REDIS_PING_TIMEOUT_MS = 200;

/**
 * Ping Redis with a bounded-latency `PING` (Task 1.3).
 *
 * Tolerant, same posture as `pingDb` — `/health` reports state, never
 * refuses. Never throws; measures latency even on failure.
 */
export async function pingRedis(
  client: Redis,
  timeoutMs: number = REDIS_PING_TIMEOUT_MS,
): Promise<DependencyHealth> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('redis ping timed out'));
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
