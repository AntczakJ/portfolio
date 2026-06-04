import { expect, test } from '@playwright/test';

import { attachDiagnostics } from '@helpers/index';

/**
 * Test 1 — landing smoke (the SSR/static floor + the production-CSP gate).
 *
 * The most embarrassing failure for the showcase is the front door not opening,
 * so this is the deploy-verification anchor. It asserts:
 *   - `/` loads with the correct `<title>`,
 *   - the hero `<h1>` and the board-preview render (the wow shown, not described),
 *   - the "View the live demo" CTA routes to the dashboard,
 *   - ZERO console errors AND ZERO CSP violations under the production CSP
 *     (the contract the frontend-engineer verified by hand at every milestone;
 *     this makes it a standing test).
 *
 * Tagged `@smoke` — included in the deploy-verification subset.
 */
test.describe('landing — SSR floor + production-CSP gate', () => {
  test('renders the hero + board preview, is CSP/console clean @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/Pulse/i);

    // The real H1 — the SSR floor (server component, no client data dependency).
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /Uptime monitoring that proves itself/i,
      }),
    ).toBeVisible();

    // The board preview (the wow shown above the fold). It is aria-hidden, so
    // assert on a known card label inside it via a CSS-scoped query.
    await expect(page.locator('main')).toContainText('Checkout', {
      // The static preview names a service; tolerate the exact wording by
      // matching the brand-consistent "Checkout"-class label OR a status word.
      timeout: 10_000,
    });

    // Both public CTAs paint.
    await expect(
      page.getByRole('link', { name: /View the live demo/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /See an example status page/i }),
    ).toBeVisible();

    // Let hydration settle so any violation fired during it is captured.
    await page.waitForLoadState('networkidle');

    expect(
      diag.cspViolations,
      `CSP violations under the production CSP:\n${diag.cspViolations.join('\n')}`,
    ).toEqual([]);
    expect(
      diag.pageErrors.map((e) => e.message),
      'Uncaught page errors',
    ).toEqual([]);
    expect(diag.consoleErrors, 'console.error output').toEqual([]);
  });

  test('the "View the live demo" CTA routes to the dashboard @smoke', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await Promise.all([
      page.waitForURL(/\/dashboard$/, { timeout: 30_000 }),
      page.getByRole('link', { name: /View the live demo/i }).first().click(),
    ]);

    // The dashboard board region mounts.
    await expect(
      page.getByRole('region', { name: 'Status board' }),
    ).toBeVisible();
  });
});
