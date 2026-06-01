/**
 * meld-server lint config — re-exports the monorepo root flat config
 * plus a local ignore for `scripts/**`.
 *
 * Per docs/conventions.md § 13, we do not pre-emptively extract
 * packages/eslint-config until the third project arrives and a real
 * divergence forces it. For now the root config covers every project
 * in the monorepo; this file just forwards.
 *
 *  - `scripts/**` is the Node-driven smoke / utility set (Task 1.4
 *    `ws-smoke.ts` etc.). They live outside `tsconfig.json`'s `include`
 *    glob on purpose (they are not server source) so the type-aware
 *    project service cannot resolve them — we ignore them rather than
 *    relax tsconfig's `rootDir`. Matches tape's pattern.
 */
import rootConfig from '../../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    ignores: ['**/scripts/**'],
  },
];
