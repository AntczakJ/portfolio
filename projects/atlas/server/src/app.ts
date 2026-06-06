import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { Env } from './config/env.schema.js';
import { createDbHandle, type AtlasDbHandle } from './db/drizzle.js';
import { registerHealthRoute } from './routes/health.js';

/**
 * Atlas Fastify app builder (Task 1.1).
 *
 * Wires the Zod type provider (so routes declare request/response schemas as
 * Zod and Fastify generates the validator + serializer from them — the shared
 * `src/lib/schemas` contract becomes the route contract), CORS for the dev
 * two-origin loop, and a baseline global rate limit on the public surface
 * (per-route + WS limits tighten in their phases). Returns the app plus the DB
 * handle so the caller owns the pool lifetime and drains it on shutdown.
 *
 * The simulation engine, the `@fastify/websocket` gateway, and the REST read
 * routes register here in later phases; Phase 1 is config + health + DB wiring.
 */
export interface BuiltApp {
  app: FastifyInstance;
  dbHandle: AtlasDbHandle;
}

export async function buildApp(env: Env): Promise<BuiltApp> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    // Atlas sits behind the Fly edge / the web reverse proxy in prod, so honour
    // x-forwarded-* for the real client IP the rate limiter keys on.
    trustProxy: true,
  });

  // Zod-everywhere: validate requests and serialize responses through Zod
  // schemas declared on each route (fastify-type-provider-zod).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Turn a Zod validation failure into a clean 400 with the issue list rather
  // than a 500. Other errors propagate to Fastify's default handler (we do not
  // swallow them).
  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Request does not match the expected schema.',
        issues: error.validation,
      });
    }
    throw error;
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });

  // Baseline limit on the public surface (ADR-003 / security posture). The WS
  // connection + per-message limits and the per-route REST limits tighten in
  // their own phases; this is the global floor.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  const dbHandle = createDbHandle(env.DATABASE_URL);

  registerHealthRoute(app);

  return { app, dbHandle };
}
