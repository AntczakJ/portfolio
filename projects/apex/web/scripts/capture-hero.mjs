// @ts-nocheck
/* eslint-disable */
/**
 * Capture hero + chrome screenshots (Task 4.1/4.2) for the designer-critic
 * hand-off, and verify the reduced-motion + no-JS floors render a composed,
 * legible hero. Writes PNGs to scripts/.screenshots/. Run against `next start`.
 */
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

const browser = await chromium.launch();

// 1) Desktop hero — light.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: png('hero-desktop-light.png') });

  // Dark — set the theme the way next-themes does (persist + class) and wait for
  // the dark hero crop to fully decode so the capture proves the night-studio
  // FRAME, not just the dark blur placeholder (P0-NEW-1 evidence).
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  });
  await page.waitForFunction(
    () => {
      const imgs = Array.from(
        document.querySelectorAll('img[src*="hero-desktop-dark"]'),
      );
      return imgs.some((i) => i.complete && i.naturalWidth > 0);
    },
    { timeout: 15000 },
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: png('hero-desktop-dark.png') });
  await page.close();
}

// 2) Mobile header + open menu.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: png('hero-mobile.png') });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: png('mobile-menu.png') });
  await page.close();
}

// 3) Reduced-motion hero floor — must be a composed, legible final frame.
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const h1 = await page.locator('h1', { hasText: 'APEX' }).first().isVisible();
  const img = await page.locator('img[src*="lumen-gt"]').first().isVisible();
  console.log(`reduced-motion: H1 visible=${h1}, hero render visible=${img}`);
  await page.screenshot({ path: png('hero-reduced-motion.png') });
  await page.close();
}

// 4) No-JS floor — disable JS, the hero must still render the composed frame.
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const h1 = await page.locator('h1', { hasText: 'APEX' }).first().isVisible();
  const img = await page.locator('img[src*="lumen-gt"]').first().count();
  const reserve = await page.getByRole('link', { name: 'Reserve a car' }).first().count();
  const canvas = await page.locator('canvas').count();
  console.log(
    `no-JS: H1 visible=${h1}, hero render present=${img > 0}, Reserve link present=${reserve > 0}, canvas count=${canvas}`,
  );
  await page.screenshot({ path: png('hero-no-js.png') });
  await ctx.close();
}

await browser.close();
console.log('Screenshots written to scripts/.screenshots/');
