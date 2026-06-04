import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AppConfigService } from '../config/app-config.service';
import { buildRedisOptions } from './redis.connection';

/** DI token for the shared application ioredis client. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Owns the shared ioredis client lifetime so the module can quit it on
 * shutdown. This client is for ordinary commands (`pingRedis`, the demo flag
 * later). The SSE bridge's SUBSCRIBER connection (ADR-003) must be a SEPARATE
 * connection — a subscriber cannot issue normal commands — and is created in
 * Phase 3, not here.
 */
class RedisConnection implements OnApplicationShutdown {
  constructor(readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * Global Redis module (ADR-002 / ADR-003). Provides the shared ioredis client
 * via `REDIS_CLIENT`. BullMQ's own connections are configured separately in
 * the QueuesModule from the same URL + options.
 */
@Global()
@Module({
  providers: [
    {
      provide: RedisConnection,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): RedisConnection =>
        new RedisConnection(new Redis(config.redisUrl, buildRedisOptions())),
    },
    {
      provide: REDIS_CLIENT,
      inject: [RedisConnection],
      useFactory: (conn: RedisConnection): Redis => conn.client,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
