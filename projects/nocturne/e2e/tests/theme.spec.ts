import { expect, test } from '@playwright/test';
import { armFromGate, gotoStage } from '@helpers/index';

/**
 * Theme (ADR-004 §4, CLAUDE.md § 4) — the CHROME respects prefers-color-scheme
 * (defaultTheme="system"), but the canvas STAGE stays dark in BOTH chrome
 * themes (theme-invariant `--stage-*` tokens). No FOUC.
 *
 * The stage-dark invariant is the load-bearing assertion: you do not
 * "light-mode" an additive glowing particle field. We assert the resolved value
 * of `--stage-bg` is the deep indigo-black in both light and dark chrome, while
 * the chrome (the /about background / foreground) does flip.
 */

// --stage-bg is authored as oklch(0.13 0.03 274); the browser serializes the
// lightness as a percentage, so the computed value reads `oklch(13% .03 274)`.
// The invariant we assert: the stage stays a DEEP dark (lightness ≤ ~16%) in
// both chrome themes.
const STAGE_DARK_HINT = /oklch\(\s*1[0-6]%/;

test.describe('chrome theme respects prefers-color-scheme', () => {
  test.describe('light OS', () => {
    test.use({ colorScheme: 'light' });

    test('a light-OS visitor gets LIGHT chrome on first load, but the stage stays dark', async ({
      page,
    }) => {
      await gotoStage(page);
      // The chrome resolves to light (next-themes defaultTheme="system" +
      // enableSystem — D-01 fix).
      await expect(page.locator('html')).toHaveClass(/light/);
      await expect(page.locator('html')).not.toHaveClass(/dark/);

      // The STAGE token is theme-invariant and stays dark.
      const stageBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--stage-bg')
          .trim(),
      );
      expect(stageBg, '--stage-bg stays dark in light chrome').toMatch(
        STAGE_DARK_HINT,
      );
    });
  });

  test.describe('dark OS', () => {
    test.use({ colorScheme: 'dark' });

    test('a dark-OS visitor gets DARK chrome on first load, and the stage is dark', async ({
      page,
    }) => {
      await gotoStage(page);
      await expect(page.locator('html')).toHaveClass(/dark/);

      const stageBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--stage-bg')
          .trim(),
      );
      expect(stageBg, '--stage-bg is dark in dark chrome').toMatch(
        STAGE_DARK_HINT,
      );
    });
  });
});

test.describe('theme toggle persists', () => {
  test.use({ colorScheme: 'dark' });

  test('toggling to light persists across a reload, and the stage stays dark throughout', async ({
    page,
  }) => {
    // Arm so the HUD (which carries the theme toggle) is present.
    await gotoStage(page);
    await armFromGate(page);

    // Toggle to light chrome. The HUD sits over a continuously-animating
    // (software-GL headless) canvas, which never gives Playwright's pointer
    // post-action stability window — so we drive the control by KEYBOARD
    // (focus + Enter). This is also the more faithful assertion: the control is
    // keyboard-operable (ADR-004 §5). The HUD is real DOM regardless of the
    // canvas, so focus + activation are deterministic.
    const toLight = page.getByRole('button', {
      name: /switch to light chrome/i,
    });
    await toLight.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('theme')))
      .toBe('light');

    // The stage stays dark even in light chrome.
    const stageBgLight = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--stage-bg')
        .trim(),
    );
    expect(stageBgLight).toMatch(STAGE_DARK_HINT);

    // Reload — the persisted light chrome is re-applied pre-paint (no FOUC of
    // the dark class). The pre-hydration next-themes script applies the
    // resolved class before first paint.
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/light/);
  });
});

test.describe('no FOUC on first paint', () => {
  test.use({ colorScheme: 'dark' });

  test('a persisted light choice is applied immediately on a fresh load', async ({
    page,
  }) => {
    // Seed the persisted light choice, then load fresh — the pre-hydration
    // script must apply `html.light` immediately even though the OS is dark.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'light');
      } catch {
        /* no-op */
      }
    });
    await gotoStage(page);
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
