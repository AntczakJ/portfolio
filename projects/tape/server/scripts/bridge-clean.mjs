#!/usr/bin/env node
/**
 * Delete every generated bridge schema file. Used to verify
 * `bridge:generate` writes a complete tree from scratch, and to clear
 * the slate before a Rust struct rename / removal where ts-rs would
 * otherwise leave orphan `.ts` files behind.
 *
 * Run via: `pnpm -F tape-server bridge:clean`.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = resolve(here, '..', 'src', 'lib', 'schemas', 'bridge', 'generated');

let entries;
try {
  entries = readdirSync(generatedDir);
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    console.log(`bridge:clean — ${generatedDir} does not exist; nothing to do.`);
    process.exit(0);
  }
  throw err;
}

for (const entry of entries) {
  const full = join(generatedDir, entry);
  const stat = statSync(full);
  if (stat.isFile() && entry.endsWith('.ts')) {
    rmSync(full);
  }
}

console.log(`bridge:clean — removed ${entries.filter((e) => e.endsWith('.ts')).length} file(s).`);
