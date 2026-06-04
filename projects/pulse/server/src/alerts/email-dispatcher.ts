import { Injectable, Logger } from '@nestjs/common';

import type { AlertChannel, Incident, Monitor } from '../db/schema';
import type { AlertTransition } from '../lib/schemas/events';
import type { AlertDispatcher, DeliveryResult } from './alert-dispatcher';

/**
 * The MOCKED email dispatcher (Task 5.2, ADR-005 — owner-confirmed).
 *
 * It satisfies the SAME {@link AlertDispatcher} interface as the real webhook
 * dispatcher, but it does NOT open an SMTP connection. It renders the message,
 * LOGS it, and returns a `sent` delivery marked `mock: true` so `AlertsService`
 * records an `alert_deliveries` row exactly as it would for a real channel —
 * proving the multi-channel design end-to-end without an SMTP dependency on the
 * demo host.
 *
 * This is documented honestly in the README as a demo mock; it is NEVER
 * presented as live email. A real SMTP transport can drop in here later
 * (replace the body of `dispatch`) without touching the incident engine or
 * `AlertsService` — that is the value of the shared interface.
 */
@Injectable()
export class EmailDispatcher implements AlertDispatcher {
  readonly channelType = 'email' as const;
  private readonly logger = new Logger(EmailDispatcher.name);

  async dispatch(
    channel: AlertChannel,
    monitor: Monitor,
    incident: Incident,
    transition: AlertTransition,
  ): Promise<DeliveryResult> {
    const subject =
      transition === 'open'
        ? `[Pulse] ${monitor.name} is ${incident.severity}`
        : `[Pulse] ${monitor.name} recovered`;
    const durationLine =
      transition === 'close' && incident.resolvedAt
        ? ` after ${formatDuration(incident.resolvedAt.getTime() - incident.startedAt.getTime())}`
        : '';

    // The "send": a log line standing in for an SMTP submission. Clearly tagged
    // MOCK so a reviewer reading the logs sees no email left the process.
    this.logger.log(
      `MOCK EMAIL -> ${channel.target} | ${subject} | monitor=${monitor.id} ` +
        `incident=${incident.id} transition=${transition}${durationLine} ` +
        '(no SMTP — recorded as a mock delivery)',
    );

    // Mocked deliveries are recorded as `sent` with no response code; `mock`
    // makes the demo nature observable in the result the caller records.
    return Promise.resolve({ status: 'sent', responseCode: null, mock: true });
  }
}

/** Human-readable duration for the mock email body. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}m ${String(seconds)}s`;
}
