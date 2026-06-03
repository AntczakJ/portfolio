import { expect, test } from '@playwright/test';

import { LandingPage, attachDiagnostics } from '@helpers/index';

/**
 * Test 8 — theme toggle (dark is canonical; light is the intentional
 * "editorial print" register, CLAUDE.md § 4).
 *
 * next-themes drives the class on `<html>` (`attribute="class"`,
 * `defaultTheme="dark"`, `themes=['light','dark']`). The CORE behaviour —
 * toggle flips the class, persists across reload, the page renders — is the
 * active, passing coverage here.
 *
 * Writing this spec SURFACED a real defect (reported, tracked below as
 * `test.fixme`, not faked): the FIRST click of the theme toggle on the
 * landing page fires a `script-src 'eval'` CSP violation. Zod 4's JIT
 * `allowsEval` probe (`new Function`) is meant to be suppressed by
 * `z.config({ jitless: true })` in `Providers`, and it IS suppressed on
 * `/book` (where a validator compiles eagerly). But on `/`, the first zod
 * validator only compiles when the toggle interaction triggers it, and the
 * probe slips through there — one blocked `eval` under the strict no-`unsafe-
 * eval` CSP. The prior milestone captures missed it because they pre-seeded
 * the theme via localStorage and never CLICKED the toggle on `/`.
 */
test.describe('theme toggle — light persists and renders', () => {
  test('toggle to light flips <html> and persists across reload @smoke', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const html = page.locator('html');

    // Default is dark.
    await expect(html).toHaveClass(/dark/);

    // Toggle to light — the button's accessible name is state-describing.
    const toggle = landing.themeToggle();
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    // Persists across a reload (next-themes writes localStorage `theme`).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveClass(/light/);

    // The page renders in light without throwing — the hero floor is present.
    await expect(landing.heroHeading()).toBeAttached();
  });

  // FIXED (D-CSP-1) — `z.config({ jitless: true })` is now a side-effect that
  // runs GLOBALLY + EARLY (imported at the top of the schema foundation
  // `schemas/common`, the schema barrel, and the root layout), so no validator
  // on ANY route — including the lazy first-compile on `/` — can JIT-compile a
  // `new Function` probe under the strict no-`unsafe-eval` CSP.
  test('toggling the theme does not trip a CSP eval violation', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);
    await landing.goto();

    await landing.themeToggle().click();
    await page.waitForTimeout(500);

    // The zod eval probe must no longer fire, and no other CSP violation
    // either.
    expect(
      diag.knownZodEvalViolations,
      `zod eval probe fired on theme toggle:\n${diag.knownZodEvalViolations.join('\n')}`,
    ).toEqual([]);
    expect(diag.cspViolations, 'other CSP violations').toEqual([]);
  });
});
