import type { AlertChannel, Incident, Monitor } from '../db/schema';
import type { AlertTransition } from '../lib/schemas/events';

/**
 * The single dispatch contract both channel implementations share (Task 5.2,
 * ADR-005). One interface, two implementations:
 *   - {@link WebhookDispatcher} — REAL: signs + POSTs a JSON payload.
 *   - {@link EmailDispatcher} — MOCKED: records a delivery + logs, no SMTP.
 *
 * `AlertsService` selects the implementation by `channel.type` and records the
 * returned {@link DeliveryResult} in `alert_deliveries` (de-duped at the DB).
 * A real SMTP transport could replace the email mock later without touching the
 * incident engine or `AlertsService` — that is the point of the shared
 * interface.
 */
export interface AlertDispatcher {
  /** The channel type this dispatcher handles. */
  readonly channelType: AlertChannel['type'];

  /**
   * Deliver the alert for an incident transition. MUST NOT throw for a delivery
   * failure (a 500 from the receiver, a timeout) — it returns a `failed`
   * {@link DeliveryResult} so the caller records the attempt either way. It may
   * throw only for a programming error (which the caller logs).
   */
  dispatch(
    channel: AlertChannel,
    monitor: Monitor,
    incident: Incident,
    transition: AlertTransition,
  ): Promise<DeliveryResult>;
}

/** The outcome of one dispatch attempt, recorded in `alert_deliveries`. */
export interface DeliveryResult {
  status: 'sent' | 'failed';
  /** HTTP status from the receiver (webhook) or null (mocked email). */
  responseCode: number | null;
  /**
   * `true` for the email mock — surfaced so the README claim ("email is
   * recorded as a mock, never sent") is observable in logs/tests. The webhook
   * dispatcher always returns `false`.
   */
  mock: boolean;
}
