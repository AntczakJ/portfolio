import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigService } from './config/app-config.service';
import { AppModule } from './app.module';
import { COMMIT_SHA } from './lib/commit';

/**
 * pulse-server entrypoint (Task 1.1).
 *
 * Binds 0.0.0.0:PORT (required so the Fly machine / a container can reach it,
 * not just localhost). Enables Nest shutdown hooks so the DbModule /
 * RedisModule drain their pools on SIGTERM/SIGINT (graceful queue drain
 * lands with the worker in Phase 2; the connection drain is wired today).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Trust the reverse proxy (pulse-web -> pulse-api, ADR-006) so `req.ip`
  // honours `x-forwarded-for`. This is what lets better-auth key its
  // brute-force rate limiter on the REAL client IP behind the proxy (rather
  // than the proxy's address), and what the public-endpoint RateLimitGuard
  // reads. Express `trust proxy` is set on the underlying adapter.
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  instance.set?.('trust proxy', true);

  // OnApplicationShutdown hooks (pool drain) require explicit enabling.
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const port = config.port;

  // CORS for the cross-origin DEV setup (pulse-web :3081 -> pulse-api :3080).
  // `credentials: true` is REQUIRED for the dashboard `EventSource` to send the
  // better-auth session cookie (Phase 6) under `new EventSource(url, {
  // withCredentials: true })`; with credentials the allowed origin must be an
  // explicit allowlist (never `*`), so we reflect the configured web origin(s).
  //
  // DEV vs PROD origin posture (ADR-006, meld precedent): in PRODUCTION the Next
  // app (`pulse-web`) reverse-proxies the API so the browser sees a SINGLE
  // origin — the EventSource hits `/api/stream` same-origin, the cookie is
  // first-party, and this CORS allowance is effectively unused. It exists for
  // the local two-origin dev loop. The allowlist is config-driven so prod can
  // tighten/clear it.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    // `Last-Event-ID` must be allowed so a cross-origin EventSource reconnect
    // can carry the resume cursor.
    allowedHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
  });

  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(
    `pulse-server (commit ${COMMIT_SHA}) listening on http://0.0.0.0:${String(port)} ` +
      `[env=${config.nodeEnv}]`,
  );
}

void bootstrap();
