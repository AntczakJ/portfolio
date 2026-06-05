// @ts-nocheck
/* eslint-disable */
/**
 * capture-sections-dark.mjs — re-capture the dark-theme section screenshots
 * (the dark context uses BOTH colorScheme:'dark' and a stored theme so
 * next-themes hydrates dark). Run against a running `next start` with a WARM,
 * correct image-optimizer cache (clear `.next/cache/images` + restart after
 * regenerating any `public/` asset, then warm it, or the optimizer serves stale
 * optimized output for an unchanged URL — the documented stale-cache gotcha).
 *
 *   node scripts/capture-sections-dark.mjs [port]
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
const SECTIONS = ['fleet', 'how-it-works', 'gallery', 'locations', 'testimonials', 'footer'];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
await ctx.addInitScript(() => {
  try { localStorage.setItem('theme', 'dark'); } catch {}
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(1000);

const height = await page.evaluate(() => document.body.scrollHeight);
const vh = await page.evaluate(() => window.innerHeight);
for (let y = 0; y < height; y += Math.floor(vh * 0.6)) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(120);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

for (const id of SECTIONS) {
  const geom = await page.evaluate((sid) => {
    const el = document.getElementById(sid);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: el.offsetHeight };
  }, id);
  if (!geom) continue;
  const slices = Math.min(3, Math.max(1, Math.ceil(geom.height / vh)));
  for (let s = 0; s < slices; s++) {
    await page.evaluate((y) => window.scrollTo(0, y), geom.top + s * vh);
    await page.waitForTimeout(450);
    if (id === 'gallery') {
      await page.evaluate(() => {
        document.querySelectorAll('[data-frame-mask]').forEach((m) => (m.style.clipPath = 'inset(0)'));
        document.querySelectorAll('[data-frame-img]').forEach((i) => (i.style.transform = 'translateY(0)'));
        document.querySelectorAll('[data-frame-copy]').forEach((c) => { c.style.opacity = '1'; c.style.transform = 'none'; });
      });
      await page.waitForTimeout(150);
    }
    await page.screenshot({
      path: join(OUT, `section-${id}-dark${slices > 1 ? `-${s + 1}` : ''}.png`),
      animations: 'disabled',
    });
    console.log('captured', `section-${id}-dark${slices > 1 ? `-${s + 1}` : ''}`);
  }
}
await browser.close();
console.log('dark re-capture done');
