import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PROBE_QUEUE } from '../redis/queue-names';
import { ProbeSchedulerService } from './probe-scheduler.service';

/**
 * Probe scheduler module (ADR-002 / ADR-006) — the producer side of the probe
 * schedule, split out of MonitorsModule so BOTH process roles can own it
 * without dragging the HTTP CRUD surface across the split:
 *
 *   - the WEB process imports it (via MonitorsModule) so a create/edit/delete
 *     reconciles the monitor's repeatable schedule immediately;
 *   - the WORKER process imports it directly so its `OnModuleInit` boot
 *     reconciliation re-registers every monitor's schedule from the DB
 *     (source of truth) and sweeps orphans — the schedule survives a restart
 *     even if no mutation happens.
 *
 * Boot reconciliation is idempotent (stable `probe:<monitorId>` ids), so both
 * roles running it is safe; in the deployed split only one role needs to, but
 * keeping it in both is the self-healing posture ADR-002 wants. Re-registers
 * the probe queue so `@InjectQueue(PROBE_QUEUE)` resolves.
 */
@Module({
  imports: [BullModule.registerQueue({ name: PROBE_QUEUE })],
  providers: [ProbeSchedulerService],
  exports: [ProbeSchedulerService],
})
export class ProbeSchedulerModule {}
