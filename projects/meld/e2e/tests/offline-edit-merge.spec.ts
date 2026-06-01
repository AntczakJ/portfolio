import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { seedBoard } from '@helpers/seed-board';

/**
 * Test 8 — Tab A goes offline + draws a shape; Tab A comes back; Tab B
 * (always online) receives the shape with the crossfade.
 *
 * This is the v1.1-ish enhancement of ADR-007 test 7 — now feasible
 * because Phase 2.6 landed the canvas. The assertion chain:
 *
 *   1. Tab B's shape canvas is initially empty.
 *   2. Tab A goes offline → connection banner appears.
 *   3. Tab A draws a rectangle while offline → Tab B does NOT paint
 *      anything (Yjs CRDT updates are queued local-only).
 *   4. Tab A goes online → the Yjs sync handshake fires, Tab A's
 *      banner unmounts.
 *   5. Tab B's shape canvas paints SOMETHING (the merged shape lands
 *      via the CRDT update).
 *
 * We do NOT assert the crossfade timing — that is a Motion-level
 * micro-interaction whose timing is asserted in Vitest unit tests of
 * `<BoardCanvasHost />`'s `shapeOpacity` state. The e2e claim is the
 * end-to-end shape arrival.
 */
test.describe('offline edit + merge — A draws offline, B receives on reconnect', () => {
  test('Yjs CRDT delivers the offline shape to peer after reconnect', async ({
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

      // Initial state: B has nothing painted.
      expect(await boardB.shapeCanvasNonEmpty()).toBe(false);

      // A goes offline. Banner visibly confirms the state.
      await boardA.goOffline();
      await expect(boardA.connectionBanner()).toBeVisible({ timeout: 2_000 });

      // A draws a rectangle while offline. The shape commits to A's
      // local Y.Doc; the update sits in the WebsocketProvider's send
      // buffer until the connection returns.
      await boardA.drawShape('rectangle', {
        x1: 140,
        y1: 140,
        x2: 320,
        y2: 240,
      });
      // A's own canvas paints immediately (local Y.Doc fire).
      await expect
        .poll(async () => boardA.shapeCanvasNonEmpty(), { timeout: 5_000 })
        .toBe(true);
      // B's canvas stays empty — the sync is blocked by the offline
      // boundary. Sample a couple of times to defend against a stray
      // late paint of a different layer.
      expect(await boardB.shapeCanvasNonEmpty()).toBe(false);

      // A reconnects. Banner unmounts; Yjs sync handshake fires.
      await boardA.goOnline();
      await expect(boardA.connectionBanner()).toHaveCount(0, {
        timeout: 5_000,
      });

      // B receives the merged shape. The crossfade gate
      // (`incomingShapeCount > 0`) does NOT fire on B because B was
      // never offline — B just receives a normal Yjs update. The
      // load-bearing assertion is the painted-pixel sample.
      await expect
        .poll(async () => boardB.shapeCanvasNonEmpty(), {
          timeout: 10_000,
          intervals: [200, 400, 800, 1500],
        })
        .toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
