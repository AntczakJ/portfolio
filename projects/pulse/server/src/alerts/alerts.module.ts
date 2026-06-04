import { Module } from '@nestjs/common';

import { AlertChannelsController } from './alert-channels.controller';
import { AlertChannelsService } from './alert-channels.service';

/**
 * Alerts CRUD module (Task 5.2) — WEB process.
 *
 * Hosts the alert-channels CRUD surface (`AlertChannelsController` +
 * `AlertChannelsService`) the frontend's alerts-config view consumes. This is a
 * pure HTTP read/write surface; it does NOT import the dispatch machinery
 * (`AlertsService` + the webhook/email dispatchers), which lives in
 * {@link AlertsDispatchModule} and runs WORKER-side (the incident engine, which
 * triggers dispatch, runs in the worker — ADR-006 split). Splitting the CRUD
 * from the dispatch keeps the web process free of the `EventsPublisherService`
 * (worker-only) it does not need.
 */
@Module({
  controllers: [AlertChannelsController],
  providers: [AlertChannelsService],
  exports: [AlertChannelsService],
})
export class AlertsModule {}
