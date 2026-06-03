import { expect, test } from '@playwright/test';

import { LandingPage, attachDiagnostics } from '@helpers/index';

/**
 * Test 7 — reduced-motion hero + gallery fallback.
 *
 * Under `prefers-reduced-motion: reduce` the hero must render its static /
 * crossfade composed reveal with NO pin and NO scrub (ADR-004 Tier 2), and
 * the gallery must use its non-pinned vertical-stack fallback rather than the
 * pinned horizontal scroll. The hard requirement is that GSAP's reduced-motion
 * `matchMedia` branch runs cleanly: NO pin/scrub error, ZERO console errors.
 *
 * This is the path the brief calls out explicitly — the wow is additive over
 * a floor that always works.
 */
test.describe('hero — reduced-motion path', () => {
  test('renders the static reveal with no pin error and a clean console', async ({
    page,
  }) => {
    // Emulate prefers-reduced-motion BEFORE navigation so the hero's GSAP
    // matchMedia evaluates the reduced branch on first paint.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);

    await landing.goto();

    // The hero content floor is present regardless of motion.
    await expect(landing.heroHeading()).toBeAttached();

    // Scroll the full page — under reduced motion there is no pinned scrub
    // trap, so the document scrolls normally and the gallery (its non-pinned
    // fallback) and the footer are reachable.
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(400);

    // The gallery section exists and its frames are laid out (the vertical
    // stack fallback — not a pinned horizontal strip).
    await expect(page.locator('#gallery')).toBeAttached();
    expect(
      await page.locator('[data-gallery-frame]').count(),
      'gallery frames render in the non-pinned fallback',
    ).toBeGreaterThan(0);

    // The hard gate: no pin/scrub error or any other console/page error fired
    // while the reduced-motion matchMedia branch ran.
    expect(
      diag.cspViolations,
      `CSP violations:\n${diag.cspViolations.join('\n')}`,
    ).toEqual([]);
    expect(
      diag.pageErrors.map((e) => e.message),
      'Uncaught page errors under reduced motion',
    ).toEqual([]);
    expect(diag.consoleErrors, 'console.error output').toEqual([]);
  });
});
