import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { LandingPage } from '@helpers/landing-page';

/**
 * Test 2 — clicking "New board" creates a board + redirects.
 *
 * Exercises:
 *
 *   - `<NewBoardButton />` → `useCreateBoard` mutation → `POST /api/boards`
 *   - `router.push('/board/${boardId}')`
 *   - `<BoardCanvasHost />` mounts with the two stacked canvases
 *
 * The URL after redirect must match the UUID v4 regex the server
 * issues (ADR-005 pin). The shape + cursor canvases must be in the
 * document within the `actionTimeout` ceiling.
 *
 * Tagged `@smoke` — the wow-moment entry path; included in deploy
 * verification.
 */
test.describe('board creation — chrome CTA → /board/:uuid', () => {
  test('New board CTA opens a board with canvases + toolbar @smoke', async ({
    page,
    context,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const boardId = await landing.clickAndAwaitRedirect();
    expect(boardId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const board = new BoardPage(page, context);
    await board.waitForReady();

    // Layer attributes are the canonical engine wiring contract per
    // ADR-008 — a refactor that loses them would silently break the
    // canvas engines.
    const layers = await board.readLayerAttributes();
    expect(layers.shape).toBe('shapes');
    expect(layers.cursor).toBe('cursors');
  });
});
