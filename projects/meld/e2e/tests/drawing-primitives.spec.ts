import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { seedBoard } from '@helpers/seed-board';

/**
 * Test 5 — keyboard shortcut + click-drag draws a primitive.
 *
 * Iterates R / E / P. The text tool (T) is excluded because it opens
 * an HTML text-draft input, not a click-drag draw — its end-to-end
 * shape requires keyboard input + commit, which is its own assertion
 * surface (deferred to v1.1 when Phase 3.2b ships selection chrome
 * and inline-text completion is the canonical commit path).
 *
 * The drag's "did something paint" assertion uses the canvas-pixel
 * sample inside `BoardPage.shapeCanvasNonEmpty()` — a non-zero alpha
 * pixel anywhere in a central band means SOMETHING painted. This is
 * deliberately loose so a future palette swap or stroke-width tweak
 * does not break the test; the load-bearing claim is "the engine
 * committed a shape to the canvas after the drag".
 */
test.describe('drawing primitives — R / E / P draw on canvas', () => {
  for (const kind of ['rectangle', 'ellipse', 'freehand'] as const) {
    test(`${kind} keyboard + drag paints to shape canvas`, async ({
      page,
      context,
      request,
    }) => {
      const seeded = await seedBoard(request);
      const board = new BoardPage(page, context);
      await board.goto(seeded.boardId);
      await board.waitForReady();

      // Verify the shape canvas is empty before the draw — if a
      // previous test polluted state via shared cookies the assertion
      // would catch the leakage.
      const before = await board.shapeCanvasNonEmpty();
      expect(before).toBe(false);

      const offset =
        kind === 'freehand'
          ? { x1: 80, y1: 80, x2: 360, y2: 200 }
          : { x1: 120, y1: 120, x2: 320, y2: 260 };
      await board.drawShape(kind, offset);

      // The engine's rAF loop is observer-driven; allow up to ~3 frames
      // (50 ms) for the dirty flag to flip and the paint to land.
      await expect
        .poll(async () => board.shapeCanvasNonEmpty(), {
          timeout: 5_000,
          intervals: [50, 100, 200, 400],
        })
        .toBe(true);

      // Toolbar's `data-active-tool` reflects the current tool. After
      // a draw the active tool stays the same (the engine does NOT
      // revert-to-select on commit per the toolbar's behaviour pin).
      await expect(board.toolbar()).toHaveAttribute('data-active-tool', kind);
    });
  }
});
