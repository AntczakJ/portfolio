/**
 * Resolve the current git commit short SHA at process start.
 *
 * Tries, in order:
 *   1. `TAPE_COMMIT_SHA` env var (CI / container builds set this).
 *   2. `git rev-parse --short HEAD` via Bun.spawnSync (local dev).
 *   3. Literal 'dev' as last resort.
 *
 * Resolved once at module load — the value is stable for the lifetime of
 * the process. The health endpoint uses it; we do not pay for a git call
 * per request.
 */

const fromEnv = (): string | null => {
  const raw = process.env.TAPE_COMMIT_SHA;
  return raw && raw.length > 0 ? raw.slice(0, 12) : null;
};

const fromGit = (): string | null => {
  try {
    const result = Bun.spawnSync({
      cmd: ['git', 'rev-parse', '--short', 'HEAD'],
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) return null;
    const sha = new TextDecoder().decode(result.stdout).trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
};

export const COMMIT_SHA: string = fromEnv() ?? fromGit() ?? 'dev';
