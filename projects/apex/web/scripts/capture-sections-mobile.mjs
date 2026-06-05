// @ts-nocheck
/* eslint-disable */
/** Capture Phase-5 sections at MOBILE (390px) — companion to capture-sections.mjs
 * (light + CSP) and capture-sections-dm.mjs (dark). Run against `next start`. */
const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.screenshots');
const png = (n) => join(OUT, n);
const BASE = `http://localhost:${process.argv[2] ?? '3090'}`;
const SECTIONS = ['fleet', 'how-it-works', 'gallery', 'locations', 'testimonials'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1000);
const h = await page.evaluate(() => document.body.scrollHeight);
const vh = await page.evaluate(() => window.innerHeight);
for (let y = 0; y < h; y += Math.floor(vh * 0.6)) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(120);
}
for (const id of SECTIONS) {
  const g = await page.evaluate((sid) => {
    const el = document.getElementById(sid);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: el.offsetHeight };
  }, id);
  if (!g) continue;
  const slices = Math.min(4, Math.max(1, Math.ceil(g.height / vh)));
  for (let s = 0; s < slices; s++) {
    await page.evaluate((y) => window.scrollTo(0, y), g.top + s * vh);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: png(`section-${id}-mobile-${s + 1}.png`),
      animations: 'disabled',
    });
  }
}
await browser.close();
console.log('Mobile section screenshots written.');
