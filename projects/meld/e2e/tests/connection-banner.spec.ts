import { expect, test } from '@playwright/test';

import { BoardPage } from '@helpers/board-page';
import { seedBoard } from '@helpers/seed-board';

/**
 * Test 7 — DevTools-equivalent offline simulation triggers the banner
 * + aria-live announcement; reconnect dismisses it.
 *
 * ADR-009 connection-state rule:
 *
 *   - `offline` iff `(provider.status === 'disconnected' AND held
 *     ≥ 1500 ms) OR navigator.onLine === false`.
 *   - `navigator.onLine === false` bypasses the 1500 ms debounce — OS
 *     offline is authoritative.
 *
 * `context.setOffline(true)` flips `navigator.onLine` to `false` in
 * the page, so the banner should appear well within 1500 ms (no
 * debounce). The aria-live region writes the canonical copy from
 * ADR-009 verbatim; we match the prefix `"Offline."` because the full
 * sentence is content the screen reader emits and we do not want a
 * grammatical-tweak regression to flake the test.
 *
 * Tagged `@smoke` — the offline UX contract per ADR-009 is the load-
 * bearing wow-moment-adjacent assertion; included in deploy
 * verification.
 */
test.describe('connection banner — offline / online roundtrip', () => {
  test('setOffline triggers banner + aria-live; setOnline restores @smoke', async ({
    page,
    context,
    request,
  }) => {
    const seeded = await seedBoard(request);
    const board = new BoardPage(page, context);
    await board.goto(seeded.boardId);
    await board.waitForReady();

    // Banner is not present in the live state.
    await expect(board.connectionBanner()).toHaveCount(0);

    await board.goOffline();

    // Banner must appear within 1500 ms — `navigator.onLine` short-
    // circuits the ADR-009 debounce per the rule above.
    await expect(board.connectionBanner()).toBeVisible({ timeout: 2_000 });
    await expect(board.connectionBanner()).toContainText(
      /offline.*sync.*when you reconnect/i,
    );

    // ADR-009 aria-live emits the verbatim "Offline. Your edits are
    // saved locally and will sync when the connection returns." string.
    // Match the leading "Offline." so a future copy tweak that adds
    // trailing words does not flake.
    await expect(board.offlineAriaLive()).toContainText(/^Offline\./, {
      timeout: 2_000,
    });

    await board.goOnline();

    // Banner unmounts on reconnect — `AnimatePresence` exit then DOM
    // removal. The aria-live region writes "Connection restored." (or
    // "Connection restored. N shape(s) synced." when incomingShapeCount
    // > 0 — N is 0 here because no shapes were drawn while offline).
    await expect(board.connectionBanner()).toHaveCount(0, { timeout: 5_000 });
    await expect(board.offlineAriaLive()).toContainText(
      /^Connection restored\./,
      { timeout: 5_000 },
    );
  });
});
