import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { AlertsService } from '../alerts/alerts.service';
import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { checkResults, incidents, type Incident, type Monitor } from '../db/schema';
import { EventsPublisherService } from '../events/events-publisher.service';
import type { IncidentSeverity, MonitorStatus } from '../lib/schemas/events';
import {
  initialIncidentState,
  reduceIncident,
  type IncidentEffect,
  type IncidentReducerState,
} from './incident-reducer';

/**
 * The incident engine (Task 5.1, ADR-004) — the IO boundary around the pure
 * reducer.
 *
 * Hooked into the check-recording path: after `CheckRecorderService.record()`
 * writes a `check_results` row and derives the monitor's live status, this
 * service:
 *
 *   1. REHYDRATES the reducer state from the DB (the current open incident + the
 *      consecutive run of recent results) so the machine survives process
 *      restarts and the web/worker split — there is no in-memory monitor state
 *      to lose. Postgres is the source of truth (the ADR-003/004 posture).
 *   2. Applies the PURE reducer to the just-recorded check.
 *   3. PERSISTS the resulting effects: open inserts an `incidents` row (with
 *      `started_at`), close updates it (`resolved_at` + computes duration),
 *      escalate bumps `severity`. The single-open invariant is enforced both in
 *      the reducer AND by the partial-unique index `(monitor_id) WHERE
 *      status='open'` (ADR-005) — a belt-and-braces guard.
 *   4. PUBLISHES `incident.open` / `incident.close` domain events via the
 *      existing publisher (ADR-003), scoped to the monitor owner's dashboard;
 *      the SSE bridge already relays them to the dashboard and (the incident
 *      ones) to the public stream with zero Phase-3 changes.
 *   5. FIRES ALERTS for the transition (Task 5.2) via `AlertsService`.
 *
 * The engine is fire-and-forget from the recorder's perspective for the EVENT
 * + ALERT side (a failure there must never undo the committed check write), but
 * the incident-row persistence IS awaited inside its own try/catch so a DB
 * incident write is consistent with the result that triggered it.
 */
@Injectable()
export class IncidentEngineService {
  private readonly logger = new Logger(IncidentEngineService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(EventsPublisherService) private readonly events: EventsPublisherService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  /**
   * React to one freshly-recorded check. `monitor` is the row as it was BEFORE
   * this check (its `failure_threshold` / `recovery_threshold` drive the
   * debounce); `status` is the derived status of THIS check; `checkedAt` is when
   * it was recorded. Called by the recorder after the result row is committed.
   *
   * Never throws to the caller: any failure is logged. The check result is
   * already persisted (the source of truth); an incident-engine hiccup must not
   * fail the probe job and trigger a spurious BullMQ retry.
   */
  async onCheckRecorded(
    monitor: Monitor,
    status: MonitorStatus,
    checkedAt: Date,
  ): Promise<void> {
    try {
      const prior = await this.rehydrateState(monitor);
      const { effects } = reduceIncident(prior, {
        status,
        failureThreshold: monitor.failureThreshold,
        recoveryThreshold: monitor.recoveryThreshold,
      });
      if (effects.length === 0) return;

      for (const effect of effects) {
        await this.applyEffect(monitor, effect, status, checkedAt);
      }
    } catch (err) {
      this.logger.error(
        `incident engine failed for monitor ${monitor.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Rebuild the reducer state from the DB.
   *
   * `openSeverity` comes from the single open `incidents` row (if any). The
   * counters come from the most-recent run of `check_results` EXCLUDING the
   * just-recorded one is unnecessary — we count the consecutive tail INCLUDING
   * the latest, but the reducer is applied to the latest status on top, so we
   * rebuild the counters as they were BEFORE the latest check by walking the
   * results AFTER the latest row. Simpler + robust: we rebuild from the recent
   * result tail (most recent first), counting consecutive bad/good runs from
   * the SECOND-most-recent backwards (the latest is the reducer's input).
   *
   * We bound the scan to a small window (the threshold is <= 20 per the monitor
   * schema, so 64 rows is plenty to see any consecutive run that matters).
   */
  private async rehydrateState(monitor: Monitor): Promise<IncidentReducerState> {
    const openIncident = await this.findOpenIncident(monitor.id);
    const openSeverity: IncidentSeverity | null = openIncident
      ? openIncident.severity
      : null;

    // Recent results, latest first. Row [0] is the just-recorded check (it was
    // written before the engine runs). The reducer's input is that latest
    // status, so we reconstruct the PRIOR counters from rows [1..].
    const recent = await this.db
      .select({ status: checkResults.status })
      .from(checkResults)
      .where(eq(checkResults.monitorId, monitor.id))
      .orderBy(desc(checkResults.checkedAt))
      .limit(64);

    const prior = recent.slice(1); // exclude the latest (the reducer's input)
    let consecutiveBad = 0;
    let consecutiveGood = 0;
    let worstBadSeverity: IncidentSeverity | null = null;

    const head = prior[0];
    if (head !== undefined) {
      if (head.status === 'up') {
        for (const row of prior) {
          if (row.status === 'up') consecutiveGood += 1;
          else break;
        }
      } else {
        for (const row of prior) {
          if (row.status !== 'up') {
            consecutiveBad += 1;
            const sev: IncidentSeverity = row.status === 'down' ? 'down' : 'degraded';
            worstBadSeverity =
              worstBadSeverity === null
                ? sev
                : worstBadSeverity === 'down' || sev === 'down'
                  ? 'down'
                  : 'degraded';
          } else break;
        }
      }
    }

    if (consecutiveBad === 0 && consecutiveGood === 0) {
      return { ...initialIncidentState(), openSeverity };
    }
    return { consecutiveBad, consecutiveGood, worstBadSeverity, openSeverity };
  }

  /** The current open incident for a monitor, or null. */
  private async findOpenIncident(monitorId: string): Promise<Incident | null> {
    const [row] = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.monitorId, monitorId), eq(incidents.status, 'open')))
      .limit(1);
    return row ?? null;
  }

  /** Carry out one reducer effect: persist the row, publish, and alert. */
  private async applyEffect(
    monitor: Monitor,
    effect: IncidentEffect,
    causeStatus: MonitorStatus,
    at: Date,
  ): Promise<void> {
    switch (effect.type) {
      case 'incident.open':
        await this.openIncident(monitor, effect.severity, causeStatus, at);
        break;
      case 'incident.escalate':
        await this.escalateIncident(monitor, effect.severity);
        break;
      case 'incident.close':
        await this.closeIncident(monitor, at);
        break;
    }
  }

  /**
   * Open exactly one incident. The insert can race with a concurrent open
   * (two occurrences crossing the threshold together); the partial-unique index
   * makes the second insert fail, which we swallow — the single-open invariant
   * holds at the DB regardless of app-level timing.
   */
  private async openIncident(
    monitor: Monitor,
    severity: IncidentSeverity,
    causeStatus: MonitorStatus,
    startedAt: Date,
  ): Promise<void> {
    const cause = `${severity} after ${String(monitor.failureThreshold)} consecutive ${causeStatus} checks`;
    let inserted: Incident | null = null;
    try {
      const [row] = await this.db
        .insert(incidents)
        .values({ monitorId: monitor.id, status: 'open', severity, startedAt, cause })
        .returning();
      inserted = row ?? null;
    } catch (err) {
      // Unique-violation on the partial-unique open index => an incident is
      // already open (a concurrent occurrence won the race). That is the
      // invariant working — log and move on, do not double-open or alert twice.
      this.logger.warn(
        `open-incident insert for monitor ${monitor.id} did not create a row ` +
          `(an incident may already be open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!inserted) return;

    this.logger.log(
      `incident OPEN ${inserted.id} monitor ${monitor.id} severity=${severity}`,
    );

    await this.events.publishIncidentOpen(monitor.userId, {
      incidentId: inserted.id,
      monitorId: monitor.id,
      severity,
      startedAt: startedAt.toISOString(),
      cause,
    });

    await this.alerts.dispatchForTransition(monitor, inserted, 'open');
  }

  /** Escalate the open incident's severity (degraded -> down). */
  private async escalateIncident(
    monitor: Monitor,
    severity: IncidentSeverity,
  ): Promise<void> {
    const open = await this.findOpenIncident(monitor.id);
    if (!open) return; // raced with a close; nothing to escalate

    await this.db
      .update(incidents)
      .set({ severity })
      .where(eq(incidents.id, open.id));

    this.logger.log(
      `incident ESCALATE ${open.id} monitor ${monitor.id} -> severity=${severity}`,
    );

    // Escalation is a severity bump on the SAME incident, not a new transition.
    // We deliberately do NOT re-fire the open alert (the de-dup constraint would
    // block a second `open` delivery anyway); the board's open-incident row
    // reads severity off the incident, and the recorder's fresh `status.change`
    // already flips the card to `down`.
  }

  /** Close the open incident: stamp `resolved_at` and compute the duration. */
  private async closeIncident(monitor: Monitor, resolvedAt: Date): Promise<void> {
    const open = await this.findOpenIncident(monitor.id);
    if (!open) return; // already closed (raced); nothing to do

    const [closed] = await this.db
      .update(incidents)
      .set({ status: 'resolved', resolvedAt })
      .where(and(eq(incidents.id, open.id), eq(incidents.status, 'open')))
      .returning();

    if (!closed) return; // another worker closed it first

    const durationMs = Math.max(0, resolvedAt.getTime() - closed.startedAt.getTime());

    this.logger.log(
      `incident CLOSE ${closed.id} monitor ${monitor.id} duration=${String(durationMs)}ms`,
    );

    await this.events.publishIncidentClose(monitor.userId, {
      incidentId: closed.id,
      monitorId: monitor.id,
      startedAt: closed.startedAt.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
      durationMs,
    });

    await this.alerts.dispatchForTransition(monitor, closed, 'close');
  }
}
