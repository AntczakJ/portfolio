/**
 * atlas-server lint config — re-exports the monorepo root flat config and
 * ignores generated migration SQL + build output.
 *
 * Per docs/conventions.md section 13 we do not pre-emptively extract
 * packages/eslint-config; the root config covers every project. This file
 * forwards it so `pnpm -F atlas-server lint` resolves a config from the package
 * root (mirrors pulse/meld/tape).
 */
import rootConfig from '../../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    ignores: ['**/drizzle/**', '**/dist/**'],
  },
];
