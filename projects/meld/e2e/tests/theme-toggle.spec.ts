import { expect, test } from '@playwright/test';

import { LandingPage } from '@helpers/landing-page';

/**
 * Test 9 — theme toggle cycles light → dark → system; `data-theme`
 * attribute flips on `<html>`; chrome surfaces (toolbar, banner,
 * identity badge) swap palettes via CSS variables.
 *
 * next-themes is the authoritative driver of the attribute. The
 * Zustand `useUiStore` mirrors the preference (cookie + localStorage)
 * but the e2e test asserts the DOM-level effect — the attribute flip
 * is what every CSS-variable consumer reads.
 *
 * The cycle order per the toggle's docblock: light → dark → system →
 * light. The button's `data-current-theme` attribute reflects the
 * resolved theme name (one of those three) for a deterministic
 * assertion checkpoint without a brittle aria-label match.
 */
test.describe('theme toggle — cycle and DOM attribute', () => {
  test('toggle cycles light → dark → system → light', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const html = page.locator('html');
    const toggle = landing.themeToggle();

    // First mount: next-themes resolves to 'light' (the default
    // declared in `<ThemeProvider attribute="data-theme" defaultTheme="light"`).
    // The toggle's `data-current-theme` reflects the resolved value
    // post-mount.
    await expect(toggle).toHaveAttribute('data-current-theme', 'light', {
      timeout: 5_000,
    });

    // Click → dark. `data-theme="dark"` on <html>.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-current-theme', 'dark', {
      timeout: 3_000,
    });
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Click → system. next-themes resolves system → light or dark
    // depending on the runner's `prefers-color-scheme`. Playwright's
    // `use.colorScheme = 'light'` in `playwright.config.ts` pins this
    // so the resolved attribute is deterministic — `data-theme="light"`
    // — while `data-current-theme` carries the literal `'system'`.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-current-theme', 'system', {
      timeout: 3_000,
    });
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Click → light. `data-theme="light"`.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-current-theme', 'light', {
      timeout: 3_000,
    });
    await expect(html).toHaveAttribute('data-theme', 'light');
  });
});
