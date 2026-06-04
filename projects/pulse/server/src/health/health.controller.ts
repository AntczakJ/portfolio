import { Controller, Get, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { pingDb } from '../db/health';
import { COMMIT_SHA } from '../lib/commit';
import { healthResponseSchema, type HealthResponse } from '../lib/schemas/health';
import { REDIS_CLIENT } from '../redis/redis.module';
import { pingRedis } from '../redis/redis.health';

/**
 * `GET /health` (Task 1.1 + 1.2 + 1.3).
 *
 * Returns `{ status, commit, ts, db, redis }`. `status` is `ok` only when
 * both Postgres and Redis are healthy, else `degraded` (still HTTP 200 — a
 * liveness probe reports state, it does not refuse; the tolerant posture meld
 * uses). The response is validated against `healthResponseSchema` BEFORE it
 * leaves the boundary, so the contract is enforced, not merely documented.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async health(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([pingDb(this.db), pingRedis(this.redis)]);

    const payload: HealthResponse = {
      status: db.connected && redis.connected ? 'ok' : 'degraded',
      commit: COMMIT_SHA,
      ts: new Date().toISOString(),
      db,
      redis,
    };

    // Validate at the boundary — a drift in the shape is a server bug we want
    // to surface immediately, not ship.
    return healthResponseSchema.parse(payload);
  }
}
