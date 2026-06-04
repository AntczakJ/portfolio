/**
 * pulse-server lint config — re-exports the monorepo root flat config,
 * ignores `scripts/**` (operational smoke clients outside tsconfig), and
 * relaxes two rules that fight NestJS's decorator + DI idiom.
 *
 * Per docs/conventions.md § 13 we do not pre-emptively extract
 * packages/eslint-config; the root config covers every project. This file
 * forwards it. Mirrors meld/tape's pattern.
 *
 *  - `scripts/**` — the Node-driven smoke / utility set (redis-smoke.ts).
 *    They live outside tsconfig's `include` glob on purpose (not server
 *    source) so the type-aware project service cannot resolve them; we
 *    ignore them rather than relax tsconfig's `rootDir`.
 *  - NestJS controllers/providers use parameter decorators and constructor
 *    injection heavily; `@typescript-eslint/no-extraneous-class` and the
 *    unbound-method check around RxJS/Nest lifecycle are noise here, scoped
 *    to src so they do not leak to the rest of the repo.
 */
import rootConfig from '../../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    ignores: ['**/scripts/**', '**/drizzle/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // NestJS modules are intentionally classes with only decorator
      // metadata; the empty-class lint does not apply to them.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Drizzle/postgres-js and Nest DI surface plenty of safe `any` at the
      // driver boundary; we keep the boundary explicit rather than fighting
      // the type-checked preset on framework-owned shapes.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];
