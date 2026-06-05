// @ts-nocheck
/* eslint-disable */
/**
 * Screenshot capture for the designer-critic (Task 4.3/4.4): the live
 * configurator (desktop light + dark), a colour/wheel swap, the Tier-3 mobile
 * pre-baked fallback. Output -> scripts/.screenshots/.
 * Run against a running `next start` on argv[2] (default 3090).
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightUrl = new URL('../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs', import.meta.url).href;
const { chromium, devices } = await import(playwrightUrl);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.screenshots');
await mkdir(OUT, { recursive: true });
const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t);
  }, theme);
  await page.reload({ waitUntil: 'load' });
}

// Desktop light + dark + a swap.
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await setTheme(page, theme);
  await page.locator('#configurator').scrollIntoViewIfNeeded();
  await page.waitForSelector('#configurator canvas', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const el = document.querySelector('#configurator'); el?.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `configurator-desktop-${theme}.png`) });

  // A colour + wheel swap. `force` because the auto-rotating canvas keeps the
  // main thread busy enough that Playwright's stability wait can stall on the
  // sr-only radio's label; the click target itself is stable.
  await page
    .getByRole('radio', { name: /Voltaic/i })
    .locator('xpath=ancestor::label')
    .first()
    .click({ force: true });
  await page
    .getByRole('radio', { name: /Forged/i })
    .locator('xpath=ancestor::label')
    .first()
    .click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `configurator-desktop-${theme}-voltaic-forged.png`) });
  await page.close();
  console.log(`captured desktop ${theme} (+ swap)`);
}

// Tier-3 mobile fallback (pre-baked still).
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('#configurator').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.querySelector('#configurator')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'configurator-mobile-tier3.png') });
  // full mobile page
  await page.goto(BASE, { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, 'home-mobile.png') });
  await ctx.close();
  console.log('captured mobile Tier-3');
}

await browser.close();
console.log('Screenshots in scripts/.screenshots/');
