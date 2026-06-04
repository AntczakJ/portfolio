import { Module } from '@nestjs/common';

import { EventsBridgeService } from './events-bridge.service';
import { PublicPageService } from './public-page.service';
import { StreamController } from './stream.controller';

/**
 * Stream / SSE module (Task 3.1, ADR-003) — the SUBSCRIBE side of the
 * worker -> SSE Redis bridge, on the WEB process only.
 *
 * Hosts:
 *   - `EventsBridgeService`: a DEDICATED ioredis subscriber on `pulse:events`
 *     (NOT the shared REDIS_CLIENT — a subscriber connection cannot run normal
 *     commands), validating each message against the shared `sseEventSchema`
 *     and fanning it into an RxJS subject + a per-scope 256-event ring buffer
 *     for `Last-Event-ID` replay.
 *   - `PublicPageService`: resolves a public status page slug to its published
 *     monitor set (the `public:<pageId>` filter).
 *   - `StreamController`: the two `@Sse()` routes — `GET /api/stream`
 *     (cookie-auth dashboard, full fidelity for the owner's monitors) and
 *     `GET /api/public/:slug/stream` (unauthenticated, redacted to status /
 *     incident transitions for the page's public monitors only).
 *
 * Imported by `AppModule` (the web process), NOT `WorkerModule` — the worker is
 * the PUBLISHER, this is the SUBSCRIBER/relay. The two processes share the
 * Redis channel, not an in-memory subject (the split is real, ADR-006).
 */
@Module({
  controllers: [StreamController],
  providers: [EventsBridgeService, PublicPageService],
  exports: [EventsBridgeService, PublicPageService],
})
export class StreamModule {}
