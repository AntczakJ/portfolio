import { expect, test } from '@playwright/test';

import {
  BoardPage,
  apiBaseUrl,
  freshIdentity,
  isAuthenticated,
  signOut,
  signUpThroughDialog,
} from '@helpers/index';

/**
 * Test 4 — the auth boundary + demo-open gating (ADR-007, security-relevant).
 *
 * The demo stays OPEN: an unauthenticated visitor reads the board and the demo
 * button works, but every WRITE affordance prompts sign-in instead of mutating.
 * Then a signed-up user gets their OWN empty workspace and CAN create a monitor,
 * which the demo workspace does NOT show. Signing out falls back to the demo.
 *
 * This proves the two load-bearing properties:
 *   - the demo-open posture (reads + the wow are anonymous),
 *   - mutations are gated (a POST never lands without a session).
 *
 * Tagged `@smoke` — the auth boundary is a success criterion and a fast deploy
 * check.
 */
test.describe('auth boundary — demo stays open, mutations are gated', () => {
  test('unauth: board visible + demo button works, but New monitor -> sign-in @smoke', async ({
    page,
    request,
  }) => {
    const board = new BoardPage(page);
    await board.goto();

    // The board IS visible to an anonymous visitor (the shared demo workspace).
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });
    // The header offers "Sign in" (anonymous), not an account menu.
    await expect(
      page.getByRole('button', { name: 'Sign in' }).first(),
    ).toBeVisible();
    expect(await isAuthenticated(page)).toBe(false);

    // The demo button is present + usable for an anonymous visitor (the wow is
    // open). We assert it is enabled; the arc itself is covered by its own spec.
    await expect(board.demoButton()).toBeEnabled();

    // Clicking "New monitor" leads to the sign-in prompt, NOT a created monitor.
    await board.newMonitorButton().click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Sign in to Pulse' }),
    ).toBeVisible();
    // The contextual reason is the demo-open prompt, not a raw error.
    await expect(
      dialog.getByText(/Sign in to create your own monitors/i),
    ).toBeVisible();

    // And the backend agrees: an unauthenticated POST /monitors is rejected.
    const res = await request.post(`${apiBaseUrl()}/monitors`, {
      data: {
        name: 'should-not-exist',
        targetUrl: 'https://example.com/health',
        intervalSeconds: 60,
      },
      failOnStatusCode: false,
    });
    expect(
      res.status(),
      'unauthenticated mutation must be rejected (401)',
    ).toBe(401);
  });

  test('sign up -> OWN empty workspace -> create a monitor the demo does not show', async ({
    page,
  }) => {
    const board = new BoardPage(page);
    const identity = freshIdentity();

    await board.goto();
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });
    const demoCardCount = await board.cards().count();
    expect(demoCardCount).toBeGreaterThan(0);

    // Open the sign-in prompt via the gated "New monitor" affordance, then sign
    // up a fresh user.
    await board.newMonitorButton().click();
    await signUpThroughDialog(page, identity);

    // The header now shows the authenticated account affordance.
    await expect
      .poll(() => isAuthenticated(page), { timeout: 15_000 })
      .toBe(true);

    // Reload so the board re-fetches `GET /monitors` WITH the new session cookie
    // (a real user lands on their own workspace; the session cookie persists).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => isAuthenticated(page), { timeout: 15_000 })
      .toBe(true);

    // The user's OWN workspace is empty (the demo monitors are NOT theirs).
    await expect(board.section()).toContainText(/No monitors yet/, {
      timeout: 15_000,
    });
    await expect(board.cardByName('Checkout API')).toHaveCount(0);

    // Now creating a monitor SUCCEEDS (the affordance is no longer gated).
    await board.newMonitorButton().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('New monitor')).toBeVisible();
    const uniqueName = `E2E monitor ${Date.now().toString(36)}`;
    await dialog.getByLabel('Name').fill(uniqueName);
    await dialog.getByLabel('Target URL').fill('https://example.com/health');
    await dialog.getByRole('button', { name: /Create monitor/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // The new card appears on the OWN board.
    await expect(board.cardByName(uniqueName).first()).toBeVisible({
      timeout: 15_000,
    });

    // Sign out -> the board falls back to the shared demo (no redirect), and the
    // user's monitor is NOT on the demo board.
    await signOut(page);
    await expect
      .poll(() => isAuthenticated(page), { timeout: 15_000 })
      .toBe(false);
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });
    await expect(board.cardByName(uniqueName)).toHaveCount(0);
    // The demo workspace's monitors are back.
    await expect(board.cardByName('Checkout API').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
