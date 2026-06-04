import { Module } from '@nestjs/common';

import { AlertsService } from './alerts.service';
import { EmailDispatcher } from './email-dispatcher';
import { WebhookDispatcher } from './webhook-dispatcher';

/**
 * Alerts DISPATCH module (Task 5.2) — WORKER process.
 *
 * Hosts the single `AlertsService` orchestrator + the two channel
 * implementations sharing the `AlertDispatcher` interface: `WebhookDispatcher`
 * (REAL, HMAC-signed) and `EmailDispatcher` (MOCKED). The incident engine
 * (`IncidentEngineService`, also worker-side) injects `AlertsService` to fire a
 * delivery on an incident open / close.
 *
 * Worker-only because dispatch needs `EventsPublisherService` (the global
 * worker-side publisher) to emit `alert.fired`, and because the incident engine
 * that calls it runs in the worker (the recorder path). The CRUD surface is a
 * separate web-side module ({@link AlertsModule}).
 */
@Module({
  providers: [AlertsService, WebhookDispatcher, EmailDispatcher],
  exports: [AlertsService],
})
export class AlertsDispatchModule {}
