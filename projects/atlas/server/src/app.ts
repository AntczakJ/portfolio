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
import { EngineService } from './engine/engine-service.js';
import { registerWsGateway } from './gateway/ws-gateway.js';
import { registerHealthRoute } from './routes/health.js';
import { registerPublicReadRoutes } from './routes/public-read.js';

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
 * The simulation engine (the composition root {@link EngineService}) and the
 * `@fastify/websocket` gateway (ADR-003) register here (Phase 4); the REST read
 * routes follow in their phase. The caller owns the lifecycle: `engineService`
 * is returned so `main.ts` calls `start()` at boot and `await stop()` on
 * shutdown (the sink flush). The DB pool lifetime stays with the caller too.
 */
export interface BuiltApp {
  app: FastifyInstance;
  dbHandle: AtlasDbHandle;
  engineService: EngineService;
}

/**
 * Optional overrides for the build — test/smoke seams only (the production boot
 * passes nothing, so the contract defaults stand: the 20 s heartbeat, etc.).
 */
export interface BuildAppOptions {
  /** Override the WS heartbeat cadence (ms). Smoke/tests shorten it. */
  readonly heartbeatIntervalMs?: number;
}

export async function buildApp(env: Env, options: BuildAppOptions = {}): Promise<BuiltApp> {
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

  // The in-process simulation engine (ADR-002/ADR-007): one engine, one source
  // of truth. The persistence sink writes off the tick hot path and NEVER
  // propagates a DB failure into the loop (so the live WS channel works even
  // without a reachable Postgres — the sink logs and drops). `app.log` satisfies
  // the sink's logger contract.
  const engineService = new EngineService(dbHandle.db, app.log);

  // Public read REST endpoints (Task 6.3 / ADR-005): the fleet snapshot, route,
  // zone, and vehicle definitions, served DB-LESS from the engine (the read
  // surface the SSR floor / no-WebGL paint / external consumers use). Each route
  // carries its own per-route rate limit (overriding the global floor) and a
  // cache-control posture (static defs cacheable; the live snapshot no-store).
  registerPublicReadRoutes(app, { engineService });

  // The `@fastify/websocket` telemetry gateway (ADR-003): snapshot-on-connect,
  // per-tick coalesced broadcast, event frames, 20 s heartbeat, Zod-validated +
  // rate-limited control frames, server-side scoping, backpressure.
  await registerWsGateway(app, {
    engineService,
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
  });

  return { app, dbHandle, engineService };
}
