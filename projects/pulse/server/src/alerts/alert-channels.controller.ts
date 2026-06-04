import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';

import { CurrentOwnerService, type OwnerRequest } from '../auth/current-owner';
import {
  createAlertChannelSchema,
  type AlertChannelResponse,
  type CreateAlertChannel,
} from '../lib/schemas/alert-channel';
import { ZodValidationPipe } from '../lib/zod-validation.pipe';
import { AlertChannelsService } from './alert-channels.service';

/**
 * Alert-channels REST surface (Task 5.2 + the Phase-6 auth boundary, ADR-007):
 * create / list / delete, Zod-validated at the boundary with the SHARED schema
 * (conventions § 5). The frontend's alerts-config view consumes these.
 *
 * AUTH BOUNDARY (the demo-open posture, ADR-007):
 *   - `GET /alert-channels` is a READ — resolves the owner (session user or the
 *     demo fallback), so a demo visitor sees the demo workspace's channels
 *     (the `secret` is never serialized, so nothing sensitive leaks).
 *   - `POST` / `DELETE` are WRITES — `currentOwner.requireUserId(req)` returns
 *     the session user OR throws a 401 ("sign in to manage") for the demo
 *     fallback. A demo visitor cannot create / delete channels.
 *
 * COVERAGE NOTE (ADR-005 / PLAN out-of-scope): v1 fires EVERY enabled channel
 * for the owner on EVERY incident transition — there is no per-monitor routing
 * or escalation in v1 (a documented v2 extension).
 */
@Controller('alert-channels')
export class AlertChannelsController {
  constructor(
    @Inject(AlertChannelsService) private readonly channels: AlertChannelsService,
    @Inject(CurrentOwnerService) private readonly currentOwner: CurrentOwnerService,
  ) {}

  @Post()
  async create(
    @Req() req: OwnerRequest,
    @Body(new ZodValidationPipe(createAlertChannelSchema)) body: CreateAlertChannel,
  ): Promise<AlertChannelResponse> {
    const ownerId = await this.currentOwner.requireUserId(req);
    return this.channels.create(ownerId, body);
  }

  @Get()
  async list(@Req() req: OwnerRequest): Promise<AlertChannelResponse[]> {
    const ownerId = await this.currentOwner.resolveOwnerUserId(req);
    return this.channels.list(ownerId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: OwnerRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const ownerId = await this.currentOwner.requireUserId(req);
    await this.channels.remove(ownerId, id);
  }
}
