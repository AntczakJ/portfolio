import { Module } from '@nestjs/common';

import { MonitorReadController } from './monitor-read.controller';
import { MonitorReadService } from './monitor-read.service';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';
import { ProbeSchedulerModule } from './probe-scheduler.module';

/**
 * Monitors module (Task 1.5 + Phase 4.2). Owns the CRUD surface AND the
 * monitor-detail read surface (uptime / series / history / recent-checks,
 * ADR-004). The scheduler-reconcile seam (ADR-002) lives in
 * ProbeSchedulerModule so the worker process can own boot reconciliation
 * without importing the HTTP controller (ADR-006 split). MonitorsModule (web)
 * re-exports the scheduler so the service can reconcile on every mutation.
 */
@Module({
  imports: [ProbeSchedulerModule],
  controllers: [MonitorsController, MonitorReadController],
  providers: [MonitorsService, MonitorReadService],
  exports: [MonitorsService, MonitorReadService, ProbeSchedulerModule],
})
export class MonitorsModule {}
