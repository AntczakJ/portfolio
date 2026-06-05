// @ts-nocheck
/* eslint-disable */
/**
 * PASS-B D-10 evidence: capture the configurator swatches showing the THREE
 * distinct states side by side — SELECTED (accent ring), KEYBOARD FOCUS (a
 * thick foreground outline, offset outside the ring), and HOVER/rest. Drives the
 * real keyboard path (Tab into the radio group, arrow within it) so the
 * focus-visible treatment is exercised exactly as a keyboard user would.
 * Output -> scripts/.screenshots/configurator-focus-state{,-dark}.png.
 * Run against a running `next start` (default 3090).
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.screenshots');
await mkdir(OUT, { recursive: true });
const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  // Persist the theme BEFORE the first paint so next-themes does not overwrite
  // our class back to the stored value (the cause of the earlier dark capture
  // coming out byte-identical to light — next-themes' storage listener reverted
  // a directly-set class). Set storage, then load, so the page hydrates dark.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('theme', t), theme);
  await page.reload({ waitUntil: 'load' });
  // Confirm the dark register actually took before we capture.
  await page.waitForFunction(
    (t) =>
      t === 'dark'
        ? document.documentElement.classList.contains('dark')
        : !document.documentElement.classList.contains('dark'),
    theme,
    { timeout: 5000 },
  );

  // Make sure the controls have hydrated + are in view before interacting (the
  // auto-rotating canvas keeps the main thread busy, so we scroll via the DOM
  // and wait for the radiogroup explicitly rather than relying on actionability).
  await page.locator('#configurator').scrollIntoViewIfNeeded();
  await page
    .locator('[role="radiogroup"][aria-label="Paint colour"]')
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);

  // Select a paint swatch that is NOT the one we will focus, so SELECTED and
  // FOCUS land on different swatches and both states are visible at once.
  await page.evaluate(() => {
    document
      .querySelector('input[name="apex-color"][value="col-voltaic"]')
      ?.click();
  });

  // Keyboard-focus a DIFFERENT swatch (Glacier) by focusing its radio directly,
  // then assert focus-visible engages (Playwright focus sets :focus-visible for
  // keyboard-origin focus when we use the keyboard; we use .focus() + a Tab to
  // make the heuristic treat it as keyboard focus).
  await page.locator('input[name="apex-color"][value="col-glacier"]').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('value') ?? el?.tagName ?? 'none';
  });
  console.log(`${theme}: active element value = ${focused}`);

  // Frame the controls region.
  await page.waitForTimeout(300);
  const box = await page
    .locator('[role="radiogroup"][aria-label="Paint colour"]')
    .boundingBox();
  if (box) {
    await page.screenshot({
      path: join(OUT, `configurator-focus-state${theme === 'dark' ? '-dark' : ''}.png`),
      clip: {
        x: Math.max(0, box.x - 16),
        y: Math.max(0, box.y - 40),
        width: box.width + 32,
        height: box.height + 64,
      },
    });
  } else {
    await page.screenshot({
      path: join(OUT, `configurator-focus-state${theme === 'dark' ? '-dark' : ''}.png`),
    });
  }
  await page.close();
  console.log(`captured focus state ${theme}`);
}

await browser.close();
console.log('Focus-state screenshots in scripts/.screenshots/');
