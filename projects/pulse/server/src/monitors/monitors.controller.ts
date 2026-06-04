import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

import { CurrentOwnerService, type OwnerRequest } from '../auth/current-owner';
import {
  createMonitorSchema,
  updateMonitorSchema,
  type CreateMonitor,
  type MonitorResponse,
  type UpdateMonitor,
} from '../lib/schemas/monitor';
import { ZodValidationPipe } from '../lib/zod-validation.pipe';
import { MonitorsService } from './monitors.service';
import { serializeMonitor } from './monitors.serialize';

/**
 * Monitors REST surface (Task 1.5 + the Phase-6 auth boundary, ADR-007):
 * create / list / get / update / delete, each Zod-validated at the boundary
 * with the SHARED schemas (conventions § 5).
 *
 * AUTH BOUNDARY (the demo-open posture, ADR-007):
 *   - READS (`GET /monitors`, `GET /monitors/:id`) resolve the owner via
 *     `currentOwner.resolveOwnerUserId(req)` — a valid session returns THAT
 *     user; no session returns the seeded DEMO owner, so an anonymous visitor
 *     sees the live demo board / monitor detail (the wow moment, no login wall).
 *   - WRITES (`POST` / `PATCH` / `DELETE`) call `currentOwner.requireUserId(req)`
 *     which returns the session user OR throws a 401 ("sign in to manage") for
 *     the demo fallback — a demo visitor can VIEW but not mutate.
 *
 * The service already pins the owner id in every WHERE clause (never trusts a
 * client id), so an authenticated user only ever touches their own monitors.
 */
@Controller('monitors')
export class MonitorsController {
  constructor(
    @Inject(MonitorsService) private readonly monitors: MonitorsService,
    @Inject(CurrentOwnerService) private readonly currentOwner: CurrentOwnerService,
  ) {}

  @Post()
  async create(
    @Req() req: OwnerRequest,
    @Body(new ZodValidationPipe(createMonitorSchema)) body: CreateMonitor,
  ): Promise<MonitorResponse> {
    const ownerId = await this.currentOwner.requireUserId(req);
    const created = await this.monitors.create(ownerId, body);
    return serializeMonitor(created);
  }

  @Get()
  async list(@Req() req: OwnerRequest): Promise<MonitorResponse[]> {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    const rows = await this.monitors.list(ownerId);
    return rows.map(serializeMonitor);
  }

  @Get(':id')
  async get(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MonitorResponse> {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    const row = await this.monitors.getOwned(ownerId, id);
    return serializeMonitor(row);
  }

  @Patch(':id')
  async update(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateMonitorSchema)) body: UpdateMonitor,
  ): Promise<MonitorResponse> {
    const ownerId = await this.currentOwner.requireUserId(req);
    const updated = await this.monitors.update(ownerId, id, body);
    return serializeMonitor(updated);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const ownerId = await this.currentOwner.requireUserId(req);
    await this.monitors.remove(ownerId, id);
  }
}
