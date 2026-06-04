import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbHandle, type PulseDbHandle } from '../db/drizzle';
import { RollupService } from './rollup.service';

/**
 * Rollup idempotency integration test (Task 2.4, ADR-005) — runs against the
 * real local Postgres (docker compose). The load-bearing property under test:
 * the hourly-rollup upsert is IDEMPOTENT. Running it twice over the same raw
 * `check_results` must produce identical bucket values (never double-count),
 * because each bucket is recomputed from scratch and upserted on the PK
 * `(monitor_id, bucket_start)`.
 *
 * The test seeds a disposable monitor + a known set of raw results inside the
 * current hour, runs the rollup twice, and asserts the bucket counts match the
 * raw data exactly AND are identical across the two runs. It cleans up after
 * itself (cascade delete of the monitor wipes its results + rollups).
 *
 * If Postgres is unreachable the suite SKIPS (so a unit-only `pnpm test`
 * without docker still passes) — the smoke-test path proves it for real.
 */

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pulse:pulse@localhost:5437/pulse';

let handle: PulseDbHandle | null = null;
let available = false;
let ownerId = '';
let monitorId = '';

beforeAll(async () => {
  try {
    handle = createDbHandle(databaseUrl, 3);
    // Probe connectivity with a short statement.
    await handle.sql`SELECT 1`;
    available = true;

    // Seed a disposable owner + monitor.
    const email = `rollup-test-${String(Date.now())}@pulse.local`;
    const owner = await handle.sql<{ id: string }[]>`
      INSERT INTO users (email, name) VALUES (${email}, 'rollup test')
      RETURNING id`;
    const ownerRow = owner[0];
    const monitor = await handle.sql<{ id: string }[]>`
      INSERT INTO monitors (user_id, name, target_url)
      VALUES (${ownerRow?.id ?? ''}, 'rollup-fixture', 'https://example.com')
      RETURNING id`;
    const monitorRow = monitor[0];
    if (!ownerRow || !monitorRow) throw new Error('seed failed');
    ownerId = ownerRow.id;
    monitorId = monitorRow.id;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (handle && available && ownerId) {
    // Cascade-delete the owner -> wipes the monitor, its check_results, rollups.
    await handle.sql`DELETE FROM users WHERE id = ${ownerId}`;
  }
  if (handle) await handle.sql.end({ timeout: 5 });
});

describe('rollup idempotency (real Postgres)', () => {
  it('produces identical hourly buckets on a re-run (no double-count)', async ({ skip }) => {
    if (!available || !handle) {
      skip();
      return;
    }

    // Seed raw results inside the current hour: 5 up, 2 degraded, 1 down.
    const now = new Date();
    const inHour = (offsetMin: number): Date =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), offsetMin % 60, 0, 0);

    const rows: { status: 'up' | 'degraded' | 'down'; rt: number | null; offset: number }[] = [
      { status: 'up', rt: 100, offset: 1 },
      { status: 'up', rt: 120, offset: 2 },
      { status: 'up', rt: 110, offset: 3 },
      { status: 'up', rt: 130, offset: 4 },
      { status: 'up', rt: 105, offset: 5 },
      { status: 'degraded', rt: 1500, offset: 6 },
      { status: 'degraded', rt: 1600, offset: 7 },
      { status: 'down', rt: null, offset: 8 },
    ];

    for (const r of rows) {
      await handle.sql`
        INSERT INTO check_results (monitor_id, checked_at, status, response_time_ms)
        VALUES (
          ${monitorId},
          ${inHour(r.offset).toISOString()}::timestamptz,
          ${r.status}::monitor_status,
          ${r.rt}
        )`;
    }

    const rollup = new RollupService(handle.db);

    // First run.
    await rollup.rollupRecentHours(now);
    const first = await fetchBucket(handle, monitorId);

    // Second run — must be identical (idempotent upsert).
    await rollup.rollupRecentHours(now);
    const second = await fetchBucket(handle, monitorId);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);

    // Values must match the seeded raw data exactly.
    expect(first?.up_count).toBe(5);
    expect(first?.degraded_count).toBe(2);
    expect(first?.down_count).toBe(1);
    // avg over the 7 non-null response times.
    const expectedAvg = Math.round((100 + 120 + 110 + 130 + 105 + 1500 + 1600) / 7);
    expect(first?.avg_response_time_ms).toBe(expectedAvg);
    expect(first?.min_ms).toBe(100);
    expect(first?.max_ms).toBe(1600);
  });
});

interface BucketRow {
  up_count: number;
  degraded_count: number;
  down_count: number;
  unknown_count: number;
  avg_response_time_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
}

async function fetchBucket(handle: PulseDbHandle, monitorId: string): Promise<BucketRow | null> {
  const rows = await handle.sql<BucketRow[]>`
    SELECT up_count, degraded_count, down_count, unknown_count,
           avg_response_time_ms, min_ms, max_ms
    FROM check_rollups_hourly
    WHERE monitor_id = ${monitorId}
    ORDER BY bucket_start DESC
    LIMIT 1`;
  return rows[0] ?? null;
}
