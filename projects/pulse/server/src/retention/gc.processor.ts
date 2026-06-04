import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';

import { GC_QUEUE } from '../redis/queue-names';
import { GcService } from './gc.service';

/**
 * GC processor (Task 2.4, ADR-005). Consumes the repeatable `gc` job (hourly)
 * and runs the batched retention sweep. A failure throws so BullMQ retries; the
 * sweep is idempotent (a row already pruned is a no-op) so a retry is safe.
 */
@Processor(GC_QUEUE)
export class GcProcessor extends WorkerHost {
  constructor(@Inject(GcService) private readonly gc: GcService) {
    super();
  }

  override async process(_job: Job): Promise<void> {
    await this.gc.sweep();
  }
}
