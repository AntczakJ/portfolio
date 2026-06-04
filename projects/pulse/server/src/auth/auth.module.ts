import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CurrentOwnerService } from './current-owner';

/**
 * Auth module (Task 6.1, ADR-007) — the better-auth integration + the
 * owner-resolution seam.
 *
 * Hosts:
 *   - `AuthService` — builds + owns the better-auth instance (email+password
 *     sign up / in / out / session), exposes `getSession(headers)`.
 *   - `AuthController` — the `/api/auth/*` catch-all forwarding to better-auth's
 *     handler (sign-up/in/out/session + the built-in brute-force rate limit).
 *   - `CurrentOwnerService` — the SINGLE owner-resolution seam (ADR-007): a
 *     valid session -> that user (their private workspace); no session -> the
 *     seeded demo owner (the shared, READ-only demo workspace). `requireUserId`
 *     rejects the demo fallback so mutations need a real session.
 *
 * `@Global` so `AuthService` + `CurrentOwnerService` are injectable in every
 * feature module (monitors / alerts / stream / public) WITHOUT each importing
 * AuthModule and risking a circular graph — the same posture DbModule /
 * RedisModule use for their shared providers. WEB-process only (the worker
 * never serves HTTP / resolves a session).
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, CurrentOwnerService],
  exports: [AuthService, CurrentOwnerService],
})
export class AuthModule {}
