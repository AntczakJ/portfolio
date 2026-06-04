import { defineConfig } from 'vitest/config';

/**
 * Vitest config for pulse-server.
 *
 * Phase 1 unit tests are pure-function suites (the SSRF guard is the
 * security-critical one — ADR-002). They do not need the Nest DI container
 * or a database, so the default `node` environment with no setup file is
 * enough. Integration tests against a real Postgres/Redis (testcontainers
 * or the docker-compose stack) land with the probe runner + incident engine
 * in later phases.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
