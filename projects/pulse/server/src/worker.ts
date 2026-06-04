import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { COMMIT_SHA } from './lib/commit';
import { WorkerModule } from './worker.module';

/**
 * pulse-server WORKER entrypoint (Task 2.3, ADR-006).
 *
 * Boots the worker as a STANDALONE Nest application context — no HTTP server,
 * no `listen()`. It runs the BullMQ workers (probe / rollup / gc) and registers
 * the repeatable jobs in their modules' `OnModuleInit`. The same Docker image
 * starts either process via the start command:
 *   - web:    node --import tsx src/main.ts
 *   - worker: node --import tsx src/worker.ts
 *
 * Shutdown hooks are enabled so the DB pool + Redis + BullMQ connections drain
 * gracefully on SIGTERM/SIGINT (no half-processed job, no leaked socket).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  // Keep the process alive: the application context holds the BullMQ workers,
  // which keep the event loop busy. We do not exit — the workers run until a
  // signal triggers the shutdown hooks.
  new Logger('WorkerBootstrap').log(
    `pulse-worker (commit ${COMMIT_SHA}) started — BullMQ probe/rollup/gc workers running. ` +
      'No HTTP server (worker process, ADR-006).',
  );
}

void bootstrap();
