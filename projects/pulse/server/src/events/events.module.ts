import { Global, Module } from '@nestjs/common';

import { EventsPublisherService } from './events-publisher.service';

/**
 * Events module (Phase 2.5, ADR-003).
 *
 * Owns the worker-side publish into the `pulse:events` Redis channel — the
 * source the Phase 3 SSE bridge (the API/web process) subscribes to. Global
 * so the check recorder (and the Phase 5 incident engine) can inject the
 * publisher without re-importing. The SUBSCRIBE side (the bridge) is a Phase
 * 3.1 concern that lives in the `stream` module on the web process.
 */
@Global()
@Module({
  providers: [EventsPublisherService],
  exports: [EventsPublisherService],
})
export class EventsModule {}
