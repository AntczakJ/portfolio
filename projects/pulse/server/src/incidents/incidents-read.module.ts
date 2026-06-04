import { Module } from '@nestjs/common';

import { MonitorsModule } from '../monitors/monitors.module';
import { IncidentsReadController } from './incidents-read.controller';
import { IncidentsReadService } from './incidents-read.service';

/**
 * Incidents READ module (Phase 5 read surface) — WEB process.
 *
 * Hosts the two incident-history read endpoints (`GET /incidents` and
 * `GET /monitors/:id/incidents`). It is deliberately SEPARATE from
 * `IncidentsModule` (worker-only, the incident ENGINE that writes rows): the
 * web process only READS incidents, so it carries no engine / alert-dispatch
 * dependencies.
 *
 * Imports `MonitorsModule` to reuse `MonitorsService.getOwned` for the
 * per-monitor ownership 404 (the same seam the CRUD + detail-read controllers
 * use). `DRIZZLE` is global.
 */
@Module({
  imports: [MonitorsModule],
  controllers: [IncidentsReadController],
  providers: [IncidentsReadService],
  exports: [IncidentsReadService],
})
export class IncidentsReadModule {}
