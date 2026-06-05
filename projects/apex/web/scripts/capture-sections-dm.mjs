// @ts-nocheck
/* eslint-disable */
/** Capture Phase-5 sections in DARK (desktop) + MOBILE only — companion to
 * capture-sections.mjs (which does light + the CSP scan). Split out so a single
 * heavy goto timeout cannot lose the light evidence. Run against `next start`. */
const playwrightUrl =
  process.argv[3] ??
  new URL(
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
const png = (n) => join(OUT, n);
const SECTIONS = ['fleet', 'how-it-works', 'gallery', 'locations', 'testimonials'];

const browser = await chromium.launch();

async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const vh = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y < height; y += Math.floor(vh * 0.6)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function captureSections(page, suffix) {
  for (const id of SECTIONS) {
    const geom = await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, height: el.offsetHeight };
    }, id);
    if (!geom) continue;
    const vh = await page.evaluate(() => window.innerHeight);
    const slices = Math.min(3, Math.max(1, Math.ceil(geom.height / vh)));
    for (let s = 0; s < slices; s++) {
      await page.evaluate((y) => window.scrollTo(0, y), geom.top + s * vh);
      await page.waitForTimeout(450);
      await page.screenshot({
        path: png(`section-${id}-${suffix}${slices > 1 ? `-${s + 1}` : ''}.png`),
        animations: 'disabled',
      });
    }
  }
}

// dark desktop — the proven theme-capture pattern (PASS C): persist
// localStorage.theme + RELOAD + waitForFunction on the `dark` class (next-themes
// with enableSystem otherwise resolves to the system/light default on first
// paint before applying the stored theme). next-themes has `enableSystem`, so
// the emulated `colorScheme: 'dark'` is what actually drives the dark class on
// first paint (a stored `theme` alone is ignored on the initial render under
// enableSystem) — so we emulate dark AND persist the explicit theme.
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); } catch {}
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => document.documentElement.classList.contains('dark'),
    { timeout: 15000 },
  );
  await page.waitForTimeout(1000);
  await scrollThrough(page);
  await captureSections(page, 'dark');
  await ctx.close();
}

// mobile (light)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await scrollThrough(page);
  await captureSections(page, 'mobile');
  await ctx.close();
}

await browser.close();
console.log('Dark + mobile section screenshots written to scripts/.screenshots/');
