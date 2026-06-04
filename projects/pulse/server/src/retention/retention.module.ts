import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { GC_QUEUE, ROLLUP_QUEUE } from '../redis/queue-names';
import { GcProcessor } from './gc.processor';
import { GcService } from './gc.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { RollupProcessor } from './rollup.processor';
import { RollupService } from './rollup.service';

/**
 * Retention module (Task 2.4, ADR-005) — the rollup + GC jobs.
 *
 * WORKER-ONLY: it provides the two repeatable-job processors (rollup, gc) and
 * the scheduler that registers them on boot. It is imported by the
 * WorkerModule, NOT the web AppModule, so the web process never runs these
 * jobs (ADR-006 split). Re-registers the rollup/gc queues so
 * `@InjectQueue(...)` resolves inside the scheduler.
 */
@Module({
  imports: [BullModule.registerQueue({ name: ROLLUP_QUEUE }, { name: GC_QUEUE })],
  providers: [
    RollupService,
    GcService,
    RollupProcessor,
    GcProcessor,
    RetentionSchedulerService,
  ],
  exports: [RollupService, GcService],
})
export class RetentionModule {}
