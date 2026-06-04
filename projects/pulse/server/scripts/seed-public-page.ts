/**
 * Seed a demo public status page (Task 3.1 verification helper, ADR-003/005).
 *
 * The public SSE stream (`GET /api/public/:slug/stream`) resolves a slug to its
 * published-monitor set via the `public_status_page_monitors` join. To make the
 * endpoint testable locally, this script ensures:
 *
 *   1. The demo owner exists (the same `owner@pulse.local` the monitors CRUD
 *      uses) — the single-tenant seam.
 *   2. A demo public page exists with the slug `demo` (idempotent on the slug).
 *   3. A SUBSET of the owner's monitors is published on that page. It maps every
 *      monitor flagged `is_public = true`; if NONE are public yet, it flags the
 *      OLDEST monitor public so the page (and the redaction proof) has at least
 *      one monitor to carry — and deliberately leaves the others private so the
 *      "public exposes strictly less" boundary is observable.
 *
 * This is a DEV/verify convenience, not the Phase 6 production seed (that one is
 * the deterministic frozen-`now` faker seed, ADR-006). Run AFTER creating a
 * couple of monitors:
 *
 *   pnpm -F pulse-server tsx scripts/seed-public-page.ts
 *
 * Needs DATABASE_URL (server/.env), Postgres up (docker compose).
 */
import { asc, eq } from 'drizzle-orm';

import { createDbHandle } from '../src/db/drizzle';
import { DEV_OWNER_EMAIL } from '../src/monitors/dev-owner';
import {
  monitors,
  publicStatusPageMonitors,
  publicStatusPages,
  users,
} from '../src/db/schema';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pulse:pulse@localhost:5437/pulse';
const SLUG = 'demo';

/* eslint-disable no-console */
async function main(): Promise<void> {
  const { sql, db } = createDbHandle(databaseUrl, 3);
  try {
    // 1. Resolve (or create) the demo owner.
    const [owner] =
      (await db.select({ id: users.id }).from(users).where(eq(users.email, DEV_OWNER_EMAIL)).limit(1)) ??
      [];
    let ownerId = owner?.id;
    if (!ownerId) {
      const [created] = await db
        .insert(users)
        .values({ email: DEV_OWNER_EMAIL, name: 'Pulse Dev Owner' })
        .returning({ id: users.id });
      ownerId = created?.id;
    }
    if (!ownerId) throw new Error('could not resolve the demo owner');

    // 2. Gather the owner's monitors (oldest first, for a stable pick).
    const owned = await db
      .select({ id: monitors.id, name: monitors.name, isPublic: monitors.isPublic })
      .from(monitors)
      .where(eq(monitors.userId, ownerId))
      .orderBy(asc(monitors.createdAt));

    if (owned.length === 0) {
      console.log('[seed-public-page] no monitors yet — create a couple first, then re-run.');
      return;
    }

    // 3. The published subset = monitors flagged is_public. If none, publish the
    //    oldest so the page is non-empty (and leave the rest private — the
    //    "strictly less" boundary stays observable).
    let publicMonitors = owned.filter((m) => m.isPublic);
    if (publicMonitors.length === 0) {
      const first = owned[0];
      if (!first) throw new Error('unreachable: owned is non-empty');
      await db.update(monitors).set({ isPublic: true }).where(eq(monitors.id, first.id));
      publicMonitors = [{ ...first, isPublic: true }];
      console.log(`[seed-public-page] flagged "${first.name}" public (none were).`);
    }

    // 4. Upsert the page on the slug (idempotent).
    const [existing] = await db
      .select({ id: publicStatusPages.id })
      .from(publicStatusPages)
      .where(eq(publicStatusPages.slug, SLUG))
      .limit(1);

    let pageId = existing?.id;
    if (!pageId) {
      const [page] = await db
        .insert(publicStatusPages)
        .values({
          userId: ownerId,
          slug: SLUG,
          title: 'Pulse Demo Status',
          description: 'Live status of the Pulse demo monitors.',
        })
        .returning({ id: publicStatusPages.id });
      pageId = page?.id;
    }
    if (!pageId) throw new Error('could not resolve the demo public page');

    // 5. Wire the join (idempotent — PK on both columns, do-nothing on conflict).
    for (const m of publicMonitors) {
      await db
        .insert(publicStatusPageMonitors)
        .values({ statusPageId: pageId, monitorId: m.id })
        .onConflictDoNothing();
    }

    console.log(
      `[seed-public-page] page "/${SLUG}" -> ${String(publicMonitors.length)} public monitor(s): ` +
        publicMonitors.map((m) => m.name).join(', '),
    );
    console.log(`[seed-public-page] public stream: GET http://localhost:3080/api/public/${SLUG}/stream`);
    console.log(
      `[seed-public-page] kept ${String(owned.length - publicMonitors.length)} monitor(s) PRIVATE ` +
        '(not on the page — they must never appear on the public stream).',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[seed-public-page] failed:', err);
  process.exitCode = 1;
});
