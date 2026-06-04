import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { monitors } from '../db/schema';
import { PROBE_QUEUE, probeJobSchedulerId } from '../redis/queue-names';

/**
 * The scheduler producer side of ADR-002 — the remove-then-add reconciliation
 * seam, plus the `OnModuleInit` boot reconciliation against the DB as source
 * of truth.
 *
 * This is REAL reconciliation logic, not a stub: the deterministic scheduler
 * id `probe:<monitorId>` + `upsertJobScheduler` make the mapping idempotent
 * and the boot orphan-sweep possible (AGENT_NOTES "the churn trap" — never key
 * by `monitorId + interval`, never rely on BullMQ's implicit repeat-key
 * dedupe). The CONSUMER of these scheduled jobs — the actual prober — is
 * Phase 2.1; in Phase 1 the stub ProbeProcessor logs them, which is enough to
 * prove the producer side end-to-end.
 *
 * BullMQ note: `upsertJobScheduler(id, { every }, template)` both creates and
 * updates by id, so a changed interval re-registers cleanly with no stale
 * repeatable left behind — that is exactly the remove-then-add semantics
 * ADR-002 wants, expressed through the id-keyed upsert API.
 */
@Injectable()
export class ProbeSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ProbeSchedulerService.name);

  constructor(
    @InjectQueue(PROBE_QUEUE) private readonly probeQueue: Queue,
    @Inject(DRIZZLE) private readonly db: PulseDb,
  ) {}

  /**
   * Boot reconciliation (ADR-002): the DB is the source of truth. Every
   * non-paused monitor must have its repeatable job; every scheduler with no
   * live, non-paused monitor behind it is an orphan and is swept. Idempotent —
   * safe to run on every boot.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.reconcileAll();
    } catch (err) {
      // Boot reconciliation must not crash the process — log loudly and let
      // the next mutation / restart retry. A monitor missing its schedule is
      // recoverable; a crash-loop is not.
      this.logger.error(
        `boot reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Reconcile the whole probe schedule against the monitors table. */
  async reconcileAll(): Promise<void> {
    const rows = await this.db.select().from(monitors);
    const liveById = new Map(rows.filter((m) => !m.isPaused).map((m) => [m.id, m]));

    // Add / update every live monitor's schedule.
    for (const monitor of liveById.values()) {
      await this.upsertSchedule(monitor.id, monitor.intervalSeconds);
    }

    // Sweep orphans: any existing scheduler whose monitor is gone or paused.
    const existing = await this.probeQueue.getJobSchedulers(0, -1);
    let swept = 0;
    for (const scheduler of existing) {
      // `key` is the scheduler id we passed to upsertJobScheduler
      // (`probe:<monitorId>`).
      const id = scheduler.key;
      const monitorId = id.startsWith('probe:') ? id.slice('probe:'.length) : null;
      if (monitorId === null || !liveById.has(monitorId)) {
        await this.probeQueue.removeJobScheduler(id);
        swept += 1;
      }
    }

    this.logger.log(
      `probe schedule reconciled: ${String(liveById.size)} active, ${String(swept)} orphan(s) swept`,
    );
  }

  /**
   * The per-mutation seam called by the monitors service on create / update /
   * resume. Remove-then-add expressed as an id-keyed upsert.
   */
  async reconcileMonitorSchedule(monitorId: string): Promise<void> {
    const [monitor] = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1);

    if (!monitor || monitor.isPaused) {
      await this.removeSchedule(monitorId);
      return;
    }
    await this.upsertSchedule(monitor.id, monitor.intervalSeconds);
  }

  /** Remove a monitor's schedule (pause / delete). Idempotent. */
  async removeSchedule(monitorId: string): Promise<void> {
    const id = probeJobSchedulerId(monitorId);
    await this.probeQueue.removeJobScheduler(id);
    this.logger.log(`removed probe schedule ${id}`);
  }

  private async upsertSchedule(monitorId: string, intervalSeconds: number): Promise<void> {
    const id = probeJobSchedulerId(monitorId);
    await this.probeQueue.upsertJobScheduler(
      id,
      { every: intervalSeconds * 1000 },
      {
        name: 'probe',
        // Payload is ONLY { monitorId } — the worker re-reads the row at run
        // time so an edit to timeout / thresholds takes effect on the next
        // run without re-touching the queue (ADR-002).
        data: { monitorId },
        opts: {
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
          // attempts/backoff are for INFRASTRUCTURE faults ONLY (ADR-002) —
          // e.g. the worker cannot reach Postgres to record the row. A down
          // TARGET is a successful job recording `down` and is never retried,
          // so these retries never inflate the result count. 2 attempts, fixed
          // 2 s backoff.
          attempts: 2,
          backoff: { type: 'fixed', delay: 2000 },
        },
      },
    );
    this.logger.log(`upserted probe schedule ${id} every=${String(intervalSeconds)}s`);
  }
}
