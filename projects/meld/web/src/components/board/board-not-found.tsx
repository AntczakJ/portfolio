'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCreateBoard,
  type CreateBoardErrorCode,
} from '@/lib/api/use-create-board';

/**
 * Renders when the board route's server fetch returned HTTP 404 (board
 * does not exist) OR when the route validation rejected a malformed
 * `boardId` before the API call.
 *
 * The shadcn `<Dialog>` is `open={true}` and intentionally
 * non-dismissable via the corner X (`showCloseButton={false}`). The
 * page is in a broken state and the only forward paths are taking one
 * of the two CTAs:
 *
 *   - "Open a new board" — primary. Calls `useCreateBoard()` and
 *     navigates on success. Same flow as the chrome New Board CTA;
 *     the hook handles error normalisation. An inline error message
 *     below the action surfaces failures (rate-limit / network / 500)
 *     without a toast library.
 *   - "Back to home" — secondary. A plain Next `<Link>` to `/` so the
 *     viewer can leave the broken state without committing to a new
 *     board.
 *
 * A11y:
 *   - `<DialogTitle>` and `<DialogDescription>` wire `aria-labelledby`
 *     / `aria-describedby` automatically via Radix's Dialog primitive.
 *   - Focus trap and Escape handling are also Radix's responsibility —
 *     but Escape currently DOES close the dialog (Radix default). We
 *     do not override that: closing the dialog with Escape would
 *     leave the page in an empty state below, so the user must still
 *     pick a CTA. The alternative (suppressing Escape) is a
 *     reduced-keyboard-affordance, and pinning the dialog open in
 *     state would let it re-render on every escape press — neither
 *     is better. We accept the Radix default.
 *
 * The dialog is rendered as a server component's CHILD via the
 * `<BoardNotFound />` import at the page level, but BoardNotFound
 * itself is `'use client'` because it owns hooks (mutation, router).
 */
const ERROR_COPY: Record<CreateBoardErrorCode, string> = {
  'rate-limit-exceeded': "You've opened many boards. Try again in an hour.",
  'invalid-request': 'Could not open a board. Try again.',
  'server-error': 'Something went wrong. Try again.',
  'network-error': 'Server unreachable. Check your connection.',
};

export function BoardNotFound(): ReactNode {
  const router = useRouter();
  const mutation = useCreateBoard();

  const handleOpenNew = (): void => {
    if (mutation.isPending) return;
    mutation.mutate(undefined, {
      onSuccess: (data) => {
        router.push(`/board/${data.boardId}`);
      },
    });
  };

  const isPending = mutation.isPending;
  const errorMessage =
    mutation.error !== null ? ERROR_COPY[mutation.error.code] : null;

  return (
    <Dialog open modal>
      <DialogContent
        data-testid="board-not-found-dialog"
        showCloseButton={false}
        // Suppress the default Radix close-on-pointer-outside; the
        // dialog represents an unrecoverable page state and clicking
        // the dimmed canvas underneath should not let the user dismiss
        // the only path forward.
        onPointerDownOutside={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Board not found.</DialogTitle>
          <DialogDescription>
            This board doesn&apos;t exist or has been deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2" aria-live="polite">
          {errorMessage !== null && (
            <p
              className="text-xs leading-relaxed text-(--color-error)"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
          <Button
            type="button"
            onClick={handleOpenNew}
            disabled={isPending}
            aria-disabled={isPending}
          >
            {isPending ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
                <span>Opening…</span>
              </>
            ) : (
              <span>Open a new board</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
