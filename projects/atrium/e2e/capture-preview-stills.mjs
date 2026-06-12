// @ts-nocheck
/**
 * capture-preview-stills.mjs — fresh frames of resolved bays showing the atrium
 * v2 PREVIEW STILL integrated, in both themes, desktop + mobile. Drives the BUILT
 * + SERVED app (next start on :3080), headless chromium. Frames written to
 * projects/atrium/docs/preview-stills-shots/.
 *
 * Captures 2-3 representative resolved bays per the brief: tape (left layout,
 * cyan), razors-edge (centred-specimen, gold), atlas (centred-specimen, teal),
 * apex (mirrored, indigo) — covering all three bay layouts so the still is shown
 * composing in each.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'preview-stills-shots');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';

mkdirSync(OUT_DIR, { recursive: true });

async function seedTheme(context, theme) {
  await context.addInitScript((t) => {
    try { window.localStorage.setItem('theme', t); } catch {}
  }, theme);
}

async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', file);
}

async function scrollToId(page, id, extraVh = 0) {
  await page.evaluate(
    async ({ anchor, extra }) => {
      const el = document.getElementById(anchor);
      if (!el) return;
      const targetTop = el.getBoundingClientRect().top + window.scrollY + window.innerHeight * extra;
      const steps = 30;
      const start = window.scrollY;
      for (let i = 1; i <= steps; i += 1) {
        window.scrollTo(0, Math.round(start + ((targetTop - start) * i) / steps));
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    },
    { anchor: id, extra: extraVh },
  );
  await page.waitForTimeout(850);
}

// Desktop bays — over-scroll into each pin so the bay is fully resolved.
const DESKTOP_BAYS = [
  ['bay-tape', 0.45, 'tape'],          // left layout, cyan
  ['bay-apex', 0.45, 'apex'],          // mirrored layout, indigo
  ['bay-razors-edge', 0.45, 'razors-edge'], // centred specimen, gold
  ['bay-atlas', 0.45, 'atlas'],        // centred specimen, teal
];

async function run() {
  const browser = await chromium.launch();

  for (const [theme, scheme] of [['dark', 'dark'], ['light', 'light']]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme,
    });
    await seedTheme(ctx, theme);
    const page = await ctx.newPage();
    console.log(`Desktop ${theme} — resolved bays with preview still`);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    for (const [id, extra, slug] of DESKTOP_BAYS) {
      await scrollToId(page, id, extra);
      await shot(page, `bay-${slug}-${theme}`);
    }
    await ctx.close();
  }

  // Mobile (390x844) — unpinned stack; the still degrades to a smaller plate.
  for (const [theme, scheme] of [['dark', 'dark'], ['light', 'light']]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme,
      isMobile: true, hasTouch: true,
    });
    await seedTheme(ctx, theme);
    const page = await ctx.newPage();
    console.log(`Mobile ${theme} — resolved bay with preview still`);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    await scrollToId(page, 'bay-tape', 0.1);
    await shot(page, `m-bay-tape-${theme}`);
    await scrollToId(page, 'bay-apex', 0.1);
    await shot(page, `m-bay-apex-${theme}`);
    await ctx.close();
  }

  // 320px — narrowest stack, confirm the still does not overflow.
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 720 }, deviceScaleFactor: 2, colorScheme: 'dark',
      isMobile: true, hasTouch: true,
    });
    await seedTheme(ctx, 'dark');
    const page = await ctx.newPage();
    console.log('320px dark — still in the narrow stack');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    await scrollToId(page, 'bay-tape', 0.1);
    await shot(page, 'm320-bay-tape-dark');
    await ctx.close();
  }

  await browser.close();
  console.log('\nDone. Frames in', OUT_DIR);
}

run().catch((err) => { console.error(err); process.exit(1); });
