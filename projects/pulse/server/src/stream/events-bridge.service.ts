import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { Subject, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';
import { buildRedisOptions } from '../redis/redis.connection';
import { EVENTS_CHANNEL } from '../redis/queue-names';
import { sseEventSchema, type SseEvent } from '../lib/schemas/events';

/**
 * Max events retained per scope for `Last-Event-ID` replay (ADR-003). A short
 * ring; a longer disconnect reconciles via a REST refetch on the client side
 * (Pub/Sub is fire-and-forget — Postgres is the source of truth).
 */
const RING_BUFFER_SIZE = 256;

/**
 * EventsBridgeService — the worker -> SSE bridge (Task 3.1, ADR-003), the
 * SUBSCRIBE side of the `pulse:events` channel.
 *
 * The worker process publishes every domain event as a JSON {@link SseEvent}
 * envelope to the Redis channel `pulse:events` (Phase 2.5). The worker and this
 * (web) process are SEPARATE (ADR-006), so the worker cannot push into an
 * in-memory subject the web holds — Redis Pub/Sub IS the spine.
 *
 * This service:
 *   1. Opens a DEDICATED ioredis SUBSCRIBER connection (NOT the shared
 *      `REDIS_CLIENT` / BullMQ connection — a connection in subscriber mode
 *      cannot issue normal commands; reusing one would break either the
 *      subscription or every other Redis command in the process).
 *   2. Validates each received message against the SHARED `sseEventSchema` at
 *      the boundary (a malformed / spoofed message is dropped, never relayed).
 *   3. Fans every valid envelope into an in-process RxJS `Subject<SseEvent>`
 *      the two `@Sse()` routes subscribe to and filter by scope.
 *   4. Maintains a small per-scope RING BUFFER (256 events) so a reconnecting
 *      `EventSource` that sends `Last-Event-ID` can replay the events it missed
 *      during a brief gap before resuming live.
 *
 * Because the SOURCE is Redis Pub/Sub, scaling the web tier to N replicas is a
 * config change, not a redesign — every replica subscribes and relays to its
 * own connected clients.
 */
@Injectable()
export class EventsBridgeService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(EventsBridgeService.name);

  /** The dedicated subscriber connection (subscriber-mode only). */
  private subscriber: Redis | null = null;

  /** The in-process fan-out the SSE routes subscribe to. */
  private readonly subject = new Subject<SseEvent>();

  /**
   * Per-scope ring buffer of the most recent envelopes, keyed by `scope`.
   * Each entry is kept newest-last, capped at RING_BUFFER_SIZE.
   */
  private readonly ringByScope = new Map<string, SseEvent[]>();

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** The live event stream every SSE route filters by scope. */
  get events$(): Observable<SseEvent> {
    return this.subject.asObservable();
  }

  async onModuleInit(): Promise<void> {
    // A SEPARATE connection from the shared client (ADR-003 / AGENT_NOTES): once
    // `subscribe()` is called ioredis puts this connection into subscriber mode,
    // where ordinary commands are rejected. The shared REDIS_CLIENT must stay
    // command-capable for health pings / the demo flag, so the bridge owns its
    // own connection.
    this.subscriber = new Redis(this.config.redisUrl, buildRedisOptions());

    this.subscriber.on('error', (err: Error) => {
      // ioredis auto-reconnects (bounded backoff in buildRedisOptions); log so a
      // persistent Redis outage is visible, but do not crash the web process —
      // the board degrades to "no live updates" and reconciles via REST.
      this.logger.warn(`pulse:events subscriber error: ${err.message}`);
    });

    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== EVENTS_CHANNEL) return;
      this.ingest(raw);
    });

    await this.subscriber.subscribe(EVENTS_CHANNEL);
    this.logger.log(
      `subscribed to ${EVENTS_CHANNEL} (dedicated subscriber connection)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.subject.complete();
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch {
        // Best-effort; the process is going down anyway.
        this.subscriber.disconnect();
      }
      this.subscriber = null;
    }
  }

  /**
   * Parse + validate one raw Pub/Sub message and fan it out. VALIDATION AT THE
   * BOUNDARY is the security/contract gate: anything that is not a well-formed
   * envelope (bad JSON, unknown event type, missing scope) is dropped here and
   * never reaches a client. This is the same `sseEventSchema` the web side's
   * types come from, so the relayed shape cannot drift from the contract.
   *
   * Exposed (not private) so the bridge unit test can drive ingestion without a
   * live Redis — the test feeds raw JSON strings exactly as the `message`
   * handler would.
   */
  ingest(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.logger.warn('dropped a non-JSON message on pulse:events');
      return;
    }

    const parsed = sseEventSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        `dropped a malformed pulse:events envelope: ${parsed.error.message}`,
      );
      return;
    }

    const event = parsed.data;
    this.pushToRing(event);
    this.subject.next(event);
  }

  /**
   * Replay the buffered events for `scope` that are strictly newer than
   * `lastEventId` (the `Last-Event-ID` cursor), oldest-first. Events older than
   * the ring are NOT replayed — a long disconnect reconciles via the client's
   * REST refetch on `EventSource` open (ADR-003).
   *
   * The cursor is the envelope `id` (a per-worker-process monotonic sequence).
   * It is interpreted PER SCOPE, which is exactly how the routes consume it.
   */
  replayAfter(scope: string, lastEventId: number): SseEvent[] {
    const ring = this.ringByScope.get(scope);
    if (!ring) return [];
    return ring.filter((e) => e.id > lastEventId);
  }

  /** Append an event to its scope's ring buffer, capped at RING_BUFFER_SIZE. */
  private pushToRing(event: SseEvent): void {
    let ring = this.ringByScope.get(event.scope);
    if (!ring) {
      ring = [];
      this.ringByScope.set(event.scope, ring);
    }
    ring.push(event);
    if (ring.length > RING_BUFFER_SIZE) {
      // Drop the oldest; the ring keeps only the most recent window.
      ring.splice(0, ring.length - RING_BUFFER_SIZE);
    }
  }
}
