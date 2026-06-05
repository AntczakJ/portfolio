// @ts-nocheck
/* eslint-disable */
/**
 * capture-ultrawide.mjs — A-10 evidence: the marketing spine must stay centred
 * with balanced gutters at 2560px (it grows the content column to 1440px via
 * `--width-content: clamp(1280px, 60vw, 1440px)`, never edge-to-edge). Captures
 * the fleet + gallery at 2560 wide. Run against a running `next start`.
 *
 *   node scripts/capture-ultrawide.mjs [port]
 */
const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);
const { mkdir } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const { join, dirname } = await import('node:path');

const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.screenshots');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);

// Slow-scroll so ScrollTriggers fire.
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 800) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(120);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

async function shoot(id, name) {
  const top = await page.evaluate((sid) => {
    const el = document.getElementById(sid);
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  }, id);
  await page.evaluate((y) => window.scrollTo(0, y), top);
  await page.waitForTimeout(500);
  // Reveal gallery masks so the subject shows (capture artifact guard).
  if (id === 'gallery') {
    await page.evaluate(() => {
      document.querySelectorAll('[data-frame-mask]').forEach((m) => (m.style.clipPath = 'inset(0)'));
      document.querySelectorAll('[data-frame-img]').forEach((i) => (i.style.transform = 'translateY(0)'));
      document.querySelectorAll('[data-frame-copy]').forEach((c) => { c.style.opacity = '1'; c.style.transform = 'none'; });
    });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: join(OUT, name), animations: 'disabled' });
  console.log('captured', name);
}

await shoot('fleet', 'section-ultrawide-2560-fleet.png');
await shoot('gallery', 'section-ultrawide-2560-gallery.png');

await browser.close();
console.log('ultrawide 2560 captures done');
