import { Inject, Injectable, Logger } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';

import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { createAuth, type PulseAuth } from './auth';

/**
 * The resolved session, narrowed to what the rest of the app needs: the user
 * id (the owner key every WHERE clause pins) + the email for logging / UI.
 */
export interface AuthSession {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Wraps the better-auth instance (ADR-007, Phase 6).
 *
 * Builds the instance once at construction from the validated config (failing
 * LOUDLY if the secret / URL are missing — we never start an insecure auth
 * surface silently), and exposes:
 *   - `instance` — the raw better-auth handle (the controller forwards HTTP to
 *     `instance.handler`),
 *   - `getSession(headers)` — read the session off the request cookie (the
 *     guard + the owner-resolution seam use this).
 *
 * The dashboard `EventSource` cannot set headers, but it DOES send the session
 * cookie (`withCredentials: true`), and `getSession` reads exactly that cookie
 * — which is why SSE-over-cookie auth works without a second credential
 * (ADR-001 / ADR-003).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  readonly instance: PulseAuth;

  constructor(
    @Inject(DRIZZLE) db: PulseDb,
    @Inject(AppConfigService) config: AppConfigService,
  ) {
    const secret = config.betterAuthSecret;
    const baseURL = config.betterAuthUrl;
    if (!secret || secret.length < 16) {
      throw new Error(
        'BETTER_AUTH_SECRET is required (>=16 chars) once the auth module is wired (Phase 6). ' +
          'Set it in .env (e.g. `openssl rand -base64 32`).',
      );
    }
    if (!baseURL) {
      throw new Error(
        'BETTER_AUTH_URL is required once the auth module is wired (Phase 6). ' +
          'Set it to the API origin (dev: http://localhost:3080; prod: the deployed API origin).',
      );
    }

    this.instance = createAuth(db, {
      secret,
      baseURL,
      // The dashboard web origins are exactly the SSE CORS allowlist — the same
      // origins that may carry the credentialed session cookie cross-origin in
      // dev (ADR-003). In the prod single-origin proxy these are same-origin.
      trustedOrigins: config.corsOrigins,
      isProduction: config.isProduction,
    });

    this.logger.log(
      `better-auth wired (baseURL=${baseURL}, trustedOrigins=[${config.corsOrigins.join(', ')}], ` +
        `secure-cookies=${String(config.isProduction)})`,
    );
  }

  /**
   * Read the session from the inbound request headers (the cookie). Returns
   * `null` for an unauthenticated request (no / invalid session) — the caller
   * decides whether that is a guard rejection (mutations) or the demo fallback
   * (reads). Never throws for a missing session; only logs an unexpected error.
   */
  async getSession(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthSession | null> {
    try {
      const result = await this.instance.api.getSession({
        headers: fromNodeHeaders(headers),
      });
      if (!result) return null;
      return {
        userId: result.user.id,
        email: result.user.email,
        name: result.user.name,
      };
    } catch (err) {
      // A malformed cookie / transient store error is treated as "no session"
      // (the request degrades to unauthenticated), but it is logged so a real
      // auth-store failure is visible rather than silently swallowed.
      this.logger.warn(
        `getSession failed; treating as unauthenticated: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
