import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Agent, request as undiciRequest } from 'undici';

import { AppConfigService } from '../config/app-config.service';
import type { AlertChannel, Incident, Monitor } from '../db/schema';
import type { AlertTransition } from '../lib/schemas/events';
import { guardOutboundUrl } from '../probe/ssrf-outbound';
import { SsrfBlockedError } from '../probe/ssrf-guard';
import type { AlertDispatcher, DeliveryResult } from './alert-dispatcher';
import {
  buildWebhookPayload,
  signWebhookBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from './webhook-payload';

/** Per-attempt timeout for the outbound webhook POST. */
const WEBHOOK_TIMEOUT_MS = 5_000;
/** Total attempts (1 initial + retries) on a delivery failure. */
const MAX_ATTEMPTS = 3;
/** Backoff base (ms): attempt n waits BACKOFF_BASE_MS * 2^(n-1). */
const BACKOFF_BASE_MS = 500;
/** A 2xx response is a successful delivery. */
function isOk(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * The REAL webhook dispatcher (Task 5.2, ADR-005).
 *
 * On an incident open AND close, POSTs the typed JSON payload to the channel's
 * URL, signed with HMAC-SHA256 (see {@link signWebhookBody} for the exact
 * scheme + the two headers a receiver verifies). Retries with exponential
 * backoff on a transport error or a non-2xx response; the FINAL attempt's
 * outcome is what `AlertsService` records in `alert_deliveries`.
 *
 * It NEVER throws for a delivery failure — a receiver returning 500 or timing
 * out yields a `failed` {@link DeliveryResult} so the attempt is still recorded
 * (and the de-dup constraint still prevents a re-fire of the same transition).
 */
@Injectable()
export class WebhookDispatcher implements AlertDispatcher {
  readonly channelType = 'webhook' as const;
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  async dispatch(
    channel: AlertChannel,
    monitor: Monitor,
    incident: Incident,
    transition: AlertTransition,
  ): Promise<DeliveryResult> {
    const now = new Date();
    const payload = buildWebhookPayload(monitor, incident, transition, now);
    const rawBody = JSON.stringify(payload);
    const timestampSec = Math.floor(now.getTime() / 1000);

    // Per-channel secret, else the server-wide signing key. If neither exists
    // the channel cannot be signed safely — record a failed delivery rather
    // than send an unsigned payload.
    const key = channel.secret ?? this.config.webhookSigningKey;
    if (!key) {
      this.logger.warn(
        `webhook channel ${channel.id} has no secret and WEBHOOK_SIGNING_KEY is unset — ` +
          'refusing to send an unsigned payload',
      );
      return { status: 'failed', responseCode: null, mock: false };
    }

    const signature = signWebhookBody(rawBody, timestampSec, key);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'Pulse-Webhook/1.0',
      [TIMESTAMP_HEADER]: String(timestampSec),
      [SIGNATURE_HEADER]: signature,
    };

    // SSRF GATE AT DISPATCH (reviewer must-fix #1, ADR-002) — the AUTHORITATIVE
    // check. Even though create-time validated the URL shape, DNS can rebind
    // between then and now, so we resolve-then-validate EVERY A/AAAA here and
    // PIN the connection to the validated IP (same anti-rebinding posture as the
    // prober). A blocked target NEVER opens a socket — it records a `failed`
    // delivery so the de-dup constraint still holds and the worker job never
    // throws. This closes the metadata/internal-port-scan oracle a naive
    // `fetch(channel.target)` would leave open.
    let url: URL;
    let agent: Agent;
    try {
      ({ url, agent } = await guardOutboundUrl(channel.target));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `webhook ${transition} to channel ${channel.id} BLOCKED by SSRF guard ` +
          `(target=${channel.target}): ${reason}`,
      );
      // A blocked or unresolvable target is a failed delivery, not a throw — the
      // alert pipeline records it and moves on.
      return { status: 'failed', responseCode: null, mock: false };
    }

    try {
      let lastCode: number | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await undiciRequest(url, {
            method: 'POST',
            dispatcher: agent,
            // Never follow a redirect to a possibly-internal address; a webhook
            // target that 3xx-redirects is treated as a delivery failure.
            maxRedirections: 0,
            headers,
            body: rawBody,
            headersTimeout: WEBHOOK_TIMEOUT_MS,
            bodyTimeout: WEBHOOK_TIMEOUT_MS,
          });
          // Drain the body so the socket can be reused / released.
          await res.body.text().catch(() => undefined);
          lastCode = res.statusCode;
          if (isOk(res.statusCode)) {
            this.logger.log(
              `webhook ${transition} delivered to channel ${channel.id} (HTTP ${String(res.statusCode)})`,
            );
            return { status: 'sent', responseCode: res.statusCode, mock: false };
          }
          this.logger.warn(
            `webhook ${transition} to channel ${channel.id} returned HTTP ${String(res.statusCode)} ` +
              `(attempt ${String(attempt)}/${String(MAX_ATTEMPTS)})`,
          );
        } catch (err) {
          // A rebind to a blocked IP between attempts would surface here too
          // (the pinned agent makes that impossible, but a fresh re-guard on
          // retry would be the move if we ever re-resolved per attempt).
          if (err instanceof SsrfBlockedError) {
            this.logger.warn(
              `webhook ${transition} to channel ${channel.id} blocked mid-flight: ${err.message}`,
            );
            return { status: 'failed', responseCode: null, mock: false };
          }
          this.logger.warn(
            `webhook ${transition} to channel ${channel.id} failed ` +
              `(attempt ${String(attempt)}/${String(MAX_ATTEMPTS)}): ${
                err instanceof Error ? err.message : String(err)
              }`,
          );
        }

        if (attempt < MAX_ATTEMPTS) {
          await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        }
      }

      return { status: 'failed', responseCode: lastCode, mock: false };
    } finally {
      // Always close the per-dispatch pinned agent so its socket does not leak.
      await agent.close().catch(() => undefined);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
