import { z } from 'zod';

/**
 * Boot-time environment validation (Task 1.1).
 *
 * The schema is the single source of truth for what pulse-server reads from
 * the environment. `@nestjs/config` runs `validateEnv` at module load, so a
 * missing or malformed REQUIRED var aborts the boot with a precise message
 * rather than failing deep in a request later (the fail-fast posture the
 * AGENT_NOTES "no fallbacks on hot paths" pin demands).
 *
 * Phase boundaries (ADR-006 secrets inventory):
 *   - Phase 1 hard-required at boot: PORT, NODE_ENV, DATABASE_URL, REDIS_URL.
 *   - Phase 5/6 vars (BETTER_AUTH_*, WEBHOOK_SIGNING_KEY) are declared and
 *     validated WHEN PRESENT but are optional in Phase 1 so a fresh checkout
 *     boots without the auth / alert wiring that lands later. They become
 *     required by their own module's validation when that module wires them.
 *   - DEMO_TRIGGER_ENABLED is an optional boolean-ish flag (default true).
 */
export const envSchema = z.object({
  // --- Phase 1: core runtime ---
  PORT: z.coerce.number().int().positive().default(3080),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // --- Phase 1: persistence (ADR-005) ---
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (postgres connection string).'),

  // --- Phase 1: queue + real-time bridge (ADR-002 / ADR-003) ---
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required (redis connection string).'),

  // --- Phase 6: auth (better-auth) — WIRED (ADR-007) ---
  // Kept OPTIONAL at the env level so the WORKER process (which boots the same
  // config but never serves auth) and a fresh checkout still validate; the
  // WEB process's AuthService fails LOUDLY at construction if either is missing
  // (so the auth surface never starts insecure). BETTER_AUTH_URL must be the
  // API origin (dev http://localhost:3080; prod the deployed API origin behind
  // the pulse-web single-origin proxy).
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),

  // --- Phase 5: alerting (HMAC webhook signing) — optional until Phase 5 ---
  WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),

  // --- Phase 3/6: demo-incident mechanism (ADR-006) ---
  DEMO_TRIGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // --- Phase 3: SSE cross-origin dev posture (ADR-003 / ADR-006) ---
  // Comma-separated allowlist of browser origins permitted to open the SSE
  // streams WITH CREDENTIALS (the dashboard EventSource carries the session
  // cookie in Phase 6). DEV default is the pulse-web dev origin (:3081). In the
  // PRODUCTION single-origin reverse-proxy posture (pulse-web proxies the API)
  // the browser sees one origin and this is effectively unused; set it empty or
  // to the prod web origin there. Never `*` with credentials.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3081')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * `@nestjs/config` validation hook. Throws a single aggregated error listing
 * every failing var so the operator fixes them in one pass.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration for pulse-server:\n${issues}\n` +
        'Copy server/.env.example to server/.env and fill in the required vars.',
    );
  }
  return parsed.data;
}
