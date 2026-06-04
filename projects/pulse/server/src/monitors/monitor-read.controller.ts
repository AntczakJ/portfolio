import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { CurrentOwnerService, type OwnerRequest } from '../auth/current-owner';
import {
  monitorWindowQuerySchema,
  recentChecksQuerySchema,
  type HistoryResponse,
  type RecentChecksResponse,
  type SeriesResponse,
  type UptimeResponse,
} from '../lib/schemas/monitor-detail';
import { ZodValidationPipe } from '../lib/zod-validation.pipe';
import { MonitorReadService } from './monitor-read.service';
import { MonitorsService } from './monitors.service';

/**
 * Monitor-detail READ endpoints (Task 4.2, ADR-004) — the data the Phase 4
 * frontend monitor-detail page consumes:
 *
 *   GET /monitors/:id/uptime?window=24h|7d|30d   -> uptime % + breakdown
 *   GET /monitors/:id/series?window=24h|7d|30d    -> response-time series (uPlot)
 *   GET /monitors/:id/history?window=24h|7d|30d   -> the status-history strip
 *   GET /monitors/:id/checks?limit=N              -> the recent-checks list
 *
 * Every endpoint:
 *   - validates the query params with a SHARED Zod schema at the boundary,
 *   - resolves the OWNED monitor first (`MonitorsService.getOwned`, which 404s
 *     on a monitor the demo user does not own — never trusts the client id),
 *   - hands the row to the read service, which rides the hot
 *     `(monitor_id, checked_at DESC)` index and uses the rollups for 7d/30d.
 *
 * AUTH (ADR-007): these are READS, so they resolve the owner via
 * `currentOwner.resolveOwnerUserId(req)` — a session returns that user; no
 * session returns the seeded demo owner, so an anonymous visitor can drill into
 * the demo monitor detail (uptime / chart / history / checks) without a login.
 * The monitor is still resolved through `getOwned`, which 404s on a monitor the
 * resolved owner does not own (never trusts a client id).
 *
 * Mounted on its own controller (still base `monitors`) so the `:id/uptime`
 * etc. sub-paths sit cleanly alongside the CRUD controller's `:id`.
 */
@Controller('monitors')
export class MonitorReadController {
  constructor(
    @Inject(MonitorsService) private readonly monitors: MonitorsService,
    @Inject(MonitorReadService) private readonly read: MonitorReadService,
    @Inject(CurrentOwnerService) private readonly currentOwner: CurrentOwnerService,
  ) {}

  @Get(':id/uptime')
  async uptime(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(monitorWindowQuerySchema)) query: { window: '24h' | '7d' | '30d' },
  ): Promise<UptimeResponse> {
    const monitor = await this.resolveOwned(req, id);
    return this.read.uptime(monitor, query.window);
  }

  @Get(':id/series')
  async series(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(monitorWindowQuerySchema)) query: { window: '24h' | '7d' | '30d' },
  ): Promise<SeriesResponse> {
    const monitor = await this.resolveOwned(req, id);
    return this.read.series(monitor, query.window);
  }

  @Get(':id/history')
  async history(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(monitorWindowQuerySchema)) query: { window: '24h' | '7d' | '30d' },
  ): Promise<HistoryResponse> {
    const monitor = await this.resolveOwned(req, id);
    return this.read.history(monitor, query.window);
  }

  @Get(':id/checks')
  async checks(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(recentChecksQuerySchema)) query: { limit: number },
  ): Promise<RecentChecksResponse> {
    const monitor = await this.resolveOwned(req, id);
    return this.read.recentChecks(monitor, query.limit);
  }

  /** Resolve the monitor owned by the request's owner, 404ing on a foreign id. */
  private async resolveOwned(req: OwnerRequest, id: string) {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    return this.monitors.getOwned(ownerId, id);
  }
}
