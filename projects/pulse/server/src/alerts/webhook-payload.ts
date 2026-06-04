import { createHmac } from 'node:crypto';

import type { Incident, Monitor } from '../db/schema';
import type { AlertTransition } from '../lib/schemas/events';

/**
 * Outbound webhook payload + HMAC signing (Task 5.2, ADR-005).
 *
 * THE SIGNING SCHEME (documented so any receiver can verify):
 *   - The payload is JSON (the {@link WebhookPayload} shape below).
 *   - The request carries two headers:
 *       X-Pulse-Timestamp: <unix-seconds>   — the moment the body was signed.
 *       X-Pulse-Signature: sha256=<hex>     — `HMAC-SHA256(key, signingInput)`.
 *   - `signingInput` is `"<timestamp>.<rawBody>"` (the timestamp, a literal
 *     dot, then the exact bytes of the JSON body). Binding the timestamp into
 *     the signature lets a receiver reject replays: recompute the HMAC over
 *     `"<X-Pulse-Timestamp>.<rawBody>"` with the shared key and constant-time
 *     compare against the hex in `X-Pulse-Signature`, then reject if the
 *     timestamp is older than its tolerance (e.g. 5 minutes).
 *   - The key is the channel's own `secret` (per-channel HMAC key); if a channel
 *     has none, the server-wide `WEBHOOK_SIGNING_KEY` is used as the fallback.
 *
 * This is a GENERIC signed webhook (Stripe-style `t=.,v1=` collapsed into two
 * headers), not Slack/Discord-specific — a receiver verifies the HMAC and reads
 * the typed JSON. The payload is intentionally self-describing so a Slack/
 * Discord relay or a custom receiver can both consume it.
 */

/** The JSON body POSTed to a webhook channel. */
export interface WebhookPayload {
  /** Schema version so a receiver can branch on shape changes. */
  version: 1;
  /** `open` when an incident opens, `close` when it resolves. */
  transition: AlertTransition;
  monitor: {
    id: string;
    name: string;
    targetUrl: string;
  };
  incident: {
    id: string;
    severity: Incident['severity'];
    startedAt: string;
    /** ISO string when `transition === 'close'`, else null. */
    resolvedAt: string | null;
    /** Milliseconds the incident lasted when closing, else null. */
    durationMs: number | null;
  };
  /** ISO time the payload was generated (the event time). */
  timestamp: string;
}

/** The header names, centralised so the receiver docs and the sender agree. */
export const SIGNATURE_HEADER = 'X-Pulse-Signature';
export const TIMESTAMP_HEADER = 'X-Pulse-Timestamp';

/** Build the typed payload for an incident transition. */
export function buildWebhookPayload(
  monitor: Pick<Monitor, 'id' | 'name' | 'targetUrl'>,
  incident: Pick<Incident, 'id' | 'severity' | 'startedAt' | 'resolvedAt'>,
  transition: AlertTransition,
  now: Date,
): WebhookPayload {
  const resolvedAt = incident.resolvedAt ? incident.resolvedAt.toISOString() : null;
  const durationMs =
    transition === 'close' && incident.resolvedAt
      ? Math.max(0, incident.resolvedAt.getTime() - incident.startedAt.getTime())
      : null;

  return {
    version: 1,
    transition,
    monitor: { id: monitor.id, name: monitor.name, targetUrl: monitor.targetUrl },
    incident: {
      id: incident.id,
      severity: incident.severity,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt,
      durationMs,
    },
    timestamp: now.toISOString(),
  };
}

/**
 * Compute the signature for a raw body + unix-second timestamp with `key`.
 * Returns the value to place in `X-Pulse-Signature` (`sha256=<hex>`).
 *
 * Pure + exported so the unit test can assert the exact bytes a receiver would
 * recompute, and so a receiver implementation can mirror it.
 */
export function signWebhookBody(rawBody: string, timestampSec: number, key: string): string {
  const signingInput = `${String(timestampSec)}.${rawBody}`;
  const hex = createHmac('sha256', key).update(signingInput).digest('hex');
  return `sha256=${hex}`;
}
