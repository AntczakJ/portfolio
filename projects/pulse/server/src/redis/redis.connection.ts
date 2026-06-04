import type { RedisOptions } from 'ioredis';

/**
 * Build the ioredis connection options BullMQ and the SSE bridge share
 * (ADR-002 / ADR-003).
 *
 * BullMQ REQUIRES `maxRetriesPerRequest: null` on its blocking connection
 * (the worker's `BRPOPLPUSH` would otherwise throw under a transient blip);
 * we set it on the shared options so every BullMQ connection is correct.
 *
 * We pass the URL through to ioredis as the host string and merge these
 * options; `@nestjs/bullmq` accepts `{ connection: { url, ...options } }`.
 */
export function buildRedisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Bounded reconnect backoff so a Redis blip does not spin hot.
    retryStrategy: (times: number): number => Math.min(times * 200, 2_000),
  };
}
