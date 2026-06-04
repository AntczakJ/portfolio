import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { publicStatusPageMonitors, publicStatusPages } from '../db/schema';

/** A resolved public status page: its id and the set of monitors it publishes. */
export interface ResolvedPublicPage {
  pageId: string;
  /** The monitor ids the page exposes (the `public:<pageId>` allowed set). */
  monitorIds: Set<string>;
}

/**
 * Resolves a public status page slug to its monitor set (ADR-003 / ADR-005).
 *
 * The public SSE stream (`GET /api/public/:slug/stream`) re-scopes the live
 * feed to `public:<pageId>` and filters events down to ONLY the monitors a page
 * explicitly publishes via the `public_status_page_monitors` join. A monitor
 * not in this set never appears on the public stream — the privacy boundary is
 * data-enforced, not a UI nicety.
 *
 * This service is read-only and shared by the Phase 6.2 public read endpoints
 * later; Phase 3.1 only needs the slug -> (pageId, monitorIds) resolution to
 * build the public stream's scope + filter.
 */
@Injectable()
export class PublicPageService {
  constructor(@Inject(DRIZZLE) private readonly db: PulseDb) {}

  /**
   * Resolve a slug to its page id + published-monitor id set. Throws 404 if the
   * slug does not exist (the public route surfaces it as a 404, never leaking
   * whether a private monitor exists).
   */
  async resolveBySlug(slug: string): Promise<ResolvedPublicPage> {
    const [page] = await this.db
      .select({ id: publicStatusPages.id })
      .from(publicStatusPages)
      .where(eq(publicStatusPages.slug, slug))
      .limit(1);

    if (!page) throw new NotFoundException('status page not found');

    const rows = await this.db
      .select({ monitorId: publicStatusPageMonitors.monitorId })
      .from(publicStatusPageMonitors)
      .where(eq(publicStatusPageMonitors.statusPageId, page.id));

    return {
      pageId: page.id,
      monitorIds: new Set(rows.map((r) => r.monitorId)),
    };
  }
}
