'use client';

import { RadioIcon } from 'lucide-react';
import { type ReactNode } from 'react';

import { useSession } from '@/lib/auth/use-session';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';

/**
 * The calm demo-mode banner (Task 6.5, ADR-007).
 *
 * Shown only to an anonymous visitor: it frames the dashboard as the SHARED
 * live demo and offers the opt-in to a private workspace — without walling
 * anything. The board, detail, incidents, and the demo-incident button all stay
 * fully usable; only the mutation affordances prompt sign-in. The banner makes
 * that contract legible up front so a "Sign in to create your own monitors"
 * prompt later reads as expected, not as a barrier.
 *
 * Hidden entirely once authenticated (the user is on their own workspace) and
 * while the session is still loading (no flash).
 */
export function DemoModeBanner(): ReactNode {
  const { status } = useSession();

  if (status !== 'anonymous') {
    return null;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-brand/25 bg-brand-surface px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 font-medium text-brand">
        <RadioIcon className="size-4" aria-hidden="true" />
        Live demo
      </span>
      <span className="text-fg-muted">
        You are viewing the shared demo workspace — explore freely.
      </span>
      <button
        type="button"
        onClick={() => {
          openAuthPrompt({
            mode: 'sign-up',
            reason: 'Create your own workspace to add monitors and alerts.',
          });
        }}
        className="ml-auto font-medium text-brand underline-offset-4 hover:underline"
      >
        Sign in to create your own monitors
      </button>
    </div>
  );
}
