import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PulseDb } from '../db/drizzle';
import type { AuthService, AuthSession } from './auth.service';
import { CurrentOwnerService } from './current-owner';

/**
 * The owner-resolution seam tests (ADR-007) — the crux of the demo-open
 * posture:
 *   - a valid session resolves to THAT user (their private workspace);
 *   - no session resolves to the seeded DEMO owner for READS;
 *   - `requireUserId` (the WRITE guard) ALLOWS an authed user but REJECTS the
 *     demo fallback with a 401.
 *
 * These are the "auth guard blocks demo-fallback on a mutation but allows it on
 * a read" assertions the brief requires.
 */

const DEMO_OWNER_ID = '00000000-0000-0000-0000-0000000000de';
const AUTHED_SESSION: AuthSession = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'real@user.test',
  name: 'Real User',
};

/** A db stub whose select chain returns the demo owner row (the dev-owner seam). */
function fakeDbReturningDemoOwner(): PulseDb {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ id: DEMO_OWNER_ID }]) }),
      }),
    }),
  } as unknown as PulseDb;
}

function makeService(session: AuthSession | null): CurrentOwnerService {
  const auth = {
    getSession: vi.fn().mockResolvedValue(session),
  } as unknown as AuthService;
  return new CurrentOwnerService(auth, fakeDbReturningDemoOwner());
}

const REQ = { headers: { cookie: 'whatever' } };

describe('CurrentOwnerService.resolveOwner (READ path)', () => {
  it('resolves an authenticated request to the session user (private workspace)', async () => {
    const svc = makeService(AUTHED_SESSION);
    const owner = await svc.resolveOwner(REQ);
    expect(owner.kind).toBe('authenticated');
    expect(owner.userId).toBe(AUTHED_SESSION.userId);
  });

  it('falls back to the seeded demo owner for an unauthenticated request', async () => {
    const svc = makeService(null);
    const owner = await svc.resolveOwner(REQ);
    expect(owner.kind).toBe('demo');
    expect(owner.userId).toBe(DEMO_OWNER_ID);
  });

  it('resolveOwnerUserId returns the demo owner id unauthenticated (reads work)', async () => {
    const svc = makeService(null);
    await expect(svc.resolveOwnerUserId(REQ)).resolves.toBe(DEMO_OWNER_ID);
  });
});

describe('CurrentOwnerService.requireUserId (WRITE guard)', () => {
  it('ALLOWS an authenticated user (returns their id)', async () => {
    const svc = makeService(AUTHED_SESSION);
    await expect(svc.requireUserId(REQ)).resolves.toBe(AUTHED_SESSION.userId);
  });

  it('REJECTS the demo fallback with a 401 "authentication_required"', async () => {
    const svc = makeService(null);
    await expect(svc.requireUserId(REQ)).rejects.toBeInstanceOf(UnauthorizedException);
    // The error shape the frontend surfaces as "sign in to manage".
    await svc.requireUserId(REQ).catch((err: unknown) => {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const response = (err as UnauthorizedException).getResponse() as {
        error: string;
      };
      expect(response.error).toBe('authentication_required');
    });
  });
});
