/**
 * Seed BELIEVABLE 30-day history for the DEMO MONITOR (designer-critic C-3/H-4).
 *
 * The public status page reads the demo monitor's 30d uptime (rollup-backed) and
 * its recent incidents. Without seeded history those read off whatever the live
 * probes happened to record during a review session — which produced a FAKE-
 * looking surface (a flat ~67% uptime, a near-solid-red 30d history bar, and 7
 * IDENTICAL incidents from repeated demo triggers). This script makes the public
 * surface read like a real, healthy service:
 *
 *   - ~99.9x% uptime over 30 days (a high, product-plausible number).
 *   - A handful of SHORT historical outages CLUSTERED into realistic windows
 *     (not a flat synthetic failure rate smeared across the whole bar).
 *   - VARIED incident causes (timeout / HTTP 500 / keyword missing / connection
 *     refused) so the timeline reads like a real history, not an identical loop.
 *
 * DETERMINISM (ADR-006, the frozen-now / seed discipline): the script takes a
 * FROZEN `now` (env `SEED_FROZEN_NOW`, ISO, default a fixed timestamp) and a
 * fixed pseudo-random stream seeded from a constant — NO `Date.now()` /
 * `Math.random()` in the generation, so re-running yields byte-identical history
 * and tests / Lighthouse share the same shape. Live probes still run FORWARD
 * from real now; this only fills the historical window (the credibility line).
 *
 * Idempotent: it WIPES this monitor's seeded historical rows (older than the
 * live cutover) and re-writes them, so a re-run converges. It does NOT touch the
 * live forward-from-now probe results.
 *
 * Run (Postgres up, server/.env present, AFTER seed-demo-monitor.ts):
 *   pnpm -F pulse-server tsx scripts/seed-demo-history.ts
 */
import { and, eq, lt, sql } from 'drizzle-orm';

import { createDbHandle } from '../src/db/drizzle';
import { DEV_OWNER_EMAIL } from '../src/monitors/dev-owner';
import { checkResults, incidents, monitors, users } from '../src/db/schema';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pulse:pulse@localhost:5437/pulse';

/** The demo monitor's product-plausible name (must match seed-demo-monitor.ts). */
const MONITOR_NAME = 'Checkout API';

/**
 * Frozen `now` for the seeded history (ADR-006). Override with SEED_FROZEN_NOW
 * for tests/screenshots. Default is a fixed instant so a fresh DB is reproducible.
 */
const FROZEN_NOW = new Date(process.env.SEED_FROZEN_NOW ?? '2026-06-01T12:00:00.000Z');

/** Window the seeded history covers, and the synthetic sampling interval. */
const HISTORY_DAYS = 30;
const SAMPLE_INTERVAL_SECONDS = 300; // 5 min — enough resolution for a clean 30d bar

/**
 * A small deterministic PRNG (mulberry32) seeded from a constant — NO
 * Math.random(), so the history is byte-stable across runs (seed discipline).
 */
function makeRng(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seeded historical outages, expressed as offsets BEFORE the frozen now.
 * Each is a SHORT, clustered window with a distinct cause — so the public
 * incident timeline reads as a believable real history (varied), and the 30d
 * uptime stays high (these total only ~70 min of downtime over 30 days).
 *
 * `errorClass` maps to the check_results `error` column; `severity` + `cause`
 * map to the incident row the public page renders.
 */
interface SeededOutage {
  /** Hours before FROZEN_NOW the outage STARTED. */
  startHoursAgo: number;
  /** Outage duration in minutes (kept short so uptime stays high). */
  durationMinutes: number;
  severity: 'down' | 'degraded';
  errorClass: 'timeout' | 'http_error' | 'keyword_missing' | 'connection_refused';
  /** The status written to the failing check rows (degraded vs down). */
  checkStatus: 'down' | 'degraded';
  /** Human-meaningful cause snapshot shown on the public incident timeline. */
  cause: string;
}

const SEEDED_OUTAGES: SeededOutage[] = [
  {
    startHoursAgo: 26 * 24 + 3, // ~26 days ago
    durationMinutes: 8,
    severity: 'down',
    errorClass: 'connection_refused',
    checkStatus: 'down',
    cause: 'Connection refused for 3 consecutive checks',
  },
  {
    startHoursAgo: 19 * 24 + 11, // ~19 days ago
    durationMinutes: 14,
    severity: 'down',
    errorClass: 'http_error',
    checkStatus: 'down',
    cause: 'HTTP 500 from upstream for 3 consecutive checks',
  },
  {
    startHoursAgo: 12 * 24 + 6, // ~12 days ago
    durationMinutes: 6,
    severity: 'degraded',
    errorClass: 'timeout',
    checkStatus: 'degraded',
    cause: 'Elevated response time (degraded) for 3 consecutive checks',
  },
  {
    startHoursAgo: 5 * 24 + 9, // ~5 days ago
    durationMinutes: 11,
    severity: 'down',
    errorClass: 'timeout',
    checkStatus: 'down',
    cause: 'Request timeout for 3 consecutive checks',
  },
  {
    startHoursAgo: 1 * 24 + 14, // ~1.5 days ago
    durationMinutes: 9,
    severity: 'down',
    errorClass: 'keyword_missing',
    checkStatus: 'down',
    cause: 'Expected keyword absent from response body for 3 consecutive checks',
  },
];

/** True if `t` falls inside any seeded outage window. Returns the outage if so. */
function outageAt(tMs: number, nowMs: number): SeededOutage | null {
  for (const o of SEEDED_OUTAGES) {
    const startMs = nowMs - o.startHoursAgo * 3_600_000;
    const endMs = startMs + o.durationMinutes * 60_000;
    if (tMs >= startMs && tMs < endMs) return o;
  }
  return null;
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const { sql: client, db } = createDbHandle(databaseUrl, 3);
  try {
    const nowMs = FROZEN_NOW.getTime();

    // Resolve the demo owner + monitor (seed-demo-monitor.ts must have run).
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEV_OWNER_EMAIL))
      .limit(1);
    const ownerId = owner?.id;
    if (!ownerId) throw new Error('demo owner not found — run seed-demo-monitor.ts first');

    const [monitor] = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.userId, ownerId), eq(monitors.name, MONITOR_NAME)))
      .limit(1);
    const monitorId = monitor?.id;
    if (!monitorId) {
      throw new Error(`demo monitor "${MONITOR_NAME}" not found — run seed-demo-monitor.ts first`);
    }

    // The cutover: everything strictly before FROZEN_NOW is seeded history we own
    // and re-write; live forward-from-real-now probes are never touched.
    const cutover = new Date(nowMs);

    // Wipe prior seeded history (idempotent re-run) for this monitor only.
    await db
      .delete(checkResults)
      .where(and(eq(checkResults.monitorId, monitorId), lt(checkResults.checkedAt, cutover)));
    await db
      .delete(incidents)
      .where(and(eq(incidents.monitorId, monitorId), lt(incidents.startedAt, cutover)));

    // Generate 30d of synthetic checks at the sample interval.
    const rng = makeRng(0x9e3779b9);
    const total = Math.floor((HISTORY_DAYS * 24 * 60 * 60) / SAMPLE_INTERVAL_SECONDS);
    let up = 0;
    let degraded = 0;
    let down = 0;

    const CHUNK = 1000;
    for (let chunkStart = 0; chunkStart < total; chunkStart += CHUNK) {
      const rows: {
        monitorId: string;
        checkedAt: Date;
        status: 'up' | 'degraded' | 'down';
        statusCode: number | null;
        responseTimeMs: number | null;
        error: SeededOutage['errorClass'] | null;
      }[] = [];

      for (let i = chunkStart; i < Math.min(chunkStart + CHUNK, total); i += 1) {
        // i=0 is the OLDEST (30d before now); the newest sits just before now.
        const checkedAtMs = nowMs - (total - 1 - i) * SAMPLE_INTERVAL_SECONDS * 1000;
        const outage = outageAt(checkedAtMs, nowMs);

        if (outage) {
          if (outage.checkStatus === 'down') {
            down += 1;
            rows.push({
              monitorId,
              checkedAt: new Date(checkedAtMs),
              status: 'down',
              statusCode: outage.errorClass === 'http_error' ? 500 : null,
              responseTimeMs: outage.errorClass === 'timeout' ? null : 200 + Math.floor(rng() * 50),
              error: outage.errorClass,
            });
          } else {
            degraded += 1;
            rows.push({
              monitorId,
              checkedAt: new Date(checkedAtMs),
              status: 'degraded',
              statusCode: 200,
              responseTimeMs: 1400 + Math.floor(rng() * 400),
              error: null,
            });
          }
        } else {
          up += 1;
          // Healthy response time with mild deterministic jitter.
          const rt = 120 + Math.floor(rng() * 60);
          rows.push({
            monitorId,
            checkedAt: new Date(checkedAtMs),
            status: 'up',
            statusCode: 200,
            responseTimeMs: rt,
            error: null,
          });
        }
      }

      await db.insert(checkResults).values(rows);
    }

    // Write one CLOSED incident per seeded outage, with its varied cause.
    for (const o of SEEDED_OUTAGES) {
      const startedAt = new Date(nowMs - o.startHoursAgo * 3_600_000);
      const resolvedAt = new Date(startedAt.getTime() + o.durationMinutes * 60_000);
      await db.insert(incidents).values({
        monitorId,
        status: 'resolved',
        severity: o.severity,
        startedAt,
        resolvedAt,
        cause: o.cause,
      });
    }

    // The monitor is currently HEALTHY (the most recent seeded sample is `up`).
    await db
      .update(monitors)
      .set({ currentStatus: 'up', lastCheckedAt: new Date(nowMs - SAMPLE_INTERVAL_SECONDS * 1000) })
      .where(eq(monitors.id, monitorId));

    // Roll up the whole seeded history so the 7d/30d (rollup-backed) uptime read
    // reflects it. Recompute-from-scratch per hour (idempotent on the PK), the
    // same pattern seed-detail-fixture.ts uses.
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
      WHERE cr.monitor_id = ${monitorId} AND cr.checked_at < ${cutover.toISOString()}::timestamptz
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

    const totalChecks = up + degraded + down;
    // Mirror the read-path weighting (degraded = 50%) for an at-a-glance number.
    const goodEquivalent = up + degraded * 0.5;
    const approxUptime = ((goodEquivalent / totalChecks) * 100).toFixed(3);

    console.log(`[seed-demo-history] monitor ${monitorId} ("${MONITOR_NAME}")`);
    console.log(
      `[seed-demo-history] ${String(totalChecks)} checks over ${String(HISTORY_DAYS)}d ` +
        `(up=${String(up)} degraded=${String(degraded)} down=${String(down)}) -> ~${approxUptime}% uptime`,
    );
    console.log(
      `[seed-demo-history] ${String(SEEDED_OUTAGES.length)} short historical incidents, varied causes:`,
    );
    for (const o of SEEDED_OUTAGES) {
      console.log(
        `  - ${o.severity.toUpperCase().padEnd(8)} ${String(o.durationMinutes)}m  ${o.cause}`,
      );
    }
    console.log('[seed-demo-history] verify: curl -s http://localhost:3080/public/demo');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[seed-demo-history] failed:', err);
  process.exitCode = 1;
});
