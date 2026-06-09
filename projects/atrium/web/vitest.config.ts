import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config — atrium-web unit suite (Phase 6, Task 6.1).
 *
 * Covers the typed project-data layer: the `Project` Zod schema
 * (`src/lib/schemas/project.ts`) and the validated `PROJECTS` config
 * (`src/data/projects.ts`) + the single `GITHUB_BASE` seam
 * (`src/lib/site-config.ts`). These are the only units with an invariant worth
 * isolating from the UI (the web-only thesis — there is nothing else to test in
 * isolation). Tests are co-located next to source as `*.test.ts`.
 *
 * jsdom is used for parity with the sibling harnesses even though these specs
 * are pure data assertions; it costs nothing and keeps one config shape.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
  },
});
