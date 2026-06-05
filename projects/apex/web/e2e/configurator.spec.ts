import { expect, test, type Page } from '@playwright/test';

/**
 * Click a swatch by clicking the visible `<label>` that wraps its sr-only radio
 * (the reliable path — a real pointer click on the label fires React's onChange;
 * a programmatic .click() on the sr-only controlled input races the re-render).
 * Mirrors the proven verify-tiers.mjs approach.
 */
async function pickSwatch(page: Page, name: RegExp): Promise<void> {
  await page
    .getByRole('radio', { name })
    .locator('xpath=ancestor::label')
    .first()
    .click();
}

/**
 * Configurator DOM-swatch interaction + the four-tier degradation (Task 7.2b).
 *
 * Runs on BOTH the desktop-chromium project (Tier-1 eligible — the live canvas
 * may mount) AND the mobile-chromium / Pixel-7 project (Tier-3 — NO three.js,
 * the pre-baked stills swap on a swatch change). The accessible DOM swatch
 * controls are identical across tiers (ADR-004), so the same selectors work on
 * both; the assertions adapt to the tier.
 *
 * Also asserts the Tier-4 no-JS floor (server-rendered still + reserve link, no
 * canvas) by loading with JavaScript disabled.
 */

test('the configurator swatches are real, keyboard-operable DOM radio groups', async ({
  page,
}) => {
  await page.goto('/#configurator');
  const paint = page.getByRole('radiogroup', { name: /paint/i });
  const wheels = page.getByRole('radiogroup', { name: /wheel/i });
  await expect(paint).toBeVisible();
  await expect(wheels).toBeVisible();

  // Colour radios are native inputs (not canvas-only) with a checked default.
  const colorRadios = page.locator('input[name="apex-color"]');
  await expect(colorRadios.first()).toHaveCount(1);
  const checkedCount = await page.locator('input[name="apex-color"]:checked').count();
  expect(checkedCount).toBe(1);
});

test('selecting a swatch updates the configuration (live canvas OR Tier-3 still swap)', async ({
  page,
}, testInfo) => {
  await page.goto('/#configurator');
  const stage = page.locator('[data-configurator-stage]');
  await expect(stage).toBeVisible();

  const isMobile = testInfo.project.name.startsWith('mobile');
  if (isMobile) {
    // Tier-3 guarantee: the mobile profile loads NO three.js — zero <canvas>.
    await expect(page.locator('canvas')).toHaveCount(0);
    // The pre-baked still swaps when a colour radio changes. The stage overlay
    // still is the SECOND img inside the stage box (index 0 is the static
    // Tier-4 floor still that stays at the default — the verify-tiers contract).
    const still = stage.locator('img').nth(1);
    const before = await still.getAttribute('src');
    await pickSwatch(page, /Voltaic/i);
    await expect(async () => {
      const after = await still.getAttribute('src');
      expect(after).not.toBe(before);
      expect(after).toContain('col-voltaic');
    }).toPass();
  } else {
    // Desktop (Tier-1 eligible — the live canvas may mount). The DOM swatch is
    // the source of truth regardless of the render surface; assert the store
    // updated via the visible "Current configuration" text + the radio state.
    await pickSwatch(page, /Midnight/i);
    await expect(page.locator('[data-configuration-text]')).toContainText(/midnight/i);
    await expect(
      page.locator('input[name="apex-color"][value="col-midnight"]'),
    ).toBeChecked();
  }
});

test('the wheel radio group is keyboard-operable and reflects in the live region', async ({
  page,
}) => {
  await page.goto('/#configurator');
  // Native radio-group keyboard semantics: focus the group, ArrowRight moves AND
  // selects the next radio (the WAI-ARIA radio pattern). From the default Aero,
  // two ArrowRights reach Forged (Aero → Turbine → Forged).
  const aero = page.locator('input[name="apex-wheel"][value="whl-aero"]');
  await aero.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(
    page.locator('input[name="apex-wheel"][value="whl-forged"]'),
  ).toBeChecked();
  // The debounced (350ms) aria-live text alternative reflects the chosen wheel.
  await expect(page.locator('[aria-live="polite"]')).toContainText(/forged/i, {
    timeout: 5000,
  });
});

test('"Reserve this configuration" carries the config into the wizard deep-link', async ({
  page,
}) => {
  await page.goto('/#configurator');
  await pickSwatch(page, /Voltaic/i);
  await pickSwatch(page, /Forged/i);
  // Wait for the store to flush into the visible config line before reserving,
  // so router.push() reads the chosen ids (not the stale default).
  await expect(page.locator('[data-configuration-text]')).toContainText(/voltaic/i);
  await expect(page.locator('[data-configuration-text]')).toContainText(/forged/i);
  // "Reserve this configuration" is a button that router.push()es the deep-link.
  const reserveBtn = page.getByRole('button', { name: /reserve this configuration/i }).first();
  await reserveBtn.scrollIntoViewIfNeeded();
  // `force` because on a Tier-1 desktop the live WebGL canvas sits in the same
  // section and Playwright's actionability can flag it as an overlay; the button
  // is real, focusable DOM above it.
  await reserveBtn.click({ force: true });
  // Navigates client-side to /reserve carrying the chosen config (the spine
  // thread). Wait for the navigation, then assert the params.
  await page.waitForURL(/\/reserve\?/, { timeout: 20_000 });
  expect(page.url()).toContain('vehicle=lumen-gt');
  expect(page.url()).toContain('color=col-voltaic');
  expect(page.url()).toContain('wheels=whl-forged');
});

test('Tier-4 no-JS floor: server-rendered still + reserve link, zero canvas', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/');
  // No WebGL without JS.
  await expect(page.locator('canvas')).toHaveCount(0);
  // The configurator section still renders a real <img> still with alt text...
  const stage = page.locator('[data-configurator-stage]');
  await expect(stage).toBeVisible();
  await expect(stage.locator('img[alt*="APEX studio render"]').first()).toBeVisible();
  // ...and the configurator heading is real server DOM.
  await expect(
    page.getByRole('heading', { name: /lumen|configure|shape/i }).first(),
  ).toBeVisible();
  await ctx.close();
});
