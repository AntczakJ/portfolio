import { expect, test } from '@playwright/test';

import { LandingPage, PROJECTS, attachDiagnostics, bayId } from '@helpers/index';

/**
 * Test 1 — landing SSR / production-CSP smoke.
 *
 * The page is the single long-form lobby. This proves the production surface is
 * clean: the hero wordmark is the real `<h1>`, all six bays + the directory are
 * present, GSAP hydrates without tripping the strict no-`unsafe-eval` CSP, and
 * the console/page-error channels stay empty. Every later spec layers a specific
 * behaviour on top of this floor.
 */
test.describe('landing — production surface smoke', () => {
  test('renders the lobby with GSAP hydrated and a clean CSP @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);

    await landing.goto();

    // The hero wordmark — the LCP / SSR / no-JS floor.
    await expect(landing.heroHeading()).toBeVisible();

    // All six bays are present, in canonical order.
    for (const project of PROJECTS) {
      await expect(
        page.locator(`#${bayId(project.slug)}`),
        `bay ${project.slug} is present`,
      ).toBeAttached();
    }

    // The directory floor is present.
    await expect(landing.directory()).toBeAttached();

    // Give hydration + the GSAP code-split chunk time to attach and run.
    await page.waitForTimeout(800);

    // The production-surface gate: zero CSP violations, zero console/page errors.
    expect(
      diag.cspViolations,
      `CSP violations:\n${diag.cspViolations.join('\n')}`,
    ).toEqual([]);
    expect(
      diag.pageErrors.map((e) => e.message),
      'uncaught page errors',
    ).toEqual([]);
    expect(diag.consoleErrors, 'console.error output').toEqual([]);
  });
});
