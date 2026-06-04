import { Controller, Get, Inject } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { COMMIT_SHA } from '../lib/commit';

/**
 * `GET /` — the API root banner.
 *
 * The API is a backend service, not a browsable site: every real route lives
 * under a prefix (`/health`, `/monitors`, `/incidents`, `/public`, `/api/auth`,
 * the `@Sse()` streams, `/demo/*`). Without this handler the bare root returns
 * Nest's default `Cannot GET /` 404, which reads as "broken" to a human who
 * lands on the API host directly (e.g. from a screenshot showing
 * `pulse-demo-api.fly.dev/demo/flaky`). This returns an intentional 200 service
 * banner that points such a visitor at the actual app (the web origin) and the
 * liveness endpoint — a small polish, not a functional route.
 */
@Controller()
export class RootController {
  // Explicit @Inject: the production runtime (tsx/esbuild) strips
  // `emitDecoratorMetadata`, so class-type DI by reflection does not resolve —
  // every class-service injection in this server is token-explicit. Omitting it
  // crashes the module on boot (the app then never binds the port).
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  root(): {
    service: string;
    status: string;
    message: string;
    app: string | null;
    health: string;
    commit: string;
  } {
    // The web app origin (the single-origin proxy front door). In prod this is
    // the configured CORS origin; null if none is set (the bare-API posture).
    const app = this.config.corsOrigins[0] ?? null;

    return {
      service: 'pulse-api',
      status: 'ok',
      message:
        'This is the Pulse API. The app lives at the web origin; this host serves the backend only.',
      app,
      health: '/health',
      commit: COMMIT_SHA,
    };
  }
}
