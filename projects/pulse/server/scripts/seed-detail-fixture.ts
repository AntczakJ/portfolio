/**
 * Seed a DETERMINISTIC monitor-detail fixture for Phase 4.2 verification.
 *
 * Creates (or reuses, by a stable name) a monitor owned by the demo owner and
 * back-fills 30 days of raw `check_results` at a fixed interval with a KNOWN
 * status pattern, then runs the rollup so the 7d/30d read paths have buckets to
 * read. The pattern is fixed (no faker) so the uptime % is predictable and the
 * curl smoke can be checked by hand.
 *
 * Pattern (interval 300 s = 5 min):
 *   - The vast majority of checks are `up`.
 *   - A deterministic ~2% are `degraded` (every 50th check).
 *   - A deterministic ~1% are `down` (every 97th check).
 * So 30d uptime should read high-90s%, with degraded counted as 50%.
 *
 * Run (Postgres up, server/.env present):
 *   pnpm -F pulse-server tsx scripts/seed-detail-fixture.ts
 */
import { and, eq, sql } from 'drizzle-orm';

import { createDbHandle } from '../src/db/drizzle';
import { DEV_OWNER_EMAIL } from '../src/monitors/dev-owner';
import { checkResults, monitors, users } from '../src/db/schema';
import { RollupService } from '../src/retention/rollup.service';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pulse:pulse@localhost:5437/pulse';

const MONITOR_NAME = 'detail-fixture (seeded history)';
const INTERVAL_SECONDS = 300;
const DAYS = 30;

/* eslint-disable no-console */
async function main(): Promise<void> {
  const { sql: client, db } = createDbHandle(databaseUrl, 3);
  try {
    // Resolve / create the demo owner.
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEV_OWNER_EMAIL))
      .limit(1);
    let ownerId = owner?.id;
    if (!ownerId) {
      const [created] = await db
        .insert(users)
        .values({ email: DEV_OWNER_EMAIL, name: 'Pulse Dev Owner' })
        .returning({ id: users.id });
      ownerId = created?.id;
    }
    if (!ownerId) throw new Error('could not resolve the demo owner');

    // Resolve / create the fixture monitor (stable by name so re-runs reuse it).
    const [existing] = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.userId, ownerId), eq(monitors.name, MONITOR_NAME)))
      .limit(1);
    let monitorId = existing?.id;
    if (!monitorId) {
      const [m] = await db
        .insert(monitors)
        .values({
          userId: ownerId,
          name: MONITOR_NAME,
          targetUrl: 'https://example.com',
          intervalSeconds: INTERVAL_SECONDS,
          isPublic: true,
          isPaused: true, // paused: this is seeded history, not a live probe target
        })
        .returning({ id: monitors.id });
      monitorId = m?.id;
    }
    if (!monitorId) throw new Error('could not resolve the fixture monitor');

    // Wipe any prior fixture rows so re-runs are clean.
    await db.delete(checkResults).where(eq(checkResults.monitorId, monitorId));

    // Back-fill 30d of raw results at the interval.
    const now = Date.now();
    const total = Math.floor((DAYS * 24 * 60 * 60) / INTERVAL_SECONDS);
    let up = 0;
    let degraded = 0;
    let down = 0;

    // Build a single multi-row INSERT in chunks for speed.
    const CHUNK = 1000;
    for (let start = 0; start < total; start += CHUNK) {
      const values: { checkedAt: Date; status: 'up' | 'degraded' | 'down'; rt: number | null }[] = [];
      for (let i = start; i < Math.min(start + CHUNK, total); i += 1) {
        // i=0 is the OLDEST (30d ago); the newest is at `now`.
        const checkedAt = new Date(now - (total - 1 - i) * INTERVAL_SECONDS * 1000);
        let status: 'up' | 'degraded' | 'down' = 'up';
        let rt: number | null = 120 + (i % 40); // deterministic-ish response time
        if (i % 97 === 0) {
          status = 'down';
          rt = null;
          down += 1;
        } else if (i % 50 === 0) {
          status = 'degraded';
          rt = 1500 + (i % 200);
          degraded += 1;
        } else {
          up += 1;
        }
        values.push({ checkedAt, status, rt });
      }
      // Multi-row insert via a values list.
      await db.insert(checkResults).values(
        values.map((v) => ({
          monitorId: monitorId as string,
          checkedAt: v.checkedAt,
          status: v.status,
          statusCode: v.status === 'down' ? null : 200,
          responseTimeMs: v.rt,
          error: v.status === 'down' ? ('http_error' as const) : null,
        })),
      );
    }

    // Roll up the WHOLE history so 7d/30d read from rollups. The default rollup
    // job only looks back 3h; here we recompute every hour across the 30d span
    // with one INSERT...SELECT (idempotent upsert on the PK).
    await db.execute(sql`
      INSERT INTO check_rollups_hourly (
        monitor_id, bucket_start,
        up_count, degraded_count, down_count, unknown_count,
        avg_response_time_ms, p95_response_time_ms, min_ms, max_ms
      )
      SELECT
        cr.monitor_id,
        date_trunc('hour', cr.checked_at) AS bucket_start,
        count(*) FILTER (WHERE cr.status = 'up')::int,
        count(*) FILTER (WHERE cr.status = 'degraded')::int,
        count(*) FILTER (WHERE cr.status = 'down')::int,
        0,
        round(avg(cr.response_time_ms))::int,
        round(percentile_cont(0.95) WITHIN GROUP (ORDER BY cr.response_time_ms))::int,
        min(cr.response_time_ms)::int,
        max(cr.response_time_ms)::int
      FROM check_results cr
      WHERE cr.monitor_id = ${monitorId}
      GROUP BY cr.monitor_id, date_trunc('hour', cr.checked_at)
      ON CONFLICT (monitor_id, bucket_start) DO UPDATE SET
        up_count = EXCLUDED.up_count,
        degraded_count = EXCLUDED.degraded_count,
        down_count = EXCLUDED.down_count,
        avg_response_time_ms = EXCLUDED.avg_response_time_ms,
        p95_response_time_ms = EXCLUDED.p95_response_time_ms,
        min_ms = EXCLUDED.min_ms,
        max_ms = EXCLUDED.max_ms
    `);

    // Reference: also run the production RollupService once (proves it works).
    await new RollupService(db).rollupRecentHours();

    console.log(`[seed-detail-fixture] monitor ${monitorId}`);
    console.log(
      `[seed-detail-fixture] inserted ${String(total)} raw results over ${String(DAYS)}d ` +
        `(up=${String(up)} degraded=${String(degraded)} down=${String(down)}), rolled up to hourly buckets.`,
    );
    console.log('[seed-detail-fixture] try:');
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/uptime?window=24h"`);
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/uptime?window=7d"`);
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/uptime?window=30d"`);
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/series?window=30d"`);
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/history?window=30d"`);
    console.log(`  curl -s "http://localhost:3080/monitors/${monitorId}/checks?limit=5"`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[seed-detail-fixture] failed:', err);
  process.exitCode = 1;
});
