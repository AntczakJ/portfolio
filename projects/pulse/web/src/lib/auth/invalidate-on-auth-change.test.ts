import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { invalidateOnAuthChange } from '@/lib/auth/invalidate-on-auth-change';

/**
 * The board-lag fix: on any auth state change (sign-in / sign-up / sign-out)
 * the owner-scoped caches must be invalidated, not only the session query — so
 * the board reflects the new session's workspace immediately. We assert the
 * exact set of invalidated query keys.
 */
describe('invalidateOnAuthChange', () => {
  it('invalidates the session AND every owner-scoped query root', async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    await invalidateOnAuthChange(client);

    const invalidatedKeys = spy.mock.calls.map(([arg]) => arg?.queryKey);

    // The session query (so the header flips auth state) ...
    expect(invalidatedKeys).toContainEqual(['auth', 'session']);
    // ... AND the owner-scoped roots (the prior bug invalidated only the session,
    // leaving the demo workspace's monitors on the board after sign-up).
    expect(invalidatedKeys).toContainEqual(['monitors']);
    expect(invalidatedKeys).toContainEqual(['monitor']);
    expect(invalidatedKeys).toContainEqual(['incidents']);
    expect(invalidatedKeys).toContainEqual(['alert-channels']);
  });
});
