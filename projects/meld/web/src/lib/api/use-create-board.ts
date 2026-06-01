'use client';

import { useMutation } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';

import { api } from '@/lib/api/client';

/**
 * `useCreateBoard` — TanStack Query mutation backing the "New board"
 * flow (Task 2.4).
 *
 * Calls `POST /api/boards` via the typed Hono RPC client and returns
 * the new `boardId` to the caller. The caller is responsible for the
 * navigation step (`router.push(`/board/${boardId}`)`) so the hook
 * stays decoupled from `next/navigation` — the same hook is consumed
 * from both the `<NewBoardButton />` (post-success router.push) and
 * the `<BoardNotFound />` dialog (same post-success router.push). The
 * routing surface is the consumer's concern; the hook only owns the
 * network round-trip and the error normalisation.
 *
 * Type-safety: the response shape is inferred via
 * `InferResponseType<typeof api.api.boards.$post, 201>`. The `201`
 * status pin is load-bearing — Hono RPC infers a union of every
 * response shape the server route declares (success + the four error
 * shapes from `createBoardsRoutes`), and we only want the success
 * branch on the type. The error branches surface as thrown errors
 * (the `Error` we synthesise below carries the structured `error`
 * code so the consumer can render appropriate copy without parsing
 * a string).
 *
 * Error normalisation:
 *   - HTTP 429 — `rate-limit-exceeded` → "You've created too many
 *     boards. Try again later." The user-facing message is decided
 *     at the consumer site to keep this hook copy-free.
 *   - HTTP 400 — `invalid-request` → "Could not open a board. Try
 *     again." (v1 has no client-controllable body so 400 is almost
 *     always a server-contract drift, not user input.)
 *   - HTTP 500 / network → "Something went wrong. Try again."
 *
 * The hook does NOT install a toast surface. meld has no toast
 * library installed yet — tape's Phase 4 critique flagged
 * toast-on-error as v1.1 deferred, and adding one here would violate
 * the same restraint convention. Consumers render an inline error
 * below the trigger control instead (see `<NewBoardButton />`).
 */

export type CreateBoardSuccess = InferResponseType<
  typeof api.api.boards.$post,
  201
>;

export type CreateBoardErrorCode =
  | 'rate-limit-exceeded'
  | 'invalid-request'
  | 'server-error'
  | 'network-error';

export class CreateBoardError extends Error {
  readonly code: CreateBoardErrorCode;

  constructor(code: CreateBoardErrorCode, message: string) {
    super(message);
    this.name = 'CreateBoardError';
    this.code = code;
  }
}

async function createBoard(): Promise<CreateBoardSuccess> {
  // The Hono RPC client typing requires an empty `json` body even though
  // the server marks `name` as optional — `createBoardRequestSchema`
  // accepts `{}` and falls back to the deterministic minute-of-day
  // default-name picker. Sending `{}` (not `{ name: undefined }`) avoids
  // a Zod validator surprise on the server side.
  let res: Awaited<ReturnType<typeof api.api.boards.$post>>;
  try {
    res = await api.api.boards.$post({ json: {} });
  } catch {
    // Network failure / abort. The Hono RPC client throws here BEFORE
    // a Response is constructed (DNS fail, server down, CORS preflight
    // rejected). Surface as a normalised `network-error` so the
    // consumer can render the generic "try again" message.
    throw new CreateBoardError(
      'network-error',
      'Could not reach the server.',
    );
  }

  // Discriminate via the literal `status` property. Hono RPC narrows
  // the response shape per status code, so we capture the value into a
  // local before the branching to keep TypeScript's narrowing happy
  // across multiple comparisons (after the first `===` check, the
  // outer `res.status` field gets narrowed and the next comparison
  // hits `never`).
  const status: number = res.status;

  if (status === 201) {
    return (await res.json()) as CreateBoardSuccess;
  }

  if (status === 429) {
    throw new CreateBoardError(
      'rate-limit-exceeded',
      'Too many boards created from this address.',
    );
  }

  if (status === 400) {
    throw new CreateBoardError(
      'invalid-request',
      'The server rejected the request.',
    );
  }

  throw new CreateBoardError(
    'server-error',
    `Unexpected status ${String(status)}.`,
  );
}

export function useCreateBoard() {
  return useMutation<CreateBoardSuccess, CreateBoardError>({
    mutationKey: ['create-board'],
    mutationFn: createBoard,
    // Do NOT retry — board creation is a non-idempotent write. The user
    // pressing the button again is the natural retry path; an automatic
    // retry could double-create on a slow 429 boundary.
    retry: false,
  });
}
