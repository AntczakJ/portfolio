import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { seedBoard } from '@helpers/seed-board';

/**
 * Test 6 — multi-user presence: two BrowserContexts on the same board
 * see each other's cursor.
 *
 * Each `browser.newContext()` mints its own cookie jar so the two
 * contexts get distinct ADR-005 identities — the canonical "two
 * different users on the same board" shape per the PLAN wow moment.
 *
 * The assertion is "the cursor canvas in tab A paints something after
 * tab B moves its pointer". The cursor canvas's painted-pixel sample
 * via `cursorCanvasNonEmpty()` is the test's load-bearing read; it
 * does NOT bind to a specific awareness slot color, so a palette
 * change does not flake the test.
 *
 * Tagged `@smoke` is NOT applied here — the multi-context test is
 * slower and runs the WS connection path which is meaningful only
 * when the backend is reachable; CI's smoke subset stays at 1-4 + 7.
 */
test.describe('multi-user presence — two contexts share cursors', () => {
  test('cursor from tab B paints on cursor canvas in tab A', async ({
    browser,
    request,
  }) => {
    const seeded = await seedBoard(request);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const boardA = new BoardPage(pageA, contextA);
      const boardB = new BoardPage(pageB, contextB);

      await Promise.all([
        boardA.goto(seeded.boardId),
        boardB.goto(seeded.boardId),
      ]);
      await Promise.all([boardA.waitForReady(), boardB.waitForReady()]);

      // Sanity: distinct identities — different cookie values means
      // different ADR-005 derivations, which the avatar / awareness
      // wheel uses to assign distinct OKLCH slots.
      const aCookies = await contextA.cookies();
      const bCookies = await contextB.cookies();
      const aSession = aCookies.find((c) => c.name === 'meld_session');
      const bSession = bCookies.find((c) => c.name === 'meld_session');
      expect(aSession?.value).toBeDefined();
      expect(bSession?.value).toBeDefined();
      expect(aSession?.value).not.toBe(bSession?.value);

      // Move B's pointer over its shape canvas. The cursor write is
      // ~30 ms throttled inside `BoardPointerOverlay`; we move the
      // pointer through several positions to ensure at least one
      // awareness frame fires.
      for (let i = 0; i < 6; i++) {
        await boardB.moveCursor({ x: 80 + i * 30, y: 120 + i * 20 });
        await pageB.waitForTimeout(40);
      }

      // Within ~3 s, A's cursor canvas should have non-empty pixels
      // from the cursor engine's painter (B's arrow + name pill).
      await expect
        .poll(async () => boardA.cursorCanvasNonEmpty(), {
          timeout: 8_000,
          intervals: [100, 200, 400, 800, 1200],
        })
        .toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
