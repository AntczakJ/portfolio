import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { EventsModule } from './events/events.module';
import { ProbeSchedulerModule } from './monitors/probe-scheduler.module';
import { ProbeWorkerModule } from './queues/probe-worker.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { RetentionModule } from './retention/retention.module';

/**
 * WORKER process root module (ADR-006 split — Task 2.3).
 *
 * The `worker` process runs the BullMQ workers + the rollup/GC repeatables and
 * publishes domain events to `pulse:events` (the worker side of the SSE Redis
 * bridge, ADR-003) — all WITHOUT the HTTP server. It is booted as a standalone
 * Nest application context (no `listen()`), so no controllers / routes exist
 * here.
 *
 * It imports:
 *   - the global infra (config / db / redis / queues) — its own small DB pool
 *     and Redis connections;
 *   - `EventsModule` — the publisher (only the worker publishes; the web
 *     process holds the SUBSCRIBER side in Phase 3);
 *   - `ProbeWorkerModule` — the `@Processor(probe)` worker (prober + recorder);
 *   - `RetentionModule` — the rollup + GC processors + their repeatable-job
 *     registration (`OnModuleInit`);
 *   - `ProbeSchedulerModule` — so the worker's boot reconciliation re-registers
 *     every monitor's repeatable probe schedule from the DB (source of truth)
 *     and sweeps orphans.
 *
 * It does NOT import HealthModule / MonitorsModule (the HTTP CRUD surface) /
 * StreamModule / AuthModule / PublicModule — those are the web process's job.
 */
@Module({
  imports: [
    AppConfigModule,
    DbModule,
    RedisModule,
    QueuesModule,
    EventsModule,
    ProbeSchedulerModule,
    ProbeWorkerModule,
    RetentionModule,
  ],
})
export class WorkerModule {}
