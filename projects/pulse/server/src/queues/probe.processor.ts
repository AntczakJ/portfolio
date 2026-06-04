import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';

import { CheckRecorderService } from '../checks/check-recorder.service';
import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { monitors, type Monitor } from '../db/schema';
import { ProbeRunnerService } from '../probe/probe-runner.service';
import { PROBE_QUEUE } from '../redis/queue-names';

/** Worker tuning (ADR-002): concurrency 20, limiter 50/s. */
const PROBE_CONCURRENCY = 20;
const PROBE_LIMITER = { max: 50, duration: 1000 } as const;

interface ProbeJobData {
  monitorId: string;
}

/**
 * The probe processor (Task 2.1, ADR-002) — the BullMQ worker that consumes
 * `probe:<monitorId>` jobs. Replaces the Phase 1 stub.
 *
 * Flow per job:
 *   1. Re-read the monitor row by id (the payload is only `{ monitorId }`, so
 *      an edit to timeout / thresholds since the job was scheduled takes effect
 *      now — ADR-002).
 *   2. If the monitor is gone or paused, no-op (a benign race: the scheduler's
 *      remove and a queued occurrence can overlap; recording a result for a
 *      deleted monitor would orphan a row).
 *   3. Run the prober (HTTP execution + execution-time SSRF guard +
 *      classification). This NEVER throws for a target-side failure — a down
 *      endpoint returns a `down` outcome.
 *   4. Record the result (one idempotent `check_results` row + derived status +
 *      events).
 *
 * THE RETRY RULE (ADR-002): a failing target is a SUCCESSFUL job. BullMQ
 * `attempts`/`backoff` are reserved for INFRASTRUCTURE faults — the only way
 * this method throws is if step 1 or step 4 cannot reach Postgres, in which
 * case re-throwing lets BullMQ retry the OCCURRENCE (not a new probe). A down
 * target is never retried-as-if-broken, so the result count stays honest.
 *
 * Concurrency 20 + limiter 50/s (ADR-002) cap outbound probe pressure so a
 * burst of due monitors cannot open dozens of simultaneous sockets and trip a
 * small Fly machine.
 */
@Processor(PROBE_QUEUE, { concurrency: PROBE_CONCURRENCY, limiter: PROBE_LIMITER })
export class ProbeProcessor extends WorkerHost {
  private readonly logger = new Logger(ProbeProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(ProbeRunnerService) private readonly runner: ProbeRunnerService,
    @Inject(CheckRecorderService) private readonly recorder: CheckRecorderService,
  ) {
    super();
  }

  override async process(job: Job<ProbeJobData>): Promise<void> {
    const monitorId = job.data.monitorId;
    if (typeof monitorId !== 'string' || monitorId === '') {
      // A malformed job payload is a producer bug, not an infra fault — log and
      // succeed so BullMQ does not retry a job that can never make progress.
      this.logger.warn(`probe job ${job.id ?? '?'} has no monitorId — skipping`);
      return;
    }

    // 1. Re-read the monitor (DB fault here -> throw -> BullMQ retry).
    const monitor = await this.loadMonitor(monitorId);

    // 2. Gone or paused? No-op (benign scheduler/occurrence race).
    if (!monitor) {
      this.logger.debug(`probe job for ${monitorId}: monitor not found — skipping`);
      return;
    }
    if (monitor.isPaused) {
      this.logger.debug(`probe job for ${monitorId}: monitor paused — skipping`);
      return;
    }

    // 3. Run the probe. NEVER throws for a target-side failure (down/timeout/
    //    keyword/ssrf are all `down` outcomes), so a down target is a success.
    const outcome = await this.runner.run(monitor);

    // 4. Record exactly one result + derive status + publish events. A DB fault
    //    here throws -> BullMQ retries the occurrence (infra fault, ADR-002).
    await this.recorder.record(monitor, outcome);
  }

  private async loadMonitor(monitorId: string): Promise<Monitor | null> {
    const [row] = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1);
    return row ?? null;
  }
}
