/**
 * atlas-shared lint config — re-exports the monorepo root flat config.
 *
 * Per docs/conventions.md section 13 we do not pre-emptively extract
 * packages/eslint-config; the root config covers every project. This file
 * forwards it so `pnpm -F atlas-shared lint` resolves a config from the
 * package root (mirrors pulse/meld/tape).
 */
import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    ignores: ['**/dist/**', '**/server/**', '**/web/**', '**/e2e/**'],
  },
];
