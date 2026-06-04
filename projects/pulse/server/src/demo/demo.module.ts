import { Module } from '@nestjs/common';

import { DemoController } from './demo.controller';
import { DemoFlagService } from './demo-flag.service';

/**
 * Demo-incident module (Task 5.3, ADR-006) — WEB process.
 *
 * Hosts `GET /demo/flaky` (the owned endpoint the demo monitor probes), `POST
 * /demo/trigger` (arms the Redis flag), and `GET /demo/status` (inspect). The
 * flag is Redis-backed (the shared `REDIS_CLIENT`) so the worker that probes
 * agrees with the web that serves — the split-process truth (ADR-006).
 *
 * The routes are gated by `DEMO_TRIGGER_ENABLED`. `DemoFlagService` is exported
 * so a test / the future seed can arm/clear directly.
 */
@Module({
  controllers: [DemoController],
  providers: [DemoFlagService],
  exports: [DemoFlagService],
})
export class DemoModule {}
