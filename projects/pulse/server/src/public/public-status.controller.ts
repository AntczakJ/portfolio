import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';

import { RateLimitGuard } from '../common/rate-limit.guard';
import type { PublicStatusPage } from '../lib/schemas/public-status';
import { PublicStatusService } from './public-status.service';

/**
 * Public status-page READ surface (Task 6.3, ADR-003 / ADR-007) — UNAUTHENTICATED.
 *
 *   GET /public/:slug  ->  the redacted public status payload (page title +
 *                          public monitors with current status + 30d uptime % +
 *                          recent public incidents). NEVER raw response times,
 *                          alert data, or private monitors.
 *
 * No auth (it is the public surface, ADR-003). Rate-limited (the §4 security
 * bar): a fixed-window limiter caps abuse of the unauthenticated endpoint. The
 * limit is generous enough that the SSR public page + a few clients refreshing
 * never trip it, tight enough to bound scraping.
 *
 * This powers the frontend `/status/[slug]` page (SSR, SEO-bearing) — it is the
 * first-paint data source, so it must be cheap (the 30d uptime rides the
 * rollups, ADR-004) and carry no client-only dependency.
 */
@Controller('public')
@UseGuards(new RateLimitGuard({ windowMs: 60_000, max: 60 }))
export class PublicStatusController {
  constructor(
    @Inject(PublicStatusService) private readonly publicStatus: PublicStatusService,
  ) {}

  @Get(':slug')
  async getPage(@Param('slug') slug: string): Promise<PublicStatusPage> {
    return this.publicStatus.getBySlug(slug);
  }
}
