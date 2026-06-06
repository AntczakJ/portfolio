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
  const { app, dbHandle, engineService } = await buildApp(env);

  const shutdown = (signal: string): void => {
    app.log.info(`received ${signal}, shutting down`);
    void (async () => {
      try {
        // Stop the engine first so the loop halts and the sink flushes its last
        // queued events/snapshot; then close Fastify (the gateway's onClose hook
        // drains live sockets); then end the DB pool.
        await engineService.stop();
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

  // Bind `::` (dual-stack: IPv6 + IPv4-mapped). This is REQUIRED on Fly: the
  // separate atlas-web (atlas-ops) app reverse-proxies /ws + /health to this
  // server over Fly's private 6PN network, which is IPv6-only — a `0.0.0.0`
  // (IPv4-only) bind is reachable by the public edge but REFUSES the private
  // app-to-app IPv6 connection (ECONNREFUSED on the .internal address), which
  // breaks the same-origin WS proxy (ADR-006/007). `::` accepts both, so the
  // public edge AND the private 6PN hop both connect, and localhost dev still
  // resolves over IPv4-mapped (the pulse `::` precedent).
  await app.listen({ port: env.PORT, host: '::' });

  // Start the simulation loop AFTER the server is listening so the warm-floor
  // fleet is already moving on first paint (ADR-007). The engine boots from the
  // frozen Porto baseline directly (no DB dependency — ADR-005), so the live WS
  // channel works even before the seed runs / without Postgres.
  engineService.start();

  app.log.info(
    `atlas-server (commit ${COMMIT_SHA}) listening on [::]:${String(env.PORT)} [env=${env.NODE_ENV}] — engine running, ws at /ws`,
  );
}

main().catch((err: unknown) => {
  // The Fastify logger may not exist yet if boot failed early (e.g. env
  // validation), so write the failure to stderr directly before exiting.
  process.stderr.write(`atlas-server failed to start: ${String(err)}\n`);
  process.exit(1);
});
