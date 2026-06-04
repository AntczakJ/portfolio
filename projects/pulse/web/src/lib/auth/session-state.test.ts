import { describe, expect, it } from 'vitest';

import {
  deriveAuthState,
  gateMutation,
  isAuthRequiredError,
} from './session-state';
import type { SessionResponse } from '@/lib/api/auth';

/**
 * The auth-state derivation + the demo-gating decision (Task 6.5, ADR-007) are
 * the unit-tested seam: "does this mutation proceed, or prompt sign-in?" The
 * product posture is keep-the-demo-open — reads never gate, writes do — so
 * getting this exactly right is what makes the prompt tasteful instead of a
 * wall (or a raw error).
 */

const session: SessionResponse = {
  user: { id: 'u1', email: 'a@b.com', name: 'Ada' },
  session: { id: 's1', expiresAt: '2099-01-01T00:00:00.000Z' },
};

describe('deriveAuthState', () => {
  it('is loading while the session query is in-flight on first load', () => {
    const state = deriveAuthState({
      data: undefined,
      isPending: true,
      isError: false,
    });
    expect(state.status).toBe('loading');
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.isAnonymous).toBe(false);
    expect(state.user).toBeNull();
  });

  it('is authenticated when the session resolves with a user', () => {
    const state = deriveAuthState({
      data: session,
      isPending: false,
      isError: false,
    });
    expect(state.status).toBe('authenticated');
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.email).toBe('a@b.com');
  });

  it('is anonymous when the session resolves null (signed out)', () => {
    const state = deriveAuthState({
      data: null,
      isPending: false,
      isError: false,
    });
    expect(state.status).toBe('anonymous');
    expect(state.isAnonymous).toBe(true);
    expect(state.isAuthenticated).toBe(false);
  });

  it('degrades to anonymous on a query error (API blip never breaks the demo)', () => {
    const state = deriveAuthState({
      data: undefined,
      isPending: true,
      isError: true,
    });
    // Even though pending, an error means we treat the visitor as anonymous so
    // the demo board still renders openly rather than hanging on "loading".
    expect(state.status).toBe('anonymous');
    expect(state.isAnonymous).toBe(true);
  });
});

describe('gateMutation', () => {
  it('proceeds when authenticated', () => {
    expect(gateMutation({ isAuthenticated: true })).toBe('proceed');
  });

  it('prompts when not authenticated', () => {
    expect(gateMutation({ isAuthenticated: false })).toBe('prompt');
  });
});

describe('isAuthRequiredError', () => {
  it('detects a 401 error object (the server demo-fallback rejection)', () => {
    expect(isAuthRequiredError({ status: 401 })).toBe(true);
  });

  it('ignores non-401 statuses', () => {
    expect(isAuthRequiredError({ status: 400 })).toBe(false);
    expect(isAuthRequiredError({ status: 500 })).toBe(false);
  });

  it('is false for non-error shapes', () => {
    expect(isAuthRequiredError(null)).toBe(false);
    expect(isAuthRequiredError(undefined)).toBe(false);
    expect(isAuthRequiredError('401')).toBe(false);
    expect(isAuthRequiredError({})).toBe(false);
  });
});
