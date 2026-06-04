import { Module } from '@nestjs/common';

import { MonitorsModule } from '../monitors/monitors.module';
import { PublicStatusController } from './public-status.controller';
import { PublicStatusService } from './public-status.service';

/**
 * Public module (Task 6.2 / 6.3, ADR-003 / ADR-005 / ADR-007) — the
 * UNAUTHENTICATED public status-page read surface.
 *
 * Hosts `GET /public/:slug` -> the redacted public payload (page title +
 * public monitors with current status + 30-day uptime % + recent public
 * incidents). Exposes ONLY monitors in the `public_status_page_monitors` join
 * (the data-enforced privacy boundary), never raw response times / alert data /
 * private monitors. Rate-limited (the §4 security bar).
 *
 * Imports `MonitorsModule` to reuse `MonitorReadService.uptime` (the same
 * rollup-backed 30d math the private detail page uses) — only the % escapes
 * onto the public shape. WEB-process only.
 */
@Module({
  imports: [MonitorsModule],
  controllers: [PublicStatusController],
  providers: [PublicStatusService],
})
export class PublicModule {}
