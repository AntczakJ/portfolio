import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { GC_QUEUE, ROLLUP_QUEUE } from '../redis/queue-names';

/** Rollup cadence: every 5 minutes (ADR-005). */
const ROLLUP_EVERY_MS = 5 * 60 * 1000;
/** GC cadence: hourly (ADR-005). */
const GC_EVERY_MS = 60 * 60 * 1000;

/** Deterministic singleton scheduler ids (one repeatable each, not per-monitor). */
const ROLLUP_SCHEDULER_ID = 'rollup:hourly';
const GC_SCHEDULER_ID = 'gc:retention';

/**
 * Retention scheduler (Task 2.4, ADR-005) — registers the two singleton
 * repeatable jobs (rollup every 5 min, GC hourly) in the WORKER process's
 * `OnModuleInit`, alongside the per-monitor probe schedules.
 *
 * Like the probe scheduler, it uses a STABLE scheduler id per job
 * (`upsertJobScheduler`), so re-running on every boot is idempotent and a
 * cadence change re-registers cleanly with no stale repeatable left behind
 * (the same churn-trap avoidance ADR-002 pins for probes).
 *
 * These jobs run ONLY in the worker process (ADR-006). The web process boots
 * without this module, so it neither registers nor consumes them.
 */
@Injectable()
export class RetentionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(RetentionSchedulerService.name);

  constructor(
    @InjectQueue(ROLLUP_QUEUE) private readonly rollupQueue: Queue,
    @InjectQueue(GC_QUEUE) private readonly gcQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.rollupQueue.upsertJobScheduler(
        ROLLUP_SCHEDULER_ID,
        { every: ROLLUP_EVERY_MS },
        {
          name: 'rollup',
          opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
        },
      );
      await this.gcQueue.upsertJobScheduler(
        GC_SCHEDULER_ID,
        { every: GC_EVERY_MS },
        {
          name: 'gc',
          opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
        },
      );
      this.logger.log(
        `retention schedules registered: rollup every ${String(ROLLUP_EVERY_MS / 1000)}s, gc every ${String(GC_EVERY_MS / 1000)}s`,
      );
    } catch (err) {
      // Registration must not crash the worker — the next boot retries.
      this.logger.error(
        `retention schedule registration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
