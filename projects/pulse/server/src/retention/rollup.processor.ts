import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ROLLUP_QUEUE } from '../redis/queue-names';
import { RollupService } from './rollup.service';

/**
 * Rollup processor (Task 2.4, ADR-005). Consumes the repeatable `rollup` job
 * (every 5 min) and recomputes the recent hourly buckets via the idempotent
 * upsert. A failure throws so BullMQ retries (the next 5-min tick would also
 * recover it, but a transient DB blip is worth one retry).
 */
@Processor(ROLLUP_QUEUE)
export class RollupProcessor extends WorkerHost {
  constructor(@Inject(RollupService) private readonly rollup: RollupService) {
    super();
  }

  override async process(_job: Job): Promise<void> {
    await this.rollup.rollupRecentHours();
  }
}
