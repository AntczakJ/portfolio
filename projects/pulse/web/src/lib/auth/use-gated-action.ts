'use client';

import { useCallback } from 'react';

import { useSession } from '@/lib/auth/use-session';
import { gateMutation } from '@/lib/auth/session-state';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';

/**
 * The demo-gating hook (Task 6.5, ADR-007) — the one seam every write
 * affordance routes through.
 *
 * The demo stays OPEN: reads, the live board, the demo-incident button are
 * never gated. But a MUTATION affordance (create/edit/delete monitor,
 * create/delete alert channel) calls `run(action, reason)`:
 *
 *   - authenticated -> the action runs immediately (the user's own workspace)
 *   - anonymous / loading -> the auth dialog opens with the contextual `reason`
 *     ("Sign in to create your own monitors.") and the action does NOT fire.
 *
 * This intercepts BEFORE the request, so a demo visitor sees a calm prompt
 * instead of a `401 authentication_required`. The 401 is still handled as a
 * fallback (see `isAuthRequiredError`) for the session-expired race, but the
 * common path never reaches the server with a doomed write.
 */
export function useGatedAction(): {
  isAuthenticated: boolean;
  run: (action: () => void, reason: string) => void;
} {
  const { isAuthenticated } = useSession();

  const run = useCallback(
    (action: () => void, reason: string) => {
      if (gateMutation({ isAuthenticated }) === 'proceed') {
        action();
        return;
      }
      openAuthPrompt({ mode: 'sign-in', reason });
    },
    [isAuthenticated],
  );

  return { isAuthenticated, run };
}
