#!/usr/bin/env node
/**
 * CI gate: regenerate the bridge schema, then assert the working tree
 * under `src/lib/schemas/bridge/generated/` is clean.
 *
 * Non-zero exit if the generated files diverge from what is committed.
 * That is the ADR-003 promise — the Rust struct is canonical, the TS
 * sibling is a mirror, and a PR that touches the Rust side without
 * regenerating the mirror should fail CI.
 *
 * Run via: `pnpm -F tape-server bridge:check`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const generateScript = resolve(here, 'bridge-generate.mjs');
const generatedDir = resolve(here, '..', 'src', 'lib', 'schemas', 'bridge', 'generated');

const gen = spawnSync(process.execPath, [generateScript], { stdio: 'inherit' });
if (gen.status !== 0) {
  console.error('bridge:check — bridge:generate failed; aborting before git diff.');
  process.exit(gen.status ?? 1);
}

const diff = spawnSync('git', ['diff', '--exit-code', '--', generatedDir], {
  stdio: 'inherit',
});

if (diff.error) {
  console.error(
    `bridge:check failed to spawn git (${diff.error.message}). ` +
      `Ensure git is installed and on PATH.`,
  );
  process.exit(1);
}

if (diff.status !== 0) {
  console.error(
    '\nbridge:check — generated TypeScript under src/lib/schemas/bridge/generated/ ' +
      'is out of sync with the Rust source in ../worker/. ' +
      'Run `pnpm -F tape-server bridge:generate` and commit the diff.',
  );
  process.exit(diff.status ?? 1);
}

process.exit(0);
