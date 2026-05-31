import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * - `schema` globs every file under `src/db/schema/`; each table lives in
 *   its own file (`sessions.ts` is the only one in Phase 1 Task 1.2; the
 *   trade-level table joins in Task 1.3, footprint cells in 1.5/1.6).
 * - `out` is the migration directory committed to the repo; never edit
 *   generated SQL by hand — regenerate from the schema.
 * - `DATABASE_URL` is required. We fail loudly here rather than silently
 *   pointing the migrator at a wrong default — same fail-fast rule the
 *   runtime DB client follows (see `src/db/index.ts`).
 *
 * Invoked via the package scripts (`pnpm -F tape-server db:generate`,
 * `db:migrate`, `db:studio`, `db:push`). drizzle-kit auto-loads a `.env`
 * file from the package root.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Copy .env.example to .env, or export DATABASE_URL before running drizzle-kit.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
