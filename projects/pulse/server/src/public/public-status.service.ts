import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import {
  incidents,
  monitors,
  publicStatusPageMonitors,
  publicStatusPages,
  type Monitor,
} from '../db/schema';
import type {
  PublicIncident,
  PublicMonitor,
  PublicStatusPage,
} from '../lib/schemas/public-status';
import { MonitorReadService } from '../monitors/monitor-read.service';
import { deriveOverallStatus } from './public-status.derive';

/** How many recent incidents the public page lists. */
const PUBLIC_INCIDENT_LIMIT = 20;

/**
 * Public status-page READ service (Task 6.3, ADR-003 / ADR-005 / ADR-007).
 *
 * Builds the unauthenticated `/public/:slug` payload: the page title, the
 * REDACTED public-monitor subset (name + current status + 30-day uptime %, NO
 * raw response times / alert data / private monitors), and recent public
 * incidents. The privacy boundary is data-enforced: this service ONLY ever
 * touches monitors present in the `public_status_page_monitors` join for the
 * page — a private monitor is never loaded, never serialized.
 *
 * The public uptime reuses the SAME `MonitorReadService.uptime(monitor, '30d')`
 * math the private detail page uses (the rollup-backed 30d computation, ADR-004)
 * — but only the % escapes onto the public shape; the breakdown / series / raw
 * timings do not.
 */
@Injectable()
export class PublicStatusService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PulseDb,
    @Inject(MonitorReadService) private readonly monitorRead: MonitorReadService,
  ) {}

  /**
   * Resolve a public status page by slug to its full public payload. 404s on an
   * unknown slug (never leaks whether a private monitor exists).
   */
  async getBySlug(slug: string, now: Date = new Date()): Promise<PublicStatusPage> {
    const [page] = await this.db
      .select({
        id: publicStatusPages.id,
        slug: publicStatusPages.slug,
        title: publicStatusPages.title,
        description: publicStatusPages.description,
      })
      .from(publicStatusPages)
      .where(eq(publicStatusPages.slug, slug))
      .limit(1);

    if (!page) throw new NotFoundException('status page not found');

    // The page's PUBLISHED monitors (the only ones this surface ever loads).
    const publishedRows = await this.db
      .select({ monitorId: publicStatusPageMonitors.monitorId })
      .from(publicStatusPageMonitors)
      .where(eq(publicStatusPageMonitors.statusPageId, page.id));
    const publishedIds = publishedRows.map((r) => r.monitorId);

    // Load the FULL monitor rows for the published set, but ONLY the published
    // set — and additionally re-assert `is_public` so a monitor mistakenly
    // joined but later un-published is not exposed (defence in depth).
    const monitorRows: Monitor[] = publishedIds.length
      ? await this.db
          .select()
          .from(monitors)
          .where(and(inArray(monitors.id, publishedIds), eq(monitors.isPublic, true)))
      : [];

    const publicMonitors = await this.buildPublicMonitors(monitorRows, now);
    const publicIncidents = await this.buildPublicIncidents(
      monitorRows.map((m) => m.id),
      now,
    );

    return {
      slug: page.slug,
      title: page.title,
      description: page.description,
      overall: deriveOverallStatus(publicMonitors),
      generatedAt: now.toISOString(),
      monitors: publicMonitors,
      incidents: publicIncidents,
    };
  }

  /**
   * Map each published monitor to its REDACTED public row (name + status +
   * 30-day uptime %). The 30d uptime reuses the rollup-backed math; only the %
   * escapes — the breakdown / raw timings stay private.
   */
  private async buildPublicMonitors(
    monitorRows: Monitor[],
    now: Date,
  ): Promise<PublicMonitor[]> {
    const rows = await Promise.all(
      monitorRows.map(async (m): Promise<PublicMonitor> => {
        const uptime = await this.monitorRead.uptime(m, '30d', now);
        return {
          id: m.id,
          name: m.name,
          status: m.currentStatus,
          // Round to 2 dp for a clean public display; null when no data.
          uptimePercent:
            uptime.uptimePercent === null
              ? null
              : Math.round(uptime.uptimePercent * 100) / 100,
        };
      }),
    );
    // Stable order: name asc, so the page does not reshuffle between loads.
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Recent incidents across the page's public monitors, newest first. Carries
   * only the human-meaningful window + severity + cause snapshot — no check
   * timing, no alert delivery data.
   */
  private async buildPublicIncidents(
    publicMonitorIds: string[],
    now: Date,
  ): Promise<PublicIncident[]> {
    if (publicMonitorIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: incidents.id,
        monitorId: incidents.monitorId,
        monitorName: monitors.name,
        status: incidents.status,
        severity: incidents.severity,
        startedAt: incidents.startedAt,
        resolvedAt: incidents.resolvedAt,
        cause: incidents.cause,
      })
      .from(incidents)
      .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
      .where(inArray(incidents.monitorId, publicMonitorIds))
      .orderBy(desc(incidents.startedAt))
      .limit(PUBLIC_INCIDENT_LIMIT);

    return rows.map((r): PublicIncident => {
      const endMs = r.resolvedAt ? r.resolvedAt.getTime() : now.getTime();
      const durationMs = Math.max(0, endMs - r.startedAt.getTime());
      return {
        id: r.id,
        monitorId: r.monitorId,
        monitorName: r.monitorName,
        status: r.status,
        severity: r.severity,
        startedAt: r.startedAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        durationMs,
        cause: r.cause,
      };
    });
  }
}
