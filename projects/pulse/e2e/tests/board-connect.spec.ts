import { expect, test } from '@playwright/test';

import { BoardPage, attachDiagnostics, trackSse } from '@helpers/index';

/**
 * Test 2 — the live board (the wow) loads, connects, and updates from real
 * probes over ONE SSE connection (not polling).
 *
 * Success criteria (PLAN.md / AGENT_NOTES "genuinely pushed, not polled"):
 *   - the seeded demo monitors render,
 *   - the connection indicator reaches "Live" (the EventSource is connected),
 *   - DevTools shows exactly ONE `/api/stream` connection and NOT a steady
 *     `GET /monitors` polling loop,
 *   - a real `check.result` updates a card (we wait on REAL state — the
 *     "last checked" ticker resolving to a concrete time — not a fixed sleep),
 *   - status is accessible (dot + visible text label, never color-alone).
 *
 * Tagged `@smoke` — deploy verification needs the board to come alive.
 */
test.describe('live board — loads, connects, updates from real probes', () => {
  test('renders monitors, connects ONE SSE, a real result updates a card @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    const sse = trackSse(page);
    const board = new BoardPage(page);

    await board.goto();

    // The seeded demo workspace renders its monitor cards.
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });
    const cardCount = await board.cards().count();
    expect(cardCount, 'seeded demo monitors render on the board').toBeGreaterThan(
      0,
    );

    // The EventSource connects — the visible liveness tell.
    await board.waitForLive();

    // Status is never color-alone: a card's StatusDot carries a visible text
    // label. Assert one of the canonical status words is present on the board.
    await expect(board.section()).toContainText(/Up|Down|Degraded|Unknown/);

    // Wait on a REAL probe result landing: the "Last checked" ticker on at least
    // one card resolves from the em-dash placeholder to a concrete relative time
    // (e.g. "Just now" / "Ns ago"). This is REAL state, not a fixed sleep.
    await expect
      .poll(
        async () => {
          const text = await board.section().innerText();
          // A concrete relative time appears once a result has streamed in.
          return /just now|\bago\b|\bs\b|second/i.test(text);
        },
        {
          timeout: 60_000,
          message: 'a real check.result should update a card within an interval',
        },
      )
      .toBe(true);

    // Settle, then assert the SSE shape: exactly ONE dashboard stream, and the
    // monitor list was NOT polled on a loop (one initial fetch + at most a few
    // reconcile refetches is fine; a polling loop would be many).
    await page.waitForTimeout(3_000);
    const snap = sse.snapshot();
    expect(
      snap.stream,
      `expected exactly one /api/stream connection, saw ${String(snap.stream)}`,
    ).toBe(1);
    expect(
      snap.monitorPolls,
      `the board must be PUSHED, not polled — saw ${String(snap.monitorPolls)} GET /monitors (a polling loop would be many)`,
    ).toBeLessThanOrEqual(4);

    // The board stays CSP/console clean while live.
    expect(diag.cspViolations, diag.cspViolations.join('\n')).toEqual([]);
    expect(diag.pageErrors.map((e) => e.message)).toEqual([]);
  });
});
