// @ts-nocheck
/* eslint-disable */
/**
 * PASS-B D-13 evidence: the header chrome + wordmark specimen + the track-line
 * baseline motif. Captures (1) the header at rest over the hero (transparent,
 * faint baseline track-line), (2) the SCROLLED header (surface + lit baseline
 * track-line), and (3) a tight crop of the wordmark lockup. Both themes.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.remove('light', 'dark');
    r.classList.add(t);
  }, theme);
  await page.waitForTimeout(500);

  // Header at rest (top of page, transparent over hero).
  await page.screenshot({
    path: join(OUT, `header-rest-${theme}.png`), animations: 'disabled',
    clip: { x: 0, y: 0, width: 1440, height: 96 },
  });

  // Scrolled header (surface + lit baseline track-line).
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(OUT, `header-scrolled-${theme}.png`), animations: 'disabled',
    clip: { x: 0, y: 0, width: 1440, height: 96 },
  });

  // Tight wordmark crop.
  const mark = page.locator('header a[aria-label="APEX — home"]').first();
  const box = await mark.boundingBox();
  if (box) {
    await page.screenshot({
      path: join(OUT, `wordmark-${theme}.png`), animations: 'disabled',
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 10),
        width: box.width + 24,
        height: box.height + 20,
      },
    });
  }
  await page.close();
  console.log(`captured header + wordmark ${theme}`);
}

await browser.close();
console.log('Header/wordmark screenshots in scripts/.screenshots/');
