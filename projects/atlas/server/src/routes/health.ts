import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { COMMIT_SHA } from '../lib/commit.js';

/**
 * Health route (Task 1.1). `GET /health` -> `{ status, commit, ts }`.
 *
 * Schema-first via `fastify-type-provider-zod`: the response shape is a Zod
 * schema, so the serializer is generated from it and the handler return type is
 * inferred (no hand-written DTO). This is the first use of the shared-Zod /
 * Fastify seam the WS gateway + REST surface build on.
 *
 * Liveness only in Phase 1 — it does not probe the DB. A deeper readiness check
 * (DB ping) can layer on later without changing this contract.
 */
const healthResponseSchema = z.object({
  status: z.literal('ok'),
  commit: z.string(),
  /** Server time, epoch milliseconds. */
  ts: z.number().int().nonnegative(),
});

export function registerHealthRoute(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    () => ({
      status: 'ok' as const,
      commit: COMMIT_SHA,
      ts: Date.now(),
    }),
  );
}
