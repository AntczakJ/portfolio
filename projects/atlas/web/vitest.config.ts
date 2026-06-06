import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config — unit/component tests for the Atlas web client.
 *
 * The Phase 2 scaffold ships a couple of pure-logic suites (the static-fixture
 * shape, the map style token mapping). Heavier component/E2E coverage lands in
 * Phase 8 (test-engineer). `jsdom` for the DOM-touching units; `@/` alias
 * mirrors the tsconfig path so test imports match source imports.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
