import type { APIRequestContext } from '@playwright/test';

import { apiBaseUrl } from './env';

/**
 * `seed-board.ts` — bypass the UI to create a board via the HTTP API.
 *
 * Used by tests that DO NOT need to exercise the New Board CTA flow
 * (e.g. drawing-primitives, multi-user-presence) — board creation cost
 * stays out of the per-test critical path and the test focuses on the
 * surface it actually claims to cover.
 *
 * Uses Playwright's `APIRequestContext` rather than `fetch` so the
 * request inherits the BrowserContext's cookie jar when called via
 * `context.request`. For pre-context boots the call falls through to
 * `playwright.request` whose new context is short-lived.
 */
export interface SeededBoard {
  boardId: string;
  name: string;
  createdAt: number;
}

export async function seedBoard(
  request: APIRequestContext,
): Promise<SeededBoard> {
  const response = await request.post(`${apiBaseUrl()}/api/boards`, {
    data: {},
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok()) {
    throw new Error(
      `seedBoard: POST /api/boards failed: ${response.status().toString()} ${response.statusText()}`,
    );
  }
  const body = (await response.json()) as {
    boardId: string;
    name: string;
    createdAt: number;
  };
  return body;
}

/**
 * Build a deterministic garbage UUID for the not-found path. The format
 * is a real-shaped UUID v4 so the client-side regex passes — the
 * `<BoardNotFound />` dialog renders from the SERVER 404, which exercises
 * the round-trip we care about. A malformed id would short-circuit to
 * the `'invalid-id'` branch (also not-found, but a different code path).
 */
export function garbageBoardId(): string {
  // Lowercase hex, version nibble = 4, variant nibble = 8/9/a/b.
  // Static literal so the test stays deterministic across runs.
  return '00000000-0000-4000-8000-000000000000';
}
