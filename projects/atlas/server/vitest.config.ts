import { defineConfig } from 'vitest/config';

/**
 * atlas-server test config. Co-located `*.test.ts` smoke/sanity suites for the
 * simulation engine live alongside the source. Phase 3 lands a few load-bearing
 * invariant tests now (determinism fold-to-N, vehicles actually move, a geofence
 * event fires deterministically); the heavy reducer + geo suite is Phase 8
 * (Task 8.1).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
