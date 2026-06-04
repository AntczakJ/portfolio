import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';
import { EVENTS_CHANNEL } from '../redis/queue-names';
import {
  sseEventSchema,
  type AlertFiredEvent,
  type CheckResultEvent,
  type IncidentCloseEvent,
  type IncidentOpenEvent,
  type SseEvent,
  type StatusChangeEvent,
} from '../lib/schemas/events';

/**
 * Events publisher (Task 2.5, ADR-003) — the worker side of the worker -> SSE
 * Redis bridge.
 *
 * The worker and the SSE/API server are SEPARATE processes (ADR-006), so the
 * worker cannot push into the API's in-memory RxJS subject. Instead it
 * publishes every domain event as a JSON {@link SseEvent} envelope to the
 * Redis Pub/Sub channel `pulse:events`. Each API replica's `EventsBridge`
 * (Phase 3.1) holds a dedicated ioredis SUBSCRIBER on that channel, validates
 * with `sseEventSchema`, and relays to its connected `EventSource` clients
 * filtered by `scope`.
 *
 * `scope` is the routing key the Phase 3 SSE bridge needs to reach the right
 * dashboard / public stream — it carries the owning user (`dashboard:<userId>`).
 * The public status-page stream is fanned out by Phase 3 from the same events
 * (it derives the `public:<pageId>` view), so the worker emits the canonical
 * `dashboard:<userId>` scope here and the public bridge re-scopes.
 *
 * The publish is fire-and-forget by design (ADR-003): a missed event during a
 * Redis blip is reconciled by the client's REST refetch on reconnect, never
 * replayed from here. Postgres is the source of truth; this channel is the
 * live nudge.
 *
 * Each envelope carries a per-PROCESS monotonic `id` (the `Last-Event-ID`
 * cursor base). The authoritative per-scope ring buffer + resume live in the
 * Phase 3 bridge; the id here just gives every emitted event a stable,
 * increasing sequence within the worker process.
 */
@Injectable()
export class EventsPublisherService {
  private readonly logger = new Logger(EventsPublisherService.name);
  private sequence = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** `dashboard:<userId>` scope string (ADR-003 routing key). */
  private dashboardScope(userId: string): SseEvent['scope'] {
    return `dashboard:${userId}`;
  }

  /** Publish a `check.result` envelope (one per probe, the highest-volume event). */
  async publishCheckResult(ownerUserId: string, payload: CheckResultEvent): Promise<void> {
    await this.publish({ type: 'check.result', scope: this.dashboardScope(ownerUserId), payload });
  }

  /** Publish a `status.change` envelope (only on a derived-status transition). */
  async publishStatusChange(ownerUserId: string, payload: StatusChangeEvent): Promise<void> {
    await this.publish({ type: 'status.change', scope: this.dashboardScope(ownerUserId), payload });
  }

  /** Publish an `incident.open` envelope (Phase 5 incident engine reuses this). */
  async publishIncidentOpen(ownerUserId: string, payload: IncidentOpenEvent): Promise<void> {
    await this.publish({ type: 'incident.open', scope: this.dashboardScope(ownerUserId), payload });
  }

  /** Publish an `incident.close` envelope (Phase 5 incident engine reuses this). */
  async publishIncidentClose(ownerUserId: string, payload: IncidentCloseEvent): Promise<void> {
    await this.publish({ type: 'incident.close', scope: this.dashboardScope(ownerUserId), payload });
  }

  /**
   * Publish an `alert.fired` envelope (Phase 5.2 alerts module).
   *
   * DASHBOARD SCOPE ONLY — `alert.fired` is the owner's private alerting
   * telemetry and is NEVER public (the public-stream redaction drops it
   * regardless, ADR-003). It drives the dashboard toast that confirms a webhook
   * went out; it never carries the webhook secret (only the delivery metadata).
   */
  async publishAlertFired(ownerUserId: string, payload: AlertFiredEvent): Promise<void> {
    await this.publish({ type: 'alert.fired', scope: this.dashboardScope(ownerUserId), payload });
  }

  /**
   * Build, validate, and publish an envelope. Validation against the SHARED
   * `sseEventSchema` (the same file the web side's types come from) means a
   * malformed event cannot be published — the contract is enforced at the
   * emit boundary, not just the consume boundary. A publish failure is logged,
   * not thrown: the probe write already committed to Postgres (the source of
   * truth), and a dropped live nudge is reconciled by the client's REST
   * refetch (ADR-003 fire-and-forget).
   *
   * The input is a discriminated `{ type, payload }` pair (no `id`/`ts` — those
   * are stamped here) so the call sites stay type-correlated: a `check.result`
   * type only accepts a {@link CheckResultEvent} payload.
   */
  private async publish(
    input:
      | { type: 'check.result'; scope: SseEvent['scope']; payload: CheckResultEvent }
      | { type: 'status.change'; scope: SseEvent['scope']; payload: StatusChangeEvent }
      | { type: 'incident.open'; scope: SseEvent['scope']; payload: IncidentOpenEvent }
      | { type: 'incident.close'; scope: SseEvent['scope']; payload: IncidentCloseEvent }
      | { type: 'alert.fired'; scope: SseEvent['scope']; payload: AlertFiredEvent },
  ): Promise<void> {
    this.sequence += 1;
    const envelope = {
      id: this.sequence,
      type: input.type,
      ts: Date.now(),
      scope: input.scope,
      payload: input.payload,
    };

    const parsed = sseEventSchema.safeParse(envelope);
    if (!parsed.success) {
      // A failed validation is a programming error (the payload did not match
      // the contract) — log loudly so it surfaces in review, but do not crash
      // the worker over a telemetry event.
      this.logger.error(
        `refusing to publish malformed ${input.type} event: ${parsed.error.message}`,
      );
      return;
    }

    try {
      await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(parsed.data));
    } catch (err) {
      this.logger.warn(
        `failed to publish ${input.type} to ${EVENTS_CHANNEL}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
