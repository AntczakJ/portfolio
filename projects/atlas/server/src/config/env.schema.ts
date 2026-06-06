import { z } from 'zod';

/**
 * Boot-time environment validation (Task 1.1).
 *
 * The single source of truth for what atlas-server reads from the environment.
 * `loadEnv` runs at startup BEFORE the Fastify app is built, so a missing or
 * malformed REQUIRED var aborts the boot with a precise message rather than
 * failing deep in a request later (the pulse/meld/tape fail-fast posture).
 *
 * Phase boundaries:
 *   - Phase 1 hard-required at boot: PORT, NODE_ENV, DATABASE_URL.
 *   - CORS_ORIGINS is optional with a dev default (the atlas-web origin).
 */
export const envSchema = z.object({
  // --- Phase 1: core runtime ---
  PORT: z.coerce.number().int().positive().default(3092),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Phase 1: persistence (ADR-005) ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string).'),

  // --- Phase 2/4: cross-origin dev posture ---
  // Comma-separated browser-origin allowlist for the REST read surface + the
  // WebSocket. DEV default is the atlas-web dev origin (:3093). Never `*` with
  // credentials. In the PROD single-origin proxy posture this is effectively
  // unused; set it to the prod web origin (or empty) there.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3093')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse + validate `process.env`. Throws a single aggregated error listing
 * every failing var so the operator fixes them in one pass.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration for atlas-server:\n${issues}\n` +
        'Copy server/.env.example to server/.env and fill in the required vars.',
    );
  }
  return parsed.data;
}
