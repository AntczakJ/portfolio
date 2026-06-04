import { Module } from '@nestjs/common';

import { AlertsDispatchModule } from '../alerts/alerts-dispatch.module';
import { IncidentEngineService } from './incident-engine.service';

/**
 * Incidents module (Phase 5.1) — WORKER process.
 *
 * Hosts the incident engine — the IO boundary around the pure reducer
 * (`incident-reducer.ts`, ADR-004). The engine is injected by
 * `CheckRecorderService` (via `ChecksModule`) and runs after each result is
 * recorded: it rehydrates the reducer state from the DB, applies the pure
 * reducer, persists `incidents` rows (single-open enforced by the partial-
 * unique index AND the reducer), publishes `incident.open`/`incident.close`
 * events, and fires alerts via `AlertsDispatchModule`'s `AlertsService`.
 *
 * Worker-only: the engine consumes the recorder's write path (worker-side) and
 * needs the global `EventsPublisherService` (worker) + `AlertsService`
 * (worker). The web process never instantiates it. `DRIZZLE` is global.
 */
@Module({
  imports: [AlertsDispatchModule],
  providers: [IncidentEngineService],
  exports: [IncidentEngineService],
})
export class IncidentsModule {}
