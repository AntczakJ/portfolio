import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { buildRedisOptions } from '../redis/redis.connection';
import { GC_QUEUE, PROBE_QUEUE, ROLLUP_QUEUE } from '../redis/queue-names';

/**
 * BullMQ root wiring (Task 1.3, ADR-002/ADR-005/ADR-006).
 *
 * This module ONLY configures the shared connection + registers the queue
 * VOCABULARY (probe / rollup / gc). It deliberately registers NO processors —
 * the process split (ADR-006, Task 2.3) means:
 *   - the WEB process imports this module as a PRODUCER (the monitors scheduler
 *     calls `upsertJobScheduler` on the probe queue; it never consumes jobs);
 *   - the WORKER process imports this module AND the worker-side modules
 *     (`ProbeWorkerModule`, `RetentionModule`) that own the actual
 *     `@Processor` workers.
 * Keeping the processors out of this shared module is what guarantees the web
 * process does NOT process jobs (and the worker does NOT serve HTTP).
 *
 * `forRootAsync` sets the BullMQ-required `maxRetriesPerRequest: null`.
 * Exporting BullModule re-exports the registered queue providers so importing
 * modules can `@InjectQueue(...)`.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: { url: config.redisUrl, ...buildRedisOptions() },
      }),
    }),
    BullModule.registerQueue(
      { name: PROBE_QUEUE },
      { name: ROLLUP_QUEUE },
      { name: GC_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
