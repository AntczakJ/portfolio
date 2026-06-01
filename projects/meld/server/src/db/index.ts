import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * Postgres client + Drizzle ORM handle.
 *
 * Two env-var policies live in one module on purpose:
 *
 *  1. `getDb()` and `getSql()` are fail-fast: any caller on the runtime
 *     ingest hot path (Hocuspocus `Storage` adapter, board create route,
 *     compaction sweep) that needs the DB must use them. If `DATABASE_URL`
 *     is missing the call throws — we never substitute a development
 *     default and silently write to the wrong database. Mirrors tape's
 *     ADR-005 / Phase 6 lesson and the per-project AGENT_NOTES.md "no
 *     fallbacks for absent env vars on hot paths" pin.
 *
 *  2. `pingDb()` is *tolerant*. `/health` is a public liveness probe and
 *     must return a structured response even when `DATABASE_URL` is unset
 *     (e.g. on a fresh checkout before `.env` is created — the dev should
 *     get a useful "db: not configured" payload, not a 500). Tolerance is
 *     scoped to this one observability path; the runtime ingest path
 *     (Task 1.3 / 1.4) is fail-fast.
 *
 * The postgres-js driver is first-class on Node 22; it owns its own
 * connection pool, no separate pool wiring required. `bytea` columns are
 * exposed as `Uint8Array` natively at 3.4.x — see `src/db/schema/bytea.ts`
 * for the customType + the historical-pin note.
 */

const DB_PING_TIMEOUT_MS = 100;

let cachedSql: ReturnType<typeof postgres> | null = null;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function connect(databaseUrl: string): {
  sql: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle<typeof schema>>;
} {
  if (cachedSql && cachedDb) {
    return { sql: cachedSql, db: cachedDb };
  }
  const client = postgres(databaseUrl, {
    // One process talks to one DB; pool is sized for the Hocuspocus
    // Storage adapter's per-board snapshot + ops writes (debounced at
    // 5_000 ms idle / 30_000 ms ceiling per ADR-003) plus occasional
    // HTTP control routes. Not a fan-out web tier.
    max: 10,
    onnotice: () => {
      // Silence Postgres NOTICE messages — they noise up the dev log
      // without informing operational decisions.
    },
  });
  cachedSql = client;
  cachedDb = drizzle(client, { schema });
  return { sql: cachedSql, db: cachedDb };
}

/**
 * Fail-fast accessor for the raw postgres-js client. Use on any code path
 * that genuinely needs the database — board create, ops append, snapshot
 * load, retention sweep.
 */
export function getSql(): ReturnType<typeof postgres> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env, or export DATABASE_URL.',
    );
  }
  return connect(databaseUrl).sql;
}

/**
 * Fail-fast accessor for the Drizzle ORM handle. Same contract as getSql().
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env, or export DATABASE_URL.',
    );
  }
  return connect(databaseUrl).db;
}

export { schema };

/**
 * Result of a single liveness probe. `latencyMs` is `null` when no probe
 * ran (DATABASE_URL was unset); otherwise it is the wall-clock time the
 * probe consumed, including any timeout window.
 */
export interface DbPingResult {
  connected: boolean;
  latencyMs: number | null;
}

/**
 * Ping the database with a bounded-latency `SELECT 1`.
 *
 * Returns `{ connected, latencyMs }`. Never throws — `/health` reports
 * state, it does not refuse. Tolerates a missing `DATABASE_URL` (returns
 * `{ connected: false, latencyMs: null }`) so a fresh checkout still
 * gets a structured liveness response.
 *
 * The 100 ms cap matches the contract documented on `/health`. We measure
 * latency even on the timeout path so dashboards can see "DB is slow"
 * separately from "DB is gone".
 */
export async function pingDb(
  timeoutMs: number = DB_PING_TIMEOUT_MS,
): Promise<DbPingResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { connected: false, latencyMs: null };
  }
  const { db } = connect(databaseUrl);
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(dsql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('db ping timed out'));
        }, timeoutMs);
      }),
    ]);
    return {
      connected: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      connected: false,
      latencyMs: Math.round(performance.now() - start),
    };
  } finally {
    clearTimeout(timer);
  }
}
