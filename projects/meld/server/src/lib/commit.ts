/**
 * Resolve the current git commit short SHA at process start.
 *
 * Tries, in order:
 *   1. `MELD_COMMIT_SHA` env var (CI / container builds set this).
 *   2. `git rev-parse --short HEAD` via `node:child_process` (local dev).
 *   3. Literal 'dev' as last resort.
 *
 * Resolved once at module load — the value is stable for the lifetime of
 * the process. The health endpoint uses it; we do not pay for a git call
 * per request.
 *
 * Mirrors tape's `src/lib/commit.ts` shape, ported from `Bun.spawnSync`
 * to Node's `node:child_process` (ADR-001 pinned Node 22 as the v1
 * runtime). The env-var name is rebranded to `MELD_COMMIT_SHA` so a
 * shared CI environment with both projects building does not collide.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const fromEnv = (): string | null => {
  const raw = process.env.MELD_COMMIT_SHA;
  return raw !== undefined && raw.length > 0 ? raw.slice(0, 12) : null;
};

const fromGit = (): string | null => {
  try {
    const cwd = dirname(fileURLToPath(import.meta.url));
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const sha = result.stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
};

export const COMMIT_SHA: string = fromEnv() ?? fromGit() ?? 'dev';
