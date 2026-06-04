import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { CurrentOwnerService, type OwnerRequest } from '../auth/current-owner';
import {
  incidentsListQuerySchema,
  type IncidentsListResponse,
} from '../lib/schemas/incidents-list';
import { ZodValidationPipe } from '../lib/zod-validation.pipe';
import { MonitorsService } from '../monitors/monitors.service';
import { IncidentsReadService } from './incidents-read.service';

/**
 * Incident HISTORY read endpoints (Phase 5 read surface, ADR-004 / ADR-005) —
 * the data the Phase 5 frontend incidents view + the monitor-detail incident
 * history consume:
 *
 *   GET /incidents?limit=N&status=open|resolved
 *       -> recent incidents across the demo owner's monitors, newest first.
 *
 *   GET /monitors/:id/incidents?limit=N&status=open|resolved
 *       -> the same row shape scoped to ONE owned monitor (404 on a monitor the
 *          demo user does not own — never trusts the client id).
 *
 * Both validate the query (limit + optional status) with the SHARED Zod schema
 * at the boundary. These are READS (ADR-007): the owner resolves via
 * `currentOwner.resolveOwnerUserId(req)` — a session returns that user; no
 * session returns the seeded demo owner, so the demo incidents view works
 * unauthenticated.
 *
 * The two routes sit on ONE controller (no base prefix; full paths on the
 * methods) so the cross-monitor `/incidents` and the per-monitor
 * `/monitors/:id/incidents` are co-located and obviously share the contract.
 */
@Controller()
export class IncidentsReadController {
  constructor(
    @Inject(IncidentsReadService) private readonly incidents: IncidentsReadService,
    @Inject(MonitorsService) private readonly monitors: MonitorsService,
    @Inject(CurrentOwnerService) private readonly currentOwner: CurrentOwnerService,
  ) {}

  /** Recent incidents across all of the owner's monitors. */
  @Get('incidents')
  async list(
    @Req() req: OwnerRequest,
    @Query(new ZodValidationPipe(incidentsListQuerySchema))
    query: { limit: number; status?: 'open' | 'resolved' },
  ): Promise<IncidentsListResponse> {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    return this.incidents.listForOwner(ownerId, query.limit, query.status);
  }

  /** Recent incidents for one OWNED monitor (the detail page's history). */
  @Get('monitors/:id/incidents')
  async listForMonitor(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(incidentsListQuerySchema))
    query: { limit: number; status?: 'open' | 'resolved' },
  ): Promise<IncidentsListResponse> {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    // Ownership gate: 404 on a monitor the resolved owner does not own.
    const monitor = await this.monitors.getOwned(ownerId, id);
    return this.incidents.listForMonitor(
      monitor.id,
      monitor.name,
      monitor.targetUrl,
      query.limit,
      query.status,
    );
  }
}
