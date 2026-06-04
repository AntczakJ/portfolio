import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { DRIZZLE } from '../db/db.module';
import type { PulseDb } from '../db/drizzle';
import { resolveOwnerUserId } from '../monitors/dev-owner';
import { AuthService } from './auth.service';

/** The minimal request shape the owner seam needs (the inbound cookie header). */
export interface OwnerRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A resolved owner for a request. `kind` makes the demo-vs-authed distinction
 * explicit so a caller (a write guard) can reject the demo fallback crisply.
 */
export interface ResolvedOwner {
  userId: string;
  kind: 'authenticated' | 'demo';
}

/**
 * The owner-resolution seam (ADR-007, Phase 6) — the SINGLE place that turns a
 * request into "whose workspace is this".
 *
 * THE DEMO-OPEN POSTURE, made crisp (ADR-007):
 *   - An AUTHENTICATED request (a valid better-auth session cookie) resolves to
 *     THAT user — they get their own private workspace (their monitors /
 *     incidents / alerts, scoped by `users.id`).
 *   - An UNAUTHENTICATED request resolves to the seeded DEMO owner
 *     (`owner@pulse.local`, the same id Phases 1-5 used via `resolveOwnerUserId`)
 *     — so an anonymous visitor lands in the shared demo workspace and can READ
 *     the live board / monitor detail / incidents without a login wall (the wow
 *     moment is not gated).
 *
 * This replaces the Phase-1 `resolveOwnerUserId(db)` call sites and the Phase-3
 * `getCurrentUserId` stream seam. The DISTINCTION (`kind`) is what the write
 * guard keys off: reads accept either kind; mutations require `authenticated`.
 *
 * Keeping this one seam (not scattered `if (session) ... else ...` across every
 * controller) is the ADR-007 "crisp boundary, not scattered ifs" requirement.
 */
@Injectable()
export class CurrentOwnerService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DRIZZLE) private readonly db: PulseDb,
  ) {}

  /**
   * Resolve the owner for a request: the session user if authenticated, else
   * the demo owner. Used by READ paths (which serve the demo workspace to
   * anonymous visitors) and as the first step of `requireUser`.
   */
  async resolveOwner(req: OwnerRequest): Promise<ResolvedOwner> {
    const session = await this.auth.getSession(req.headers);
    if (session) {
      return { userId: session.userId, kind: 'authenticated' };
    }
    // Demo fallback: the shared seeded workspace, READ-ONLY for anonymous
    // visitors (write endpoints call `requireUser`, which rejects this kind).
    const demoUserId = await resolveOwnerUserId(this.db);
    return { userId: demoUserId, kind: 'demo' };
  }

  /**
   * Resolve the owner's user id (the value every WHERE clause pins). The READ
   * shortcut — equivalent to `resolveOwner(req).userId`.
   */
  async resolveOwnerUserId(req: OwnerRequest): Promise<string> {
    const { userId } = await this.resolveOwner(req);
    return userId;
  }

  /**
   * Require a REAL authenticated user (the WRITE path). Rejects the demo
   * fallback with a 401 carrying a clear "sign in to manage" shape the frontend
   * surfaces as a tasteful prompt — the demo visitor can VIEW everything but
   * cannot mutate (ADR-007).
   *
   * The demo-incident trigger is the deliberate exception: it does NOT call
   * this (it is safe + it is the wow), so an anonymous visitor can fire it.
   */
  async requireUserId(req: OwnerRequest): Promise<string> {
    const owner = await this.resolveOwner(req);
    if (owner.kind !== 'authenticated') {
      throw new UnauthorizedException({
        error: 'authentication_required',
        message: 'Sign in to manage monitors and alert channels.',
      });
    }
    return owner.userId;
  }
}
