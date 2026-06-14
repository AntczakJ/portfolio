import { expect, test } from '@playwright/test';

import { armFromGate, gotoStage } from '@helpers/index';

/**
 * 320px (CLAUDE.md § 4 — tested from 320px upward). No horizontal overflow on
 * the two routes:
 *   - `/` with the intro gate + (once armed) the auto-dimming HUD reflowed
 *     thumb-reachable;
 *   - `/about` long-form reading surface.
 *
 * The wordmark clamp (D-02) and the bottom-bar `max-w` cap (D-04/D-08) are the
 * fixes this guards against regressing.
 */
test.describe('320px — no horizontal overflow', () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test('/ (intro gate) does not overflow at 320px @smoke', async ({ page }) => {
    await gotoStage(page);
    await expect(
      page.getByRole('button', { name: /press to begin/i }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow, '/ intro: no horizontal overflow at 320px').toBe(false);
  });

  test('/ (armed HUD) does not overflow at 320px', async ({ page }) => {
    await gotoStage(page);
    await armFromGate(page);
    // The HUD reflows to a thumb-reachable column; assert no horizontal scroll.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow, '/ armed HUD: no horizontal overflow at 320px').toBe(false);
  });

  test('/about does not overflow at 320px @smoke', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow, '/about: no horizontal overflow at 320px').toBe(false);
  });
});
