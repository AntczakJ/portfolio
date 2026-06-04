import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * postgres-js client + Drizzle ORM handle factory (ADR-005).
 *
 * Each process (`api` ~10, `worker` ~5 — ADR-005) owns a small pool against
 * the same Postgres, sized to stay under `max_connections`. In Phase 1 there
 * is one process (the API), so we size for the API tier; Phase 2 splits the
 * worker and gives it its own smaller pool.
 *
 * The connection is created from `DATABASE_URL` by the DbModule provider so
 * the lifetime is owned by the Nest container (closed on app shutdown). The
 * postgres-js driver is first-class on Node 22 and owns its own pool.
 */
export type PulseDb = ReturnType<typeof drizzle<typeof schema>>;

export interface PulseDbHandle {
  sql: ReturnType<typeof postgres>;
  db: PulseDb;
}

export function createDbHandle(databaseUrl: string, max = 10): PulseDbHandle {
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
