// @ts-nocheck
/* eslint-disable */
/**
 * Capture tight, side-by-side crops of the three wheel finishes from the LIVE
 * configurator (P1-NEW-3 evidence). For each wheel the live canvas is forced
 * opaque + the still hidden (the same render-harness trick as
 * render-from-scene.mjs), the scene is set to Glacier paint + the wheel under
 * test, and a square crop over a front wheel is exported as PNG so the three
 * finishes can be compared at a glance. Output -> scripts/.screenshots/.
 * Run against a running `next start` on argv[2] (default 3090).
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

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
const WHEELS = ['whl-aero', 'whl-turbine', 'whl-forged'];

async function setConfig(page, colorId, wheelId) {
  await page.evaluate(
    ({ colorId, wheelId }) => {
      document
        .querySelector(`input[name="apex-color"][value="${colorId}"]`)
        ?.click();
      document
        .querySelector(`input[name="apex-wheel"][value="${wheelId}"]`)
        ?.click();
    },
    { colorId, wheelId },
  );
  await page.waitForTimeout(700);
}

async function shootCanvas(page) {
  const stage = page.locator('[data-configurator-stage]').first();
  await page
    .locator('#configurator canvas')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(700);
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage box not found');
  return page.screenshot({ type: 'png', clip: box });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1100 },
  deviceScaleFactor: 2,
  hasTouch: false,
  isMobile: false,
  reducedMotion: 'reduce',
});
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.addStyleTag({
  content: `
    #configurator p[aria-hidden="true"]{display:none !important;}
    [data-configurator-stage] *{transition:none !important;}
    [data-configurator-stage] > div > div.absolute.inset-0:first-child{opacity:1 !important;}
    [data-configurator-stage] > div > div.absolute.inset-0:nth-child(2){opacity:0 !important;}
  `,
});
await page.locator('#configurator').scrollIntoViewIfNeeded();
await page.waitForSelector('#configurator canvas', {
  state: 'attached',
  timeout: 45000,
});
await page.waitForTimeout(2000);

const crops = [];
for (const wheelId of WHEELS) {
  await setConfig(page, 'col-glacier', wheelId);
  const png = await shootCanvas(page);
  const meta = await sharp(png).metadata();
  // Front wheel sits lower-CENTER in the current 3/4-front rig framing.
  const side = Math.round(Math.min(meta.width, meta.height) * 0.4);
  const left = Math.round(meta.width * 0.28);
  const top = Math.round(meta.height * 0.52);
  const crop = await sharp(png)
    .extract({ left, top, width: side, height: side })
    .resize(360, 360)
    .png()
    .toBuffer();
  await sharp(crop).toFile(join(OUT, `wheel-${wheelId}.png`));
  crops.push({ input: crop, top: 0, left: crops.length * 360 });
  console.log(`captured ${wheelId}`);
}

// A single side-by-side strip for the critic.
await sharp({
  create: {
    width: 360 * 3,
    height: 360,
    channels: 4,
    background: { r: 244, g: 246, b: 248, alpha: 1 },
  },
})
  .composite(crops)
  .png()
  .toFile(join(OUT, 'wheel-finishes-compare.png'));
console.log('captured wheel-finishes-compare.png');

await browser.close();
console.log('Wheel crops in scripts/.screenshots/');
