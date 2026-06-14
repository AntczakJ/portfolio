import { expect, test } from '@playwright/test';

import { attachDiagnostics, denyFloatBuffer, denyWebgl, PRESETS } from '@helpers/index';

/**
 * The four-tier degradation floor (ADR-004 §2/§3) — the no-WebGL and no-JS
 * surfaces are real, indexable, screen-reader-readable DOM, not a stub.
 *
 *   - Tier-4 (no WebGL2 at all): `detectGpuTier()` routes to the poster; the
 *     SSR `#main[data-nojs-fallback]` wordmark + positioning + the 6-card preset
 *     directory are the readable floor. No live canvas, no gesture gate.
 *   - Tier-4 (WebGL2 but no `EXT_color_buffer_float`): the GPGPU-specific hard
 *     gate unique to nocturne — float render targets are required for the FBO
 *     ping-pong, so a WebGL2 GPU that cannot render float still routes to the
 *     poster.
 *   - no-JS: with JavaScript disabled, the SSR floor (wordmark + positioning +
 *     directory) is the entire page — the SEO / screen-reader floor. `data-armed`
 *     is never set, so the fallback is never hidden.
 */

test.describe('Tier-4 — no WebGL2', () => {
  test('the poster + the 6-card preset directory render as real DOM, no canvas, no gate @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    await denyWebgl(page);
    await page.goto('/');
    // Give the after-mount probe time to route to the poster.
    await expect(page.locator('html')).not.toHaveAttribute('data-armed', '');

    // No live canvas mounts on the poster route.
    await expect(page.locator('canvas')).toHaveCount(0);

    // No gesture gate over the poster route.
    await expect(
      page.getByRole('button', { name: /press to begin/i }),
    ).toHaveCount(0);

    // The readable floor: the wordmark + the full preset directory as real DOM.
    const fallback = page.locator('[data-nojs-fallback]');
    await expect(
      fallback.getByRole('heading', { level: 1, name: /nocturne/i }),
    ).toBeVisible();

    const directoryItems = fallback
      .getByRole('region', { name: /preset directory/i })
      .locator('li');
    await expect(directoryItems).toHaveCount(PRESETS.length);
    // Each preset's name is in the directory DOM.
    for (const preset of PRESETS) {
      await expect(fallback.getByText(preset.name, { exact: true })).toBeVisible();
    }

    expect(diag.cspViolations).toEqual([]);
    expect(diag.pageErrors).toEqual([]);
  });
});

test.describe('Tier-4 — WebGL2 without EXT_color_buffer_float (the GPGPU float gate)', () => {
  test('a WebGL2 GPU that cannot render float also routes to the poster + directory floor', async ({
    page,
  }) => {
    await denyFloatBuffer(page);
    await page.goto('/');

    await expect(page.locator('html')).not.toHaveAttribute('data-armed', '');
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /press to begin/i }),
    ).toHaveCount(0);

    const fallback = page.locator('[data-nojs-fallback]');
    await expect(
      fallback.getByRole('region', { name: /preset directory/i }).locator('li'),
    ).toHaveCount(PRESETS.length);
  });
});

test.describe('no-JS floor (the SEO / screen-reader surface)', () => {
  test.use({ javaScriptEnabled: false });

  test('with JS off, the wordmark + positioning + the 6-card directory render server-side @smoke', async ({
    page,
  }) => {
    await page.goto('/');

    // The SSR fallback is the whole page (no client island runs, so data-armed
    // is never set and nothing is hidden).
    const fallback = page.locator('[data-nojs-fallback]');
    await expect(
      fallback.getByRole('heading', { level: 1, name: /nocturne/i }),
    ).toBeVisible();

    // The positioning copy is present.
    await expect(fallback.getByText(/gpu audio-reactive field/i)).toBeVisible();

    // The full preset directory is real DOM (the indexable floor).
    await expect(
      fallback.getByRole('region', { name: /preset directory/i }).locator('li'),
    ).toHaveCount(PRESETS.length);

    // The about link is reachable (no-JS navigation works).
    await expect(
      fallback.getByRole('link', { name: /about the technique/i }),
    ).toBeVisible();

    // No live canvas with JS off.
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});
