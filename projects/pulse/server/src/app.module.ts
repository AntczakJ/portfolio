import { Module } from '@nestjs/common';

import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { DemoModule } from './demo/demo.module';
import { HealthModule } from './health/health.module';
import { IncidentsReadModule } from './incidents/incidents-read.module';
import { MonitorsModule } from './monitors/monitors.module';
import { PublicModule } from './public/public.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { RootModule } from './root/root.module';
import { StreamModule } from './stream/stream.module';

/**
 * WEB process root module (ADR-006 split — Task 2.3).
 *
 * The `web` process serves HTTP (CRUD, health, and later the two `@Sse()`
 * routes + better-auth) and acts as a QUEUE PRODUCER (the monitors scheduler
 * registers per-monitor repeatable probe jobs and reconciles them on
 * mutation). It does NOT process jobs: it imports neither `ProbeWorkerModule`
 * nor `RetentionModule`, so no `@Processor` worker is instantiated here.
 *
 * The WORKER process boots `WorkerModule` instead (worker.ts), which runs the
 * BullMQ workers + the rollup/GC repeatables WITHOUT the HTTP server.
 *
 * Global infrastructure (config, db, redis, queues) is imported once; `@Global`
 * on those modules makes their providers available to every feature module.
 */
@Module({
  imports: [
    // --- shared / core (global) ---
    AppConfigModule,
    DbModule,
    RedisModule,
    QueuesModule,
    // Auth is @Global so CurrentOwnerService / AuthService are injectable in
    // every feature module (the owner-resolution seam + the better-auth
    // surface). Imported before the feature modules that depend on it.
    AuthModule,

    // --- web live surface ---
    RootModule,
    HealthModule,
    MonitorsModule,
    // Phase 5 read surface: the incident-history endpoints (GET /incidents,
    // GET /monitors/:id/incidents). Read-only; separate from the worker-side
    // incident ENGINE (IncidentsModule).
    IncidentsReadModule,

    // --- Phase 5: alerts CRUD + the demo-incident trigger (web side) ---
    // The incident ENGINE + alert DISPATCH run worker-side (the recorder path);
    // the web process hosts only the alert-channels CRUD and the demo routes.
    AlertsModule,
    DemoModule,

    // --- Phase 6: the public read surface + the live SSE stream ---
    StreamModule,
    PublicModule,
  ],
})
export class AppModule {}
