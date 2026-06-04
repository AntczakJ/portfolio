import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { incidents, monitors } from '../db/schema';
import type { IncidentSeverity } from '../lib/schemas/events';
import type { IncidentStatus } from '../lib/schemas/incident';
import {
  type IncidentListItem,
  type IncidentsListResponse,
} from '../lib/schemas/incidents-list';

/**
 * Incident HISTORY read surface (Phase 5 read endpoints) — the data the
 * dashboard incidents view and the monitor-detail incident history consume:
 *
 *   GET /incidents                  -> recent incidents across the owner's
 *                                      monitors, newest first, paginated.
 *   GET /monitors/:id/incidents     -> the same shape scoped to one owned
 *                                      monitor (the detail page's history).
 *
 * Both ride the indexes ADR-005 put on `incidents`:
 *   - the cross-monitor list joins `incidents` to `monitors` filtered by
 *     `monitors.user_id` (the owner), ordered by `started_at DESC`.
 *   - the single-monitor list filters `incidents.monitor_id` directly,
 *     riding `incidents_monitor_started_at_idx (monitor_id, started_at DESC)`.
 *
 * Ownership: the cross-monitor list is scoped by the owner's user id in the
 * WHERE (never a client id); the single-monitor list is called only AFTER the
 * controller has resolved the OWNED monitor (`MonitorsService.getOwned`, which
 * 404s on a monitor the demo user does not own), so a foreign monitor id can
 * never reach this service.
 *
 * The row-mapping math (resolved vs still-accruing duration) is the pure,
 * unit-tested `toIncidentListItem` helper below; this service is the thin DB
 * boundary that fetches the right rows and hands them in.
 */
@Injectable()
export class IncidentsReadService {
  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  /**
   * Recent incidents across ALL of the owner's monitors, newest first.
   * Optionally filtered to one status (open / resolved).
   */
  async listForOwner(
    ownerUserId: string,
    limit: number,
    status: IncidentStatus | undefined,
    now: Date = new Date(),
  ): Promise<IncidentsListResponse> {
    const where = status
      ? and(eq(monitors.userId, ownerUserId), eq(incidents.status, status))
      : eq(monitors.userId, ownerUserId);

    const rows = await this.db
      .select({
        id: incidents.id,
        monitorId: incidents.monitorId,
        monitorName: monitors.name,
        monitorUrl: monitors.targetUrl,
        status: incidents.status,
        severity: incidents.severity,
        startedAt: incidents.startedAt,
        resolvedAt: incidents.resolvedAt,
        cause: incidents.cause,
      })
      .from(incidents)
      .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
      .where(where)
      .orderBy(desc(incidents.startedAt))
      .limit(limit);

    return {
      monitorId: null,
      items: rows.map((r) => toIncidentListItem(r, now)),
    };
  }

  /**
   * Recent incidents for ONE monitor, newest first. The caller must have
   * already resolved the OWNED monitor (404 on a foreign id); this scopes by
   * `monitor_id` directly. The monitor name / url are passed through so the
   * wire shape stays uniform with the cross-monitor list.
   */
  async listForMonitor(
    monitorId: string,
    monitorName: string,
    monitorUrl: string,
    limit: number,
    status: IncidentStatus | undefined,
    now: Date = new Date(),
  ): Promise<IncidentsListResponse> {
    const where = status
      ? and(eq(incidents.monitorId, monitorId), eq(incidents.status, status))
      : eq(incidents.monitorId, monitorId);

    const rows = await this.db
      .select({
        id: incidents.id,
        monitorId: incidents.monitorId,
        status: incidents.status,
        severity: incidents.severity,
        startedAt: incidents.startedAt,
        resolvedAt: incidents.resolvedAt,
        cause: incidents.cause,
      })
      .from(incidents)
      .where(where)
      .orderBy(desc(incidents.startedAt))
      .limit(limit);

    return {
      monitorId,
      items: rows.map((r) =>
        toIncidentListItem({ ...r, monitorName, monitorUrl }, now),
      ),
    };
  }
}

/** A raw incident-with-monitor row, the input to the pure mapper. */
export interface RawIncidentRow {
  id: string;
  monitorId: string;
  monitorName: string;
  monitorUrl: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: Date;
  resolvedAt: Date | null;
  cause: string;
}

/**
 * Map a raw incident row to the wire `IncidentListItem` (PURE — unit-tested).
 *
 * Duration:
 *   - CLOSED (`resolved_at` set): `resolved_at - started_at`.
 *   - OPEN (`resolved_at` null): the still-accruing duration `now - started_at`
 *     so the live incident row counts up off a real baseline.
 *   - Clamped at 0 (a clock skew that put `started_at` in the future never
 *     yields a negative duration).
 */
export function toIncidentListItem(row: RawIncidentRow, now: Date): IncidentListItem {
  const endMs = row.resolvedAt ? row.resolvedAt.getTime() : now.getTime();
  const durationMs = Math.max(0, endMs - row.startedAt.getTime());
  return {
    id: row.id,
    monitorId: row.monitorId,
    monitorName: row.monitorName,
    monitorUrl: row.monitorUrl,
    status: row.status,
    severity: row.severity,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    durationMs,
    cause: row.cause,
  };
}
