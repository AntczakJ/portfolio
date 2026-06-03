import { expect, test } from '@playwright/test';

import { LandingPage, attachDiagnostics } from '@helpers/index';

/**
 * Test 1 — landing smoke (the SSR / no-JS floor + the production-CSP gate).
 *
 * The single most embarrassing failure for the showcase is the front door
 * not opening, so this is the deploy-verification anchor. It asserts:
 *   - `/` loads with the correct `<title>`,
 *   - the hero `<h1>` "Razor's Edge" is present (the real-DOM floor that
 *     exists regardless of GSAP / JS — ADR-004 Tier 3),
 *   - the header nav + the "Book a chair" CTA paint,
 *   - and — the hard gate — ZERO console errors AND ZERO UNEXPECTED CSP
 *     violations under the production CSP (the contract the frontend-engineer
 *     verified by hand at every milestone; this makes it a standing test).
 *
 * NOTE on the one carve-out: the zod-4 `script-src eval` probe (defect
 * D-CSP-1) intermittently fires during landing hydration (~1 in 8 loads) and
 * is filtered out of `cspViolations` by the diagnostics helper so this
 * deploy-anchor does not FLAP on a bug that is already loudly reported (it is
 * tracked by the `theme-toggle` fixme + surfaced in `knownZodEvalViolations`).
 * Any OTHER CSP violation still fails this test hard.
 *
 * Tagged `@smoke`.
 */
test.describe('landing — SSR floor + production-CSP gate', () => {
  test('renders the hero, chrome, and is CSP/console clean @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);

    await landing.goto();

    await expect(page).toHaveTitle(/Razor.s Edge/i);

    // The real H1 — present even before/without GSAP (the no-JS floor).
    await expect(landing.heroHeading()).toBeAttached();

    // Header chrome.
    await expect(landing.primaryNav()).toBeVisible();
    await expect(landing.bookCta()).toBeVisible();

    // Let GSAP register + the hero hydrate, then settle, so any CSP violation
    // or runtime error fired during hydration is captured before we assert.
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

  test('the Book CTA routes to /book @smoke', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await Promise.all([
      page.waitForURL(/\/book(\?.*)?$/, { timeout: 30_000 }),
      landing.bookCta().click(),
    ]);

    await expect(
      page.locator('#wizard-step-heading'),
      'the wizard step heading mounts on /book',
    ).toBeVisible();
  });
});
