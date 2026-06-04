import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ChecksModule } from '../checks/checks.module';
import { ProbeModule } from '../probe/probe.module';
import { PROBE_QUEUE } from '../redis/queue-names';
import { ProbeProcessor } from './probe.processor';

/**
 * Probe worker module (Task 2.1 / 2.3, ADR-006) — WORKER-ONLY.
 *
 * Owns the actual BullMQ `@Processor(PROBE_QUEUE)` that consumes
 * `probe:<monitorId>` jobs. It pulls in the prober (`ProbeModule`) and the
 * check recorder (`ChecksModule`) and is imported ONLY by the WorkerModule, so
 * the web process never instantiates the worker. Re-registers the probe queue
 * so the processor binds to it.
 */
@Module({
  imports: [BullModule.registerQueue({ name: PROBE_QUEUE }), ProbeModule, ChecksModule],
  providers: [ProbeProcessor],
})
export class ProbeWorkerModule {}
