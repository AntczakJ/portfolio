import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { alertChannels, type AlertChannel } from '../db/schema';
import type { AlertChannelResponse, CreateAlertChannel } from '../lib/schemas/alert-channel';
import { assertProbeUrlAllowed, SsrfBlockedError } from '../probe/ssrf-guard';

/**
 * Alert-channel CRUD (Task 5.2).
 *
 * Create / list / delete a delivery target (type `webhook` | `email`) owned by
 * a user. The `secret` (webhook HMAC key) is stored but NEVER returned — the
 * response shape (`serializeChannel`) omits it. Ownership is pinned in every
 * WHERE clause (never trust a client id), the same seam the monitors service
 * uses; Phase 6 swaps the owner source for the session user without a rewrite.
 */
@Injectable()
export class AlertChannelsService {
  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  async create(ownerUserId: string, input: CreateAlertChannel): Promise<AlertChannelResponse> {
    // SSRF GATE (reviewer must-fix #1, ADR-002): a webhook target is an OUTBOUND
    // URL the worker POSTs to on every incident transition. Without this an
    // authenticated user could register `http://169.254.169.254/...` or any
    // internal address and turn the worker into a metadata/internal port-scan
    // oracle. Run the SAME shape gate the prober uses at CREATE time (fail fast,
    // good UX); the AUTHORITATIVE resolve-then-validate + IP-pin runs again at
    // DISPATCH time in the webhook dispatcher (DNS can rebind between the two).
    if (input.type === 'webhook') {
      this.guardWebhookTarget(input.target);
    }

    const [created] = await this.db
      .insert(alertChannels)
      .values({
        userId: ownerUserId,
        type: input.type,
        target: input.target,
        // Email channels carry no secret; webhook channels may carry a
        // per-channel HMAC key (else the server-wide WEBHOOK_SIGNING_KEY signs).
        secret: input.type === 'webhook' ? input.secret : null,
        isEnabled: input.isEnabled,
      })
      .returning();

    if (!created) throw new Error('alert channel insert returned no row');
    return serializeChannel(created);
  }

  async list(ownerUserId: string): Promise<AlertChannelResponse[]> {
    const rows = await this.db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, ownerUserId))
      .orderBy(desc(alertChannels.createdAt));
    return rows.map(serializeChannel);
  }

  async remove(ownerUserId: string, id: string): Promise<void> {
    const [deleted] = await this.db
      .delete(alertChannels)
      .where(and(eq(alertChannels.id, id), eq(alertChannels.userId, ownerUserId)))
      .returning({ id: alertChannels.id });
    if (!deleted) throw new NotFoundException('alert channel not found');
  }

  /**
   * Create-time SSRF gate for a webhook target. Maps a block to a 400 with the
   * reason (mirrors the monitors service's `guardTargetUrl`). This is the
   * fail-fast UX check; the dispatcher's resolve-then-validate is authoritative.
   */
  private guardWebhookTarget(url: string): void {
    try {
      assertProbeUrlAllowed(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new BadRequestException({
          error: 'target_not_allowed',
          message: err.message,
        });
      }
      throw err;
    }
  }
}

/** Map a row to the wire shape — `secret` is intentionally omitted. */
function serializeChannel(row: AlertChannel): AlertChannelResponse {
  return {
    id: row.id,
    type: row.type,
    target: row.target,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
  };
}
