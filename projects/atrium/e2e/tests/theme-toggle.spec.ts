import { expect, test } from '@playwright/test';

import { LandingPage, attachDiagnostics } from '@helpers/index';

/**
 * Test 4 — theme toggle (dark is canonical; light is the intentional
 * "architectural daylight" register, CLAUDE.md § 4 / ADR-003).
 *
 * next-themes drives the class on `<html>` (`attribute="class"`,
 * `defaultTheme="dark"`, `themes=['light','dark']`). The toggle flips the class,
 * the page renders in both themes without throwing or tripping the strict CSP
 * (no FOUC: `:root` is the dark token set + `suppressHydrationWarning` +
 * `disableTransitionOnChange`), and the choice persists across reload.
 *
 * The toggle lives in the post-hero sticky header, which is hidden + raised
 * while the hero fills the viewport (the cinematic first paint is uninterrupted)
 * and reveals once the hero scrolls past. So each test scrolls past the hero
 * first to make the toggle interactable.
 */
async function revealHeader(landing: LandingPage): Promise<void> {
  // Incrementally scroll past the hero so the reveal IntersectionObserver fires
  // (an instant teleport can miss the crossing — atrium AGENT_NOTES Phase 3).
  for (let y = 0; y <= 1600; y += 400) {
    await landing.page.evaluate((to) => {
      window.scrollTo(0, to);
    }, y);
    await landing.page.waitForTimeout(120);
  }
  // Settle the scroll so the fixed header is stable in the viewport before the
  // click (without this beat the toggle could be mid-scroll "outside of the
  // viewport" when Playwright retries the click — a timing flake, not a defect).
  await landing.page.waitForTimeout(250);
  await expect(landing.themeToggle()).toBeVisible();
  await landing.themeToggle().scrollIntoViewIfNeeded();
}

test.describe('theme toggle — both themes, persistence, no FOUC', () => {
  test('toggle to light flips <html> and persists across reload @smoke', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const html = page.locator('html');

    // Default is dark (the canonical theme + SSR first paint — no FOUC).
    await expect(html).toHaveClass(/dark/);

    await revealHeader(landing);

    const toggle = landing.themeToggle();
    await toggle.click();

    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    // Persists across a reload (next-themes writes localStorage `theme`).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveClass(/light/);

    // The page renders in light without throwing — the hero floor is present.
    await expect(landing.heroHeading()).toBeVisible();

    // And back to dark.
    await revealHeader(landing);
    await landing.themeToggle().click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });

  test('toggling the theme trips no CSP eval violation or page error', async ({
    page,
  }) => {
    // atrium closed the Zod-JIT-eval risk with `z.config({ jitless: true })`
    // (AGENT_NOTES Phase 3). Toggling the theme — which exercises a client
    // interaction path — must fire ZERO CSP violations under the strict
    // no-`unsafe-eval` policy.
    const diag = await attachDiagnostics(page);
    const landing = new LandingPage(page);
    await landing.goto();

    await revealHeader(landing);
    await landing.themeToggle().click();
    await page.waitForTimeout(500);

    expect(
      diag.cspViolations,
      `CSP violations on theme toggle:\n${diag.cspViolations.join('\n')}`,
    ).toEqual([]);
    expect(diag.pageErrors.map((e) => e.message), 'page errors').toEqual([]);
  });
});
