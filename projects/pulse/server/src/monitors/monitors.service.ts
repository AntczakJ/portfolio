import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { monitors, type Monitor } from '../db/schema';
import type { CreateMonitor, UpdateMonitor } from '../lib/schemas/monitor';
import { assertProbeUrlAllowed, SsrfBlockedError } from '../probe/ssrf-guard';
import { ProbeSchedulerService } from './probe-scheduler.service';

/**
 * Monitors CRUD (Task 1.5).
 *
 * Every mutation:
 *   1. runs the CREATE-TIME SSRF guard on the target URL (fail fast — reject
 *      obviously-internal targets with a clear 400). The AUTHORITATIVE guard
 *      runs again at probe execution (Phase 2.1) because DNS can rebind.
 *   2. attaches the monitor to the owner (Phase 1 dev-owner; Phase 6 the
 *      session user — the id is a parameter, not hardcoded here).
 *   3. reconciles the monitor's repeatable probe schedule via the ADR-002
 *      remove-then-add seam.
 *
 * Ownership is enforced on every read/mutate: a monitor is only addressable
 * by the user that owns it (never trust a client-supplied id — the WHERE
 * clause always pins `user_id`). This is the seam the Phase 6 auth guard
 * tightens; the ownership predicate is already here.
 */
@Injectable()
export class MonitorsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(ProbeSchedulerService) private readonly scheduler: ProbeSchedulerService,
  ) {}

  async create(ownerUserId: string, input: CreateMonitor): Promise<Monitor> {
    this.guardTargetUrl(input.targetUrl);

    const [created] = await this.db
      .insert(monitors)
      .values({
        userId: ownerUserId,
        name: input.name,
        targetUrl: input.targetUrl,
        method: input.method,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        expectedStatus: input.expectedStatus,
        expectedKeyword: input.expectedKeyword,
        degradedThresholdMs: input.degradedThresholdMs,
        failureThreshold: input.failureThreshold,
        recoveryThreshold: input.recoveryThreshold,
        isPublic: input.isPublic,
        isPaused: input.isPaused,
      })
      .returning();

    if (!created) throw new Error('monitor insert returned no row');

    await this.scheduler.reconcileMonitorSchedule(created.id);
    return created;
  }

  async list(ownerUserId: string): Promise<Monitor[]> {
    return this.db
      .select()
      .from(monitors)
      .where(eq(monitors.userId, ownerUserId))
      .orderBy(desc(monitors.createdAt));
  }

  async getOwned(ownerUserId: string, id: string): Promise<Monitor> {
    const [row] = await this.db
      .select()
      .from(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.userId, ownerUserId)))
      .limit(1);
    if (!row) throw new NotFoundException('monitor not found');
    return row;
  }

  async update(ownerUserId: string, id: string, patch: UpdateMonitor): Promise<Monitor> {
    // Ownership check first — getOwned 404s if the id is not the caller's.
    await this.getOwned(ownerUserId, id);

    if (patch.targetUrl !== undefined) {
      this.guardTargetUrl(patch.targetUrl);
    }

    const [updated] = await this.db
      .update(monitors)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(monitors.id, id), eq(monitors.userId, ownerUserId)))
      .returning();

    if (!updated) throw new NotFoundException('monitor not found');

    // Interval / pause changes must re-reconcile the schedule (ADR-002).
    await this.scheduler.reconcileMonitorSchedule(updated.id);
    return updated;
  }

  async remove(ownerUserId: string, id: string): Promise<void> {
    await this.getOwned(ownerUserId, id);
    await this.db
      .delete(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.userId, ownerUserId)));
    // Remove-only on delete (ADR-002).
    await this.scheduler.removeSchedule(id);
  }

  /**
   * Create/edit-time SSRF gate. Maps a block to a 400 with the reason so the
   * API caller sees a clear "this target is not allowed" rather than a generic
   * error. The execution-time guard (Phase 2.1) is the authoritative one.
   */
  private guardTargetUrl(url: string): void {
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
