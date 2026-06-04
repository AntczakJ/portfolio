'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogInIcon, LogOutIcon, UserIcon } from 'lucide-react';
import { type ReactNode } from 'react';

import { signOut } from '@/lib/api/auth';
import { invalidateOnAuthChange } from '@/lib/auth/invalidate-on-auth-change';
import { useSession } from '@/lib/auth/use-session';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The session-aware header affordance (Task 6.4).
 *
 * - loading       -> a quiet skeleton pill (no flash of "Sign in")
 * - authenticated -> an avatar/initial button -> a menu with the email + sign out
 * - anonymous     -> a "Sign in" button that opens the auth dialog
 *
 * Sign out invalidates the session query so the header + the gated affordances
 * fall back to the shared demo workspace immediately (no redirect — the demo
 * board stays viewable, ADR-007).
 */
export function SessionMenu(): ReactNode {
  const { status, user } = useSession();
  const queryClient = useQueryClient();

  const signOutMutation = useMutation({
    mutationFn: () => signOut(),
    onSuccess: async () => {
      // Drop any cached private workspace data so the demo board repaints clean.
      await invalidateOnAuthChange(queryClient);
    },
  });

  if (status === 'loading') {
    return (
      <div
        aria-hidden="true"
        className="h-8 w-16 animate-pulse rounded-md bg-surface"
      />
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          openAuthPrompt({ mode: 'sign-in' });
        }}
      >
        <LogInIcon />
        Sign in
      </Button>
    );
  }

  const initial = (user.name || user.email).charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.email}`}
          className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">
            {user.name || 'Signed in'}
          </span>
          <span className="truncate text-xs font-normal text-fg-subtle">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled
          className="gap-2 text-fg-muted"
        >
          <UserIcon className="size-4" />
          Your workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            signOutMutation.mutate();
          }}
          className="gap-2"
        >
          <LogOutIcon className="size-4" />
          {signOutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
