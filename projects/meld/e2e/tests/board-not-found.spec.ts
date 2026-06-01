import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { garbageBoardId } from '@helpers/seed-board';

/**
 * Test 3 — visiting `/board/<garbage-uuid>` shows the BoardNotFound dialog.
 *
 * The page-level loader (`web/src/app/board/[boardId]/page.tsx`)
 * issues a GET against the backend; a 404 collapses to the
 * `<BoardNotFound />` dialog. The dialog is non-dismissable via the
 * corner X and the only forward paths are "Back to home" or "Open a
 * new board".
 *
 * Tagged `@smoke` — basic 404 hygiene; included in deploy verification.
 */
test.describe('board not found — 404 dialog', () => {
  test('non-existent board renders the BoardNotFound dialog @smoke', async ({
    page,
    context,
  }) => {
    const board = new BoardPage(page, context);
    await board.goto(garbageBoardId());

    await expect(board.boardNotFoundDialog()).toBeVisible({ timeout: 10_000 });
    await expect(board.boardNotFoundDialog()).toContainText(/not found/i);

    // The Back to home button is a Next `<Link href="/">` — a plain
    // anchor under shadcn's `Button asChild`. The "Open a new board"
    // button is a `<button>` with the create-board mutation. Assert
    // both exist; do NOT click them (a click would mutate state we
    // do not own in this test).
    await expect(
      page.getByRole('link', { name: /back to home/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /open a new board/i }),
    ).toBeVisible();
  });
});
