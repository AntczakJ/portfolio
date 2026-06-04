import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { checkResults, monitors, type Monitor } from '../db/schema';
import { EventsPublisherService } from '../events/events-publisher.service';
import { IncidentEngineService } from '../incidents/incident-engine.service';
import type { MonitorStatus } from '../lib/schemas/events';
import type { ProbeOutcome } from '../lib/schemas/check-result';

/**
 * Check recorder + status derivation (Task 2.2, ADR-002 / ADR-004).
 *
 * Each probe occurrence becomes EXACTLY ONE `check_results` row, then the
 * monitor's derived live status (`current_status`) + `last_checked_at` are
 * persisted, and a status TRANSITION is detected. Phase 2 records the raw
 * result and the live status; the full incident state machine + incident rows
 * are Phase 5 (this is the source the engine will consume).
 *
 * The recorder is the WRITE PATH the ADR-002 idempotency rule applies to: the
 * row insert is the last step. A failing endpoint produces a `down` row from a
 * SUCCESSFUL job — this method does not throw for a `down` outcome; it only
 * throws if it cannot reach Postgres to record (an INFRASTRUCTURE fault), which
 * is exactly when a BullMQ retry is warranted (the processor lets that
 * propagate).
 *
 * On every check it publishes a `check.result` event; on a transition it also
 * publishes a `status.change` event (ADR-003). Both carry the owning user in
 * `scope` so the Phase 3 SSE bridge routes them to the right dashboard.
 */
@Injectable()
export class CheckRecorderService {
  private readonly logger = new Logger(CheckRecorderService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(EventsPublisherService) private readonly events: EventsPublisherService,
    @Inject(IncidentEngineService) private readonly incidents: IncidentEngineService,
  ) {}

  /**
   * Record one probe outcome for `monitor`. Returns the persisted result's
   * `checkedAt` + the derived status + whether the status transitioned.
   *
   * `checkedAt` is the server clock at completion (ADR-002). The write commits
   * the result row, the monitor's `current_status`/`last_checked_at`, and the
   * transition detection in one logical step; an infra failure to write
   * propagates so the processor can let BullMQ retry.
   */
  async record(monitor: Monitor, outcome: ProbeOutcome): Promise<{
    checkedAt: Date;
    status: MonitorStatus;
    transitioned: boolean;
    from: MonitorStatus | null;
  }> {
    const checkedAt = new Date();
    const newStatus = outcome.status;
    // `current_status` is NULL until the first probe — treat NULL as the prior
    // status being absent (the first result is itself a transition from
    // "unknown" into a concrete status, which the board uses to paint the dot).
    const priorStatus = monitor.currentStatus;

    // 1. Insert exactly one check_results row (the authoritative write).
    await this.db.insert(checkResults).values({
      monitorId: monitor.id,
      checkedAt,
      status: newStatus,
      statusCode: outcome.statusCode,
      responseTimeMs: outcome.responseTimeMs,
      error: outcome.error,
    });

    // 2. Persist the derived live status + last-checked timestamp on the
    //    monitor. This is the board's at-a-glance status, kept in sync with the
    //    latest result.
    await this.db
      .update(monitors)
      .set({ currentStatus: newStatus, lastCheckedAt: checkedAt })
      .where(eq(monitors.id, monitor.id));

    // A transition is "the live status changed from a PRIOR CONCRETE status".
    // A first-ever check (priorStatus === null) updates current_status but is
    // NOT a `status.change` for the board's dot pulse — the board paints the
    // initial dot from the `check.result` event. The SSE `status.change`
    // contract's `from` is the concrete up/degraded/down union; there is no
    // honest `from: unknown`, so we only emit it on a concrete-to-concrete
    // change. This also matches ADR-004: the incident engine reacts to real
    // status transitions, not to a monitor coming online.
    const transitioned = priorStatus !== null && priorStatus !== newStatus;

    // 3. Publish the live events (fire-and-forget; failure does not undo the
    //    write — Postgres is the source of truth, ADR-003).
    await this.publishEvents(monitor, outcome, checkedAt, priorStatus, newStatus, transitioned);

    // 4. Drive the incident state machine (Phase 5.1). The engine rehydrates
    //    the reducer state from the DB (incl. the row just written above),
    //    applies the pure reducer, persists incident rows, publishes
    //    `incident.*` events, and fires alerts. It never throws — an incident-
    //    engine failure must not fail the probe job (the result is already
    //    committed, the source of truth). It runs AFTER the result insert so the
    //    rehydration sees this check.
    await this.incidents.onCheckRecorded(monitor, newStatus, checkedAt);

    if (transitioned) {
      // Inside this guard `priorStatus` is a concrete non-null status.
      this.logger.log(
        `monitor ${monitor.id} status ${priorStatus} -> ${newStatus} ` +
          `(code=${String(outcome.statusCode ?? '-')}, rt=${String(outcome.responseTimeMs ?? '-')}ms, err=${outcome.error ?? '-'})`,
      );
    }

    return { checkedAt, status: newStatus, transitioned, from: priorStatus };
  }

  /**
   * Emit the `check.result` event (always) and, on a concrete-to-concrete
   * transition, the `status.change` event (ADR-003).
   */
  private async publishEvents(
    monitor: Monitor,
    outcome: ProbeOutcome,
    checkedAt: Date,
    priorStatus: MonitorStatus | null,
    newStatus: MonitorStatus,
    transitioned: boolean,
  ): Promise<void> {
    const checkedAtIso = checkedAt.toISOString();

    await this.events.publishCheckResult(monitor.userId, {
      monitorId: monitor.id,
      status: newStatus,
      statusCode: outcome.statusCode,
      responseTimeMs: outcome.responseTimeMs,
      checkedAt: checkedAtIso,
    });

    // `transitioned` already guarantees a non-null prior concrete status.
    if (transitioned && priorStatus !== null) {
      await this.events.publishStatusChange(monitor.userId, {
        monitorId: monitor.id,
        from: priorStatus,
        to: newStatus,
        at: checkedAtIso,
      });
    }
  }
}
