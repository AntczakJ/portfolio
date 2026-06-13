import { z } from 'zod';

/**
 * Health-response schema (Task 1.1). `GET /health` validates its own response
 * against this at the boundary before returning, so the liveness contract is
 * enforced, not just documented.
 *
 * `status` is `ok` only when both dependencies are healthy; otherwise
 * `degraded` (the process is up but a dependency is not). The endpoint still
 * returns 200 with `degraded` so a fresh checkout / partial outage gets a
 * structured payload rather than a 500 (the tolerant-liveness posture meld
 * uses for `pingDb`).
 */
export const dependencyHealthSchema = z.object({
  connected: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  commit: z.string(),
  ts: z.iso.datetime(),
  db: dependencyHealthSchema,
  redis: dependencyHealthSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
