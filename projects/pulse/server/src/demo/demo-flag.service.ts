import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * The demo-incident flag (Task 5.3, ADR-006).
 *
 * The wow moment is reproducible on demand via an OWNED flaky endpoint
 * (`GET /demo/flaky`) whose health is toggled by a REDIS-backed flag. Redis is
 * the shared truth because the WEB process serves `/demo/flaky` + `/demo/trigger`
 * and the WORKER process probes the demo monitor — they are separate processes
 * (ADR-006), so an in-memory flag would not agree across them.
 *
 * `POST /demo/trigger` sets the flag with a TTL; `/demo/flaky` reads it to
 * decide 200 vs 500; the flag auto-expires so the endpoint recovers and the
 * incident auto-closes — the full open -> alert -> recover -> close arc, all
 * through the REAL probe pipeline.
 *
 * The flag is a single Redis key with a TTL — setting it is naturally
 * idempotent (a second `POST /demo/trigger` while it is already failing just
 * refreshes the TTL, so spamming the button is safe and the arc does not
 * double-open: the single-open invariant + the de-dup constraint hold).
 */
@Injectable()
export class DemoFlagService {
  private readonly logger = new Logger(DemoFlagService.name);
  /** The Redis key the web reads to serve `/demo/flaky` and the worker probes. */
  private readonly key = 'pulse:demo:flaky-failing';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** `true` while the demo endpoint should be failing (the flag is set). */
  async isFailing(): Promise<boolean> {
    const value = await this.redis.get(this.key);
    return value !== null;
  }

  /**
   * Arm the demo: make `/demo/flaky` fail for `durationSeconds`, then auto-clear
   * (the Redis TTL recovers it). Idempotent — calling again refreshes the TTL.
   * Returns the remaining TTL so the caller can report when recovery happens.
   */
  async arm(durationSeconds: number): Promise<number> {
    await this.redis.set(this.key, '1', 'EX', durationSeconds);
    this.logger.log(`demo flaky endpoint ARMED to fail for ${String(durationSeconds)}s`);
    return durationSeconds;
  }

  /** Force an immediate recovery (clear the flag). Used by tests / an all-clear. */
  async clear(): Promise<void> {
    await this.redis.del(this.key);
    this.logger.log('demo flaky endpoint CLEARED (recovered)');
  }

  /** Remaining seconds the flag is armed for, or 0 if not armed. */
  async remainingSeconds(): Promise<number> {
    const ttl = await this.redis.ttl(this.key);
    return ttl > 0 ? ttl : 0;
  }
}
