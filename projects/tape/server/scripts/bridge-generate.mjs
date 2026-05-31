#!/usr/bin/env node
/**
 * Regenerate the bridge TypeScript schema from the Rust worker crate.
 *
 * Why a Node driver instead of an inline pnpm script:
 *   - Cross-platform `cd ../worker && cargo test` is fragile (PowerShell 5.1
 *     does not chain with `&&` reliably; cmd.exe needs a different shape).
 *   - Cargo's `.cargo/config.toml` is resolved from the *current working
 *     directory*, not the `--manifest-path` directory, so we must actually
 *     spawn cargo with `cwd = worker/` for `TS_RS_EXPORT_DIR` to take effect.
 *   - A short driver keeps the contract (exit code, console output) the same
 *     on every host the script runs on.
 *
 * Run via: `pnpm -F tape-server bridge:generate`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, '..', '..', 'worker');

const result = spawnSync('cargo', ['test', '--quiet'], {
  cwd: workerDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(
    `bridge:generate failed to spawn cargo (${result.error.message}). ` +
      `Ensure Rust is installed and ~/.cargo/bin is on PATH.`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
