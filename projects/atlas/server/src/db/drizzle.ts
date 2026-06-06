import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * postgres-js client + Drizzle ORM handle factory (ADR-005 D1).
 *
 * Atlas runs a SINGLE process (the in-process engine + WS gateway + REST,
 * ADR-002/ADR-007), so one small pool against the same Postgres. The engine's
 * persistence writes go through a queued async sink off the tick hot path
 * (Task 3.3) — the tick loop never blocks on a DB write.
 *
 * The handle's lifetime is owned by the caller (the app builder), which closes
 * the pool on shutdown. postgres-js is first-class on Node 22 and owns its own
 * pool.
 */
export type AtlasDb = ReturnType<typeof drizzle<typeof schema>>;

export interface AtlasDbHandle {
  sql: ReturnType<typeof postgres>;
  db: AtlasDb;
}

export function createDbHandle(databaseUrl: string, max = 10): AtlasDbHandle {
  const sql = postgres(databaseUrl, {
    max,
    onnotice: () => {
      // Silence Postgres NOTICE noise in the dev log.
    },
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export { schema };
