import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';
import { buildFootprintSnapshot } from '../fixtures/footprint-snapshot';

/**
 * Critical path 3 (Task 5.3) — theme toggle works and the chart
 * re-derives its palette without crashing.
 *
 * The toggle (footer) cycles system → light → dark → system. next-themes
 * writes the resolved theme to `data-theme` on `<html>`. The Canvas2D
 * footprint reads its colours from CSS variables via a
 * getComputedStyle + MutationObserver bridge, so a theme flip must
 * re-resolve the token palette and repaint — and must NOT throw.
 *
 * `colorScheme: 'light'` is pinned in the config so `system` resolves
 * deterministically to `data-theme="light"`.
 */
test.describe('theme toggle — cycle + chart palette re-derive', () => {
  test('cycling theme flips data-theme and keeps the chart painted', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.waitForStoreHook();

    // Seed the footprint so there is painted content to survive the flip.
    await app.injectSnapshot(buildFootprintSnapshot());
    await app.expectCanvasPainted();

    // Track any uncaught page error across the whole cycle.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const html = page.locator('html');
    const toggle = app.themeToggle();
    await expect(toggle).toBeVisible();

    // The toggle cycles system → light → dark → system. Under the pinned
    // `colorScheme: 'light'`, `system` and `light` both RESOLVE to
    // `data-theme="light"`, so a single click does not always change the
    // attribute — we instead drive the cycle until we OBSERVE the dark
    // state, then confirm the light state is reachable too. That proves
    // both palette branches re-derive without asserting on the ambiguous
    // single-step transition.
    const seen = new Set<string>();
    const recordAttr = async (): Promise<void> => {
      const attr = await html.getAttribute('data-theme');
      if (attr !== null) seen.add(attr);
    };
    await recordAttr();
    for (let i = 0; i < 4 && !(seen.has('dark') && seen.has('light')); i += 1) {
      await toggle.click();
      // next-themes commits the attribute on the click's effect; a short
      // settle is enough (the cycle is light → light → dark across steps).
      await page.waitForTimeout(80);
      await recordAttr();
    }

    expect(seen.has('dark')).toBe(true);
    expect(seen.has('light')).toBe(true);

    // Drive to an explicit dark state for the final paint assertion.
    for (let i = 0; i < 4; i += 1) {
      if ((await html.getAttribute('data-theme')) === 'dark') break;
      await toggle.click();
      await page.waitForTimeout(60);
    }
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // After the palette re-derive the chart is still painted (the bridge
    // re-resolved and the engine repainted, no crash / blank canvas).
    await app.expectCanvasPainted();

    expect(errors).toEqual([]);
  });

  test('both themes paint the footprint (no theme-specific blank)', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();

    // Light first.
    await page.emulateMedia({ colorScheme: 'light' });
    await app.goto();
    await app.waitForStoreHook();
    await app.injectSnapshot(buildFootprintSnapshot());
    await app.expectCanvasPainted();

    // Flip the OS preference to dark; next-themes (system) re-resolves
    // and the bridge repaints. The canvas must remain non-blank.
    await page.emulateMedia({ colorScheme: 'dark' });
    await app.expectCanvasPainted();
  });
});
