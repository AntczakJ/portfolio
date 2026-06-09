import { expect, test } from '@playwright/test';

import { LandingPage, PROJECTS, attachDiagnostics, bayId } from '@helpers/index';

/**
 * Test 3 — the reduced-motion static-directory path (Task 6.2 / ADR-003 Tier 2).
 *
 * Under `prefers-reduced-motion: reduce` the descent + the six bay pins must be
 * FULLY neutralised: the `gsap.matchMedia()` `reduced` branch creates NOTHING —
 * no pin, no scrub, no parallax — so:
 *   - there is NO `.pin-spacer` in the DOM (GSAP inserts one per pinned trigger;
 *     zero means zero pins were created);
 *   - the page lands on its clean COMPOSED resting frame, nothing frozen
 *     mid-transition (the razors-edge D-07 lesson): the hero wordmark is legible
 *     and every bay's `<h2>` title is resolved/visible;
 *   - the document scrolls normally (no pin trap) so the directory floor and
 *     footer are reachable.
 */
test.describe('reduced-motion — static directory, no pin, nothing frozen', () => {
  test('renders the resolved page with zero pin-spacers and a clean console @smoke', async ({
    page,
  }) => {
    // Emulate reduced motion BEFORE navigation so the hero + bays matchMedia
    // evaluate the reduced branch on first paint.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);
    await landing.goto();

    // The hero wordmark floor is present and legible (not scaled/faded away).
    await expect(landing.heroHeading()).toBeVisible();

    // Let any (incorrect) pin attach attempt settle, then assert NONE happened.
    await page.waitForTimeout(800);

    const pinSpacers = page.locator('.pin-spacer');
    await expect(
      pinSpacers,
      'reduced motion must create no GSAP pin-spacers',
    ).toHaveCount(0);

    // Every bay title is RESOLVED and visible — nothing frozen mid-wipe.
    for (const project of PROJECTS) {
      const title = page.locator(`#${bayId(project.slug)}-title`);
      await expect(title, `${project.slug} title resolved`).toBeVisible();
      await expect(title).toHaveText(project.name);
    }

    // The document scrolls normally (no pin trap): the footer is reachable at
    // the document bottom rather than gated behind a pinned scrub.
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(300);
    await expect(page.locator('footer')).toBeInViewport();

    // The hard gate: no error fired while the reduced-motion branch ran.
    expect(
      diag.cspViolations,
      `CSP violations:\n${diag.cspViolations.join('\n')}`,
    ).toEqual([]);
    expect(diag.pageErrors.map((e) => e.message), 'page errors').toEqual([]);
    expect(diag.consoleErrors, 'console.error output').toEqual([]);
  });
});
