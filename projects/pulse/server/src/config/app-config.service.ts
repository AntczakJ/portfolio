import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Typed facade over `@nestjs/config`'s `ConfigService`.
 *
 * `ConfigService<Env, true>` (infer = true) makes `get(key)` return the
 * non-undefined inferred type because `validateEnv` guarantees the shape at
 * boot. Modules inject `AppConfigService` rather than reaching into the raw
 * `ConfigService` so the env contract stays in one typed place.
 */
@Injectable()
export class AppConfigService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get redisUrl(): string {
    return this.config.get('REDIS_URL', { infer: true });
  }

  get demoTriggerEnabled(): boolean {
    return this.config.get('DEMO_TRIGGER_ENABLED', { infer: true });
  }

  /**
   * Server-wide HMAC-SHA256 key for signing outbound webhook payloads (ADR-005,
   * Phase 5.2). A per-channel `secret` overrides this; this is the fallback for
   * a channel created without one. `undefined` if unset — the webhook
   * dispatcher then refuses to send an unsigned payload.
   */
  get webhookSigningKey(): string | undefined {
    return this.config.get('WEBHOOK_SIGNING_KEY', { infer: true });
  }

  /**
   * Browser origins allowed to open the SSE streams with credentials (ADR-003).
   * DEV: the pulse-web origin (:3081). PROD: the single-origin reverse-proxy
   * posture makes this effectively unused (same-origin EventSource).
   */
  get corsOrigins(): string[] {
    return this.config.get('CORS_ORIGINS', { infer: true });
  }

  /**
   * better-auth signing secret (ADR-006 / ADR-007, Phase 6). `undefined` if
   * unset — the AuthModule fails loudly at build time rather than silently
   * starting an insecure auth surface.
   */
  get betterAuthSecret(): string | undefined {
    return this.config.get('BETTER_AUTH_SECRET', { infer: true });
  }

  /**
   * better-auth canonical base URL (the origin it issues cookies / callbacks
   * against). DEV: the API origin (:3080). PROD: the deployed API origin behind
   * the pulse-web proxy.
   */
  get betterAuthUrl(): string | undefined {
    return this.config.get('BETTER_AUTH_URL', { infer: true });
  }
}
