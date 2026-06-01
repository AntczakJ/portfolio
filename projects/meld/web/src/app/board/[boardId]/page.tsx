import type { Metadata } from 'next';
import { cache } from 'react';
import type { ReactNode } from 'react';

import { BoardCanvasHost } from '@/components/board/board-canvas-host';
import { BoardNotFound } from '@/components/board/board-not-found';
import { api } from '@/lib/api/client';

/**
 * Board route — Task 2.4.
 *
 * Server component. Fetches board metadata via the typed Hono RPC
 * client (`api.api.boards[':boardId'].$get`), renders either the
 * `<BoardCanvasHost />` (200) or the `<BoardNotFound />` dialog (404
 * / invalid id).
 *
 * Phase 2.6 (ADR-008) replaced the original `<BoardCanvasPlaceholder />`
 * with the live `<BoardCanvasHost />` — the route's data dependency
 * stays the same; the canvas host is the client island layered ON
 * TOP of the same server-fetched metadata. The placeholder file has
 * been removed entirely (the `<BoardNotFound />` dialog covers the
 * 404 path on its own).
 *
 * Defensive id validation: a strict UUID v4 regex check runs BEFORE
 * the API call. The server route also rejects malformed ids with
 * HTTP 400, but rejecting client-side avoids the network round-trip
 * and surfaces the same `<BoardNotFound />` dialog. The regex mirrors
 * the server-side one verbatim (ADR-005 cookie pin + `boardIdParamSchema`).
 *
 * `generateMetadata` runs the same fetch and reuses the result via
 * React's `cache(...)` wrapper — both the metadata generator and the
 * page body see one network round-trip per request. Without the
 * cache wrapper Next would call the loader twice.
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type BoardLoadResult =
  | { status: 'ok'; boardId: string; name: string; createdAt: number; connectedClients: number }
  | { status: 'not-found' }
  | { status: 'invalid-id' };

/**
 * Wrapped in React `cache` so `generateMetadata` and the page body
 * share a single fetch. The cache scope is request-level on the
 * server (React's `cache` is per-render); this matches the docstring
 * intent of "one round trip per page render".
 */
const loadBoard = cache(async (boardId: string): Promise<BoardLoadResult> => {
  if (!UUID_V4_REGEX.test(boardId)) {
    return { status: 'invalid-id' };
  }

  try {
    const res = await api.api.boards[':boardId'].$get({
      param: { boardId },
    });
    if (res.status === 404) {
      return { status: 'not-found' };
    }
    if (!res.ok) {
      // Any other non-2xx (including the 400 path the server reserves
      // for parser failures) collapses to the same "not found" UX —
      // the user has nothing useful to do with a 500 either.
      return { status: 'not-found' };
    }
    const body = await res.json();
    return {
      status: 'ok',
      boardId: body.boardId,
      name: body.name,
      createdAt: body.createdAt,
      connectedClients: body.connectedClients,
    };
  } catch {
    // Network failure / API down. Render the not-found dialog rather
    // than throw — a 5xx hard-fail would put Next's error boundary in
    // front of the user, which is a strictly worse UX for a portfolio
    // demo than the dialog with a "Back to home" CTA.
    return { status: 'not-found' };
  }
});

interface BoardPageProps {
  // Next 15: `params` is a Promise that resolves to the route's
  // dynamic segments. The route segment `[boardId]` becomes
  // `{ boardId: string }` after `await`.
  params: Promise<{ boardId: string }>;
}

export async function generateMetadata({
  params,
}: BoardPageProps): Promise<Metadata> {
  const { boardId } = await params;
  const board = await loadBoard(boardId);
  if (board.status !== 'ok') {
    return {
      title: 'Board not found',
      description: 'This board does not exist or has been deleted.',
    };
  }
  return {
    title: board.name,
    description: 'Collaborative whiteboard.',
  };
}

export default async function BoardPage({
  params,
}: BoardPageProps): Promise<ReactNode> {
  const { boardId } = await params;
  const board = await loadBoard(boardId);

  if (board.status !== 'ok') {
    // Both `'invalid-id'` and `'not-found'` collapse to the same
    // dialog. The dialog component is a client island; rendering it
    // here keeps the rest of the page (TopBar / StatusRow inherited
    // from `app/layout.tsx`) in place underneath the modal overlay.
    return <BoardNotFound />;
  }

  return (
    <BoardCanvasHost
      boardId={board.boardId}
      boardName={board.name}
      createdAt={board.createdAt}
      connectedClients={board.connectedClients}
    />
  );
}
