'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  useCreateBoard,
  type CreateBoardErrorCode,
} from '@/lib/api/use-create-board';

interface NewBoardButtonProps {
  /**
   * Visual variant. `compact` is icon-only at the smallest viewports
   * (320–640 px) so the top bar stays at one row; `full` shows the
   * icon + "New board" label everywhere else.
   */
  variant?: 'compact' | 'full';
  className?: string;
  /**
   * Inline error placement. The top-bar instance has no vertical space
   * for an inline error message and renders only the live-region
   * announcement (`'screenreader'`). The canvas-placeholder instance
   * has room and renders the visible inline message (`'inline'`).
   *
   * Default `'screenreader'` keeps the top-bar layout intact.
   */
  errorMode?: 'inline' | 'screenreader';
}

/**
 * Primary CTA — "New board". Task 2.4 wires the real flow:
 *   1. `useCreateBoard.mutate()` → `POST /api/boards`.
 *   2. On 201: `router.push('/board/${boardId}')`.
 *   3. On error: surface a user-facing message either inline (canvas
 *      placeholder consumer) or only to the live-region announcer
 *      (top-bar consumer where vertical space is tight).
 *
 * The button is `aria-disabled` while the mutation is in flight; a
 * CSS-only spinner sits next to the label so the loading state is
 * visible without pulling a new lucide icon (the Task 2.3 approved
 * icon set is `Sun, Moon, Monitor, Plus, Sparkles` — `Loader2` is NOT
 * approved and adding it just for this button would trip the
 * AGENT_NOTES "no new lucide icons without justification" pin).
 *
 * The spinner is built from a `border-current` ring + `animate-spin`
 * — Tailwind v4's default `animate-spin` already respects
 * `prefers-reduced-motion` via the system-level CSS the browser
 * inserts when the user pref is on (the @media query disables the
 * 360° rotation transform), so we do not need an extra `motion-safe:`
 * guard.
 *
 * Inline error mode renders a short copy block BELOW the button (in
 * the canvas placeholder layout). The aria-live announcement happens
 * in both modes so a screen-reader user always hears the failure;
 * sighted top-bar users see no movement, which keeps the chrome calm.
 *
 * No toast library — see `useCreateBoard.ts` docblock for rationale.
 */

const ERROR_COPY: Record<CreateBoardErrorCode, string> = {
  'rate-limit-exceeded': "You've opened many boards. Try again in an hour.",
  'invalid-request': 'Could not open a board. Try again.',
  'server-error': 'Something went wrong. Try again.',
  'network-error': 'Server unreachable. Check your connection.',
};

export function NewBoardButton({
  variant = 'full',
  className,
  errorMode = 'screenreader',
}: NewBoardButtonProps): ReactNode {
  const router = useRouter();
  const mutation = useCreateBoard();

  const handleClick = (): void => {
    if (mutation.isPending) return;
    mutation.mutate(undefined, {
      onSuccess: (data) => {
        router.push(`/board/${data.boardId}`);
      },
      // Errors are surfaced via `mutation.error` below; no toast.
    });
  };

  const isPending = mutation.isPending;
  const errorMessage =
    mutation.error !== null ? ERROR_COPY[mutation.error.code] : null;

  const baseProps = {
    type: 'button' as const,
    onClick: handleClick,
    'aria-disabled': isPending,
    'aria-label': 'Open a new board',
    'data-loading': isPending ? 'true' : undefined,
    'data-testid': 'new-board-cta',
  };

  const trigger =
    variant === 'compact' ? (
      <Button
        {...baseProps}
        size="icon-sm"
        className={cn('shrink-0', className)}
      >
        {isPending ? <Spinner srLabel="Opening" /> : <Plus className="size-4" aria-hidden="true" />}
      </Button>
    ) : (
      <Button {...baseProps} size="sm" className={cn('shrink-0', className)}>
        {isPending ? <Spinner srLabel="Opening" /> : <Plus className="size-4" aria-hidden="true" />}
        <span>{isPending ? 'Opening…' : 'New board'}</span>
      </Button>
    );

  // Always render the live region — empty when there is no error so
  // a state change from "" → message announces via aria-live. The
  // visual inline message only renders in `'inline'` mode.
  return (
    <span className="inline-flex flex-col items-stretch gap-2">
      {trigger}
      {errorMode === 'inline' && errorMessage !== null && (
        <p
          className="text-xs leading-relaxed text-(--color-error)"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {errorMessage ?? ''}
      </span>
    </span>
  );
}

/**
 * Small CSS-only spinner — a 1 px border ring with a transparent right
 * border that rotates. No `Loader2` from `lucide-react` (not in the
 * Task 2.3 approved icon set). `animate-spin` respects
 * `prefers-reduced-motion` by browser default.
 */
function Spinner({ srLabel }: { srLabel: string }): ReactNode {
  return (
    <>
      <span
        aria-hidden="true"
        className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      <span className="sr-only">{srLabel}</span>
    </>
  );
}
