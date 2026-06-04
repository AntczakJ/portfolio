import { Module } from '@nestjs/common';

import { IncidentsModule } from '../incidents/incidents.module';
import { CheckRecorderService } from './check-recorder.service';

/**
 * Checks module (Phase 2.2 / Phase 4 read surface / Phase 5 incident hook).
 *
 * Phase 2 lands the WRITE path: `CheckRecorderService` records one
 * `check_results` row per probe, derives + persists the monitor's live status,
 * detects a transition, and publishes the `check.result` / `status.change`
 * events (ADR-002 / ADR-003 / ADR-004). Phase 5 hooks the incident engine onto
 * the same path: after recording, the recorder calls
 * `IncidentEngineService.onCheckRecorded` to drive the N/M debounce, open/close
 * incidents, and fire alerts. `EventsPublisherService` comes from the global
 * EventsModule, `DRIZZLE` from the global DbModule, the engine from
 * `IncidentsModule` (worker-side).
 */
@Module({
  imports: [IncidentsModule],
  providers: [CheckRecorderService],
  exports: [CheckRecorderService],
})
export class ChecksModule {}
