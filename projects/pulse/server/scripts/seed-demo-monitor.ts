/**
 * Seed (or reconcile) the DEMO MONITOR — the wow-moment target (ADR-006).
 *
 * The demo monitor probes the app's OWN `/demo/flaky` endpoint, so the
 * "Trigger demo incident" button (`POST /demo/trigger`) plays the full real
 * arc: N failing probes open an incident + fire the signed webhook, the Redis
 * flag auto-recovers, and M passing probes close it — all through the genuine
 * probe -> incident -> alert pipeline (no faked arc).
 *
 * FINALIZED TIMING (ADR-006, matches `demo.controller.ts`):
 *   - interval        15 s   (SHORT so the arc is fast)
 *   - failureThreshold 2     (demo-only N: open after 2 consecutive downs)
 *   - recoveryThreshold 1    (demo-only M: close after 1 up)
 *   - fail window      35 s   (the controller's FAIL_WINDOW_SECONDS)
 * => open ~30 s after the trigger, close ~45 s after — inside the wow budget.
 *
 * The 15 s interval is BELOW the CRUD schema's 30 s floor on purpose: the demo
 * monitor is SEEDED directly here, not created through `POST /monitors`. The
 * floor protects user monitors from hammering third-party targets; the demo
 * monitor targets our OWN endpoint, so a tighter interval is safe — and is what
 * makes the arc fast enough to hold a recruiter. This is the documented
 * exception (AGENT_NOTES "demo monitor interval").
 *
 * TARGET URL (SSRF, ADR-006):
 *   - PROD: the app's PUBLIC origin, e.g. https://pulse-api.fly.dev/demo/flaky —
 *     a public host, inside the SSRF allowlist. Set DEMO_FLAKY_URL to it.
 *   - LOCAL DEV: the API resolves to loopback, which the SSRF execution-time
 *     guard BLOCKS (so a pure-local demo monitor records `ssrf_blocked` = down,
 *     which still opens an incident but is not the intended "endpoint failed"
 *     path). For a faithful local verify, point DEMO_FLAKY_URL at a public
 *     hostname that tunnels/forwards to the local app (e.g. a quick tunnel), or
 *     run the verify against the deployed host. The endpoint + pipeline are
 *     identical either way — only the monitor's target host differs.
 *
 * The script also registers the monitor's repeatable BullMQ schedule directly
 * (the same deterministic id `probe:<monitorId>` the scheduler uses), so an
 * already-running worker probes it on the 15 s interval without a restart. A
 * worker boot reconciliation would also register it, but registering here means
 * the demo is live the moment the seed finishes.
 *
 * Run (Postgres + Redis up, server/.env present):
 *   DEMO_FLAKY_URL=https://pulse-api.fly.dev/demo/flaky \
 *     pnpm -F pulse-server tsx scripts/seed-demo-monitor.ts
 */
import { and, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { createDbHandle } from '../src/db/drizzle';
import { DEV_OWNER_EMAIL } from '../src/monitors/dev-owner';
import { monitors, users } from '../src/db/schema';
import { buildRedisOptions } from '../src/redis/redis.connection';
import { PROBE_QUEUE, probeJobSchedulerId } from '../src/redis/queue-names';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pulse:pulse@localhost:5437/pulse';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6381';

/** The owned flaky endpoint the demo monitor probes (see TARGET URL above). */
const DEMO_FLAKY_URL = process.env.DEMO_FLAKY_URL ?? 'http://localhost:3080/demo/flaky';

/**
 * Product-plausible name for the demo monitor. This string appears on the
 * PUBLIC status page, so it must read like a real service — never an internal
 * "wow-moment target" label (designer-critic C-3/H-4: that string must NEVER
 * leak to the public surface).
 */
const MONITOR_NAME = 'Checkout API';

// Finalized demo timing (kept in lockstep with demo.controller.ts).
const INTERVAL_SECONDS = 15;
const FAILURE_THRESHOLD = 2; // demo-only N
const RECOVERY_THRESHOLD = 1; // demo-only M

/* eslint-disable no-console */
async function main(): Promise<void> {
  const { sql: client, db } = createDbHandle(databaseUrl, 3);
  const queueRedis = new Redis(redisUrl, buildRedisOptions());
  const queue = new Queue(PROBE_QUEUE, { connection: queueRedis });

  try {
    // Resolve / create the demo owner (the same id the CRUD + streams use).
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

    // Migrate any pre-rename demo monitor (the old "Demo flaky (wow-moment
    // target)" name) to the new product-plausible name first, so the upsert
    // below reuses it instead of creating a duplicate. The old label must never
    // resurface on the public page.
    const LEGACY_MONITOR_NAME = 'Demo flaky (wow-moment target)';
    await db
      .update(monitors)
      .set({ name: MONITOR_NAME, updatedAt: new Date() })
      .where(and(eq(monitors.userId, ownerId), eq(monitors.name, LEGACY_MONITOR_NAME)));

    // Upsert the demo monitor by stable name. Written DIRECTLY (below the CRUD
    // 30 s interval floor) — the documented demo exception.
    const [existing] = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.userId, ownerId), eq(monitors.name, MONITOR_NAME)))
      .limit(1);

    let monitorId: string;
    if (existing?.id) {
      await db
        .update(monitors)
        .set({
          targetUrl: DEMO_FLAKY_URL,
          intervalSeconds: INTERVAL_SECONDS,
          expectedStatus: 200,
          failureThreshold: FAILURE_THRESHOLD,
          recoveryThreshold: RECOVERY_THRESHOLD,
          isPublic: true,
          isPaused: false,
          updatedAt: new Date(),
        })
        .where(eq(monitors.id, existing.id));
      monitorId = existing.id;
      console.log(`[seed-demo-monitor] reused monitor ${monitorId}`);
    } else {
      const [m] = await db
        .insert(monitors)
        .values({
          userId: ownerId,
          name: MONITOR_NAME,
          targetUrl: DEMO_FLAKY_URL,
          method: 'GET',
          intervalSeconds: INTERVAL_SECONDS,
          expectedStatus: 200,
          failureThreshold: FAILURE_THRESHOLD,
          recoveryThreshold: RECOVERY_THRESHOLD,
          isPublic: true,
          isPaused: false,
        })
        .returning({ id: monitors.id });
      if (!m?.id) throw new Error('could not create the demo monitor');
      monitorId = m.id;
      console.log(`[seed-demo-monitor] created monitor ${monitorId}`);
    }

    // Register the repeatable schedule directly (same deterministic id the
    // scheduler uses), so a running worker probes it immediately.
    await queue.upsertJobScheduler(
      probeJobSchedulerId(monitorId),
      { every: INTERVAL_SECONDS * 1000 },
      {
        name: 'probe',
        data: { monitorId },
        opts: {
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
          attempts: 2,
          backoff: { type: 'fixed', delay: 2000 },
        },
      },
    );

    console.log(
      `[seed-demo-monitor] target=${DEMO_FLAKY_URL} interval=${String(INTERVAL_SECONDS)}s ` +
        `N=${String(FAILURE_THRESHOLD)} M=${String(RECOVERY_THRESHOLD)} (public, scheduled).`,
    );
    console.log('[seed-demo-monitor] play the arc:');
    console.log('  curl -s -X POST http://localhost:3080/demo/trigger');
    console.log(`  watch the incident:  curl -s "http://localhost:3080/monitors/${monitorId}/incidents"`);
    console.log('  cross-monitor list:  curl -s "http://localhost:3080/incidents"');
    if (DEMO_FLAKY_URL.includes('localhost')) {
      console.log(
        '[seed-demo-monitor] NOTE: target is loopback — the SSRF guard will block it at probe ' +
          'time (records ssrf_blocked=down). Set DEMO_FLAKY_URL to a public host for a faithful arc.',
      );
    }
  } finally {
    await queue.close();
    queueRedis.disconnect();
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[seed-demo-monitor] failed:', err);
  process.exitCode = 1;
});
