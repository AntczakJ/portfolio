import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import {
  alertChannels,
  alertDeliveries,
  type AlertChannel,
  type Incident,
  type Monitor,
} from '../db/schema';
import { EventsPublisherService } from '../events/events-publisher.service';
import type { AlertTransition } from '../lib/schemas/events';
import type { AlertDispatcher } from './alert-dispatcher';
import { EmailDispatcher } from './email-dispatcher';
import { WebhookDispatcher } from './webhook-dispatcher';

/**
 * Alerts orchestration (Task 5.2, ADR-005).
 *
 * `dispatchForTransition(monitor, incident, transition)` is the single entry the
 * incident engine calls on an incident open / close. It:
 *   1. Loads the monitor owner's ENABLED alert channels.
 *   2. For each channel, enforces DE-DUP at the DB by attempting to INSERT the
 *      `alert_deliveries` row FIRST (the unique `(incident_id, channel_id,
 *      transition)` constraint). If the insert is a no-op (already present), the
 *      transition was already fired for this channel — skip it. This makes the
 *      "one alert per (incident, channel, transition)" rule un-violable even
 *      under a retry / race (ADR-005), because the DB, not app code, is the
 *      gate.
 *   3. Dispatches via the channel's {@link AlertDispatcher} (webhook REAL /
 *      email MOCKED), updates the recorded row with the result, and publishes
 *      an `alert.fired` event — DASHBOARD SCOPE ONLY (never public).
 *
 * The de-dup-by-insert-first order matters: inserting the placeholder row
 * BEFORE the network call means a concurrent second attempt loses the unique
 * race and never double-sends, even if the first send is still in flight.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly dispatchers: Map<AlertChannel['type'], AlertDispatcher>;

  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(EventsPublisherService) private readonly events: EventsPublisherService,
    @Inject(WebhookDispatcher) webhook: WebhookDispatcher,
    @Inject(EmailDispatcher) email: EmailDispatcher,
  ) {
    this.dispatchers = new Map<AlertChannel['type'], AlertDispatcher>([
      [webhook.channelType, webhook],
      [email.channelType, email],
    ]);
  }

  /**
   * Fire every enabled channel for one incident transition, de-duped. Never
   * throws to the engine — a channel failure is logged and recorded as a
   * `failed` delivery, never an exception that would fail the probe job.
   */
  async dispatchForTransition(
    monitor: Monitor,
    incident: Incident,
    transition: AlertTransition,
  ): Promise<void> {
    const channels = await this.db
      .select()
      .from(alertChannels)
      .where(and(eq(alertChannels.userId, monitor.userId), eq(alertChannels.isEnabled, true)));

    if (channels.length === 0) return;

    for (const channel of channels) {
      try {
        await this.dispatchToChannel(monitor, incident, transition, channel);
      } catch (err) {
        this.logger.error(
          `alert dispatch to channel ${channel.id} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Dispatch to a single channel with DB-level de-dup. */
  private async dispatchToChannel(
    monitor: Monitor,
    incident: Incident,
    transition: AlertTransition,
    channel: AlertChannel,
  ): Promise<void> {
    // 1. De-dup: claim the (incident, channel, transition) slot FIRST. The
    //    `onConflictDoNothing` returns no row if the slot is already taken, so a
    //    re-fire (retry/race) is a clean skip. We seed it as `failed` and flip
    //    it to the real outcome after dispatch — so a crash mid-send leaves a
    //    `failed` row, never a phantom `sent`.
    const [claimed] = await this.db
      .insert(alertDeliveries)
      .values({ incidentId: incident.id, alertChannelId: channel.id, transition, status: 'failed' })
      .onConflictDoNothing({
        target: [
          alertDeliveries.incidentId,
          alertDeliveries.alertChannelId,
          alertDeliveries.transition,
        ],
      })
      .returning({ id: alertDeliveries.id });

    if (!claimed) {
      this.logger.debug(
        `alert ${transition} for incident ${incident.id} channel ${channel.id} already fired — skipping`,
      );
      return;
    }

    // 2. Dispatch via the channel's implementation (webhook REAL / email MOCK).
    const dispatcher = this.dispatchers.get(channel.type);
    if (!dispatcher) {
      this.logger.error(`no dispatcher for channel type ${channel.type}`);
      return;
    }
    const result = await dispatcher.dispatch(channel, monitor, incident, transition);

    // 3. Record the real outcome on the claimed row.
    const deliveredAt = new Date();
    await this.db
      .update(alertDeliveries)
      .set({ status: result.status, responseCode: result.responseCode, deliveredAt })
      .where(eq(alertDeliveries.id, claimed.id));

    this.logger.log(
      `alert ${transition} incident ${incident.id} channel ${channel.id} ` +
        `type=${channel.type} status=${result.status}` +
        (result.mock ? ' (MOCK)' : '') +
        (result.responseCode !== null ? ` code=${String(result.responseCode)}` : ''),
    );

    // 4. Publish `alert.fired` — DASHBOARD SCOPE ONLY (the publisher hardcodes
    //    `dashboard:<userId>`; the public-stream redaction also drops
    //    `alert.fired` regardless). The toast confirms a webhook went out; the
    //    secret never travels.
    await this.events.publishAlertFired(monitor.userId, {
      incidentId: incident.id,
      monitorId: monitor.id,
      channelType: channel.type,
      transition,
      deliveredAt: deliveredAt.toISOString(),
      status: result.status,
    });
  }
}
