// The jitless Zod global side-effect MUST run before any schema is built so the
// runtime WS-frame validation path is CSP-safe (ADR-003 / ADR-006). The shared
// schema barrel imports it too, but we import it explicitly as the very first
// line of the entrypoint for belt-and-braces — it is idempotent.
import 'atlas-shared/schemas';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.schema.js';
import { COMMIT_SHA } from './lib/commit.js';

/**
 * atlas-server entrypoint (Task 1.1).
 *
 * Validates the environment (fail-fast), builds the Fastify app, and binds
 * 0.0.0.0:PORT. Graceful shutdown drains the Fastify server + the postgres-js
 * pool on SIGTERM / SIGINT so a redeploy does not drop in-flight requests or
 * leak DB connections.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const { app, dbHandle } = await buildApp(env);

  const shutdown = (signal: string): void => {
    app.log.info(`received ${signal}, shutting down`);
    void (async () => {
      try {
        await app.close();
        await dbHandle.sql.end({ timeout: 5 });
      } catch (err) {
        app.log.error({ err }, 'error during shutdown');
        process.exitCode = 1;
      } finally {
        process.exit();
      }
    })();
  };
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });

  // Bind 0.0.0.0 (Task 1.1). Dual-stack split-process / 6PN concerns (the pulse
  // `::` bind) do not apply: Atlas is a single Fly machine fronted by the edge,
  // and 0.0.0.0 is what the brief pins for the dev server.
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  app.log.info(
    `atlas-server (commit ${COMMIT_SHA}) listening on http://0.0.0.0:${String(env.PORT)} [env=${env.NODE_ENV}]`,
  );
}

main().catch((err: unknown) => {
  // The Fastify logger may not exist yet if boot failed early (e.g. env
  // validation), so write the failure to stderr directly before exiting.
  process.stderr.write(`atlas-server failed to start: ${String(err)}\n`);
  process.exit(1);
});
