import { expect, test } from '@playwright/test';

import { trackWs } from '@helpers/ws-tracker';

/**
 * prefers-reduced-motion live map (Task 8.2). The no-WebGL table fallback arm
 * lives in `no-webgl.spec.ts` (it runs under a browser-level WebGL-disabled
 * project — the faithful no-WebGL client).
 *
 * Under reduced motion the live map must stay live (markers snap to each
 * authoritative tick instead of tweening) without crashing — the fleet stays
 * fully legible, the channel stays pushed.
 */

test.describe('prefers-reduced-motion live map', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('keeps the live map updating without crashing (markers snap to ticks)', async ({ page }) => {
    const tracker = trackWs(page);
    await page.goto('/');

    // The map still mounts and the channel is live under reduced motion (markers
    // snap to each authoritative tick instead of tweening — no rAF crash, no
    // dead surface).
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    // The fleet is still genuinely live: the server tick climbs.
    const tickReadout = page.locator('span', { hasText: /^t[\d,]+$/ }).first();
    await expect(tickReadout).toBeVisible();
    const first = Number((await tickReadout.innerText()).replace(/[^\d]/g, ''));
    await expect
      .poll(async () => Number((await tickReadout.innerText()).replace(/[^\d]/g, '')), {
        timeout: 15_000,
      })
      .toBeGreaterThan(first);

    // No JS error tore the page down; one socket still alive.
    expect(tracker.openCount()).toBe(1);
  });
});
