import { defineConfig } from 'vitest/config';

/**
 * atlas-shared test config. Smoke tests for the geo module live alongside the
 * source (`*.test.ts`). The heavy geo + reducer suites land in Phase 8
 * (Task 8.1); this Phase 1 config exists so a few invariant smoke tests run
 * now (route projection vs the turf `along` oracle, the geofence no-flap rule).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
