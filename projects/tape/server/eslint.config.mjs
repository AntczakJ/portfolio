/**
 * tape-server lint config — re-exports the monorepo root flat config
 * plus two local ignores for the bridge codegen pipeline (Task 1.4b).
 *
 * Per docs/conventions.md § 13, we do not pre-emptively extract
 * packages/eslint-config until the third project arrives and divergence
 * is real. For now the root config covers every project; the entries
 * below are scoped to this package.
 *
 *  - `src/lib/schemas/bridge/generated/**` is written by `ts-rs` from the
 *    Rust source of truth (ADR-003). The generated `.ts` files are
 *    committed but never hand-edited; linting them would force us to
 *    fight upstream stylistic decisions (e.g. `type` vs `interface`)
 *    that ts-rs's emitter owns.
 *  - `scripts/**` is the Node-driven `bridge:*` driver set. They live
 *    outside `tsconfig.json`'s `include` glob on purpose (they are not
 *    server source) so the type-aware project service cannot resolve
 *    them — we ignore them rather than relax tsconfig's `rootDir`.
 */
import rootConfig from '../../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    ignores: ['**/src/lib/schemas/bridge/generated/**', '**/scripts/**'],
  },
];
