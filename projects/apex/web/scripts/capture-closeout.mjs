// @ts-nocheck
/* eslint-disable */
/**
 * capture-closeout.mjs — the designer-critic close-out capture pass.
 *
 * Re-captures the surfaces the close-out polish changed (graphite default + the
 * real glass split + re-tinted wheels + consistent fleet crops) AND the
 * previously-missing responsive range (320 / 1440 / 2560) + a reduced-motion
 * configurator frame, into web/scripts/.screenshots/.
 *
 * Run against an already-running `next start` (default 3091):
 *   node scripts/capture-closeout.mjs [port]
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pwUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(pwUrl);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.screenshots');
const PORT = process.argv[2] ?? '3091';
const BASE = `http://localhost:${PORT}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.remove('light', 'dark');
    r.classList.add(t);
  }, theme);
  await page.waitForTimeout(400);
}

async function scrollTo(page, sel) {
  await page.evaluate((s) => {
    document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, sel);
  await page.waitForTimeout(500);
}

async function armConfigurator(page) {
  await scrollTo(page, '#configurator');
  try {
    await page.locator('[data-configurator-stage]').first().hover({ timeout: 4000 });
  } catch {}
  await page.waitForSelector('#configurator canvas', { state: 'attached', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  console.log('  ' + name);
}

// 1) Hero — light + dark (graphite default), full viewport above the fold.
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await page.goto(BASE, { waitUntil: 'load' });
  await setTheme(page, theme);
  await page.waitForTimeout(700);
  await shot(page, `closeout-hero-${theme}.png`);
  await page.close();
}

// 2) Hero mobile (320 + 390).
for (const [w, h, label] of [[320, 690, '320'], [390, 844, '390']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await shot(page, `closeout-hero-mobile-${label}.png`);
  await page.close();
}

// 3) Configurator default (graphite/aero) + a swap (voltaic/forged) — light + dark.
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
  await page.goto(BASE, { waitUntil: 'load' });
  await setTheme(page, theme);
  await armConfigurator(page);
  await scrollTo(page, '#configurator');
  await page.waitForTimeout(400);
  await shot(page, `closeout-configurator-${theme}-default.png`);
  // swap to voltaic + forged
  await page.evaluate(() => {
    document.querySelector('input[name="apex-color"][value="col-voltaic"]')?.click();
    document.querySelector('input[name="apex-wheel"][value="whl-forged"]')?.click();
  });
  await page.waitForTimeout(900);
  await shot(page, `closeout-configurator-${theme}-voltaic-forged.png`);
  await page.close();
}

// 4) Configurator reduced-motion frame.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(BASE, { waitUntil: 'load' });
  await armConfigurator(page);
  await scrollTo(page, '#configurator');
  await page.waitForTimeout(500);
  await shot(page, `closeout-configurator-reduced-motion.png`);
  await page.close();
}

// A viewport screenshot after scrolling a section to the top (no full-page /
// element stability wait, which stalls on lazy imagery + GSAP reveals).
async function shotSection(page, sel, name) {
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start', behavior: 'instant' }), sel);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(OUT, name) }); // viewport-only (default)
  console.log('  ' + name);
}

// 5) Fleet section — light + dark (the one studio line-up).
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 1, colorScheme: theme });
  await page.goto(BASE, { waitUntil: 'load' });
  await setTheme(page, theme);
  await shotSection(page, '#fleet', `closeout-fleet-${theme}.png`);
  await page.close();
}

// 6) Gallery section — light (all four frames graphite/midnight now). Use
//    reduced-motion so the GSAP clip-path/parallax resolves static (the animated
//    clip-path layer otherwise produces an uncapturable surface), and capture
//    the first frame's image element directly.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(BASE, { waitUntil: 'load' });
  // Neutralise the parallax inner-scale transforms (which create oversized
  // composited layers Chromium cannot snapshot at some scroll offsets), then
  // capture the gallery heading + the first two frames.
  await page.addStyleTag({ content: '[data-frame-img]{transform:none !important;scale:1 !important;}' });
  await page.evaluate(() => document.querySelector('#gallery')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForTimeout(1400);
  try {
    await page.screenshot({ path: join(OUT, 'closeout-gallery-light.png') });
  } catch {
    // Fall back to the first gallery frame element if the viewport snapshot is
    // rejected.
    await page.locator('[data-frame-mask]').first().screenshot({ path: join(OUT, 'closeout-gallery-light.png') });
  }
  console.log('  closeout-gallery-light.png');
  await page.close();
}

// 7) Confirmation (graphite default config render) — drive the wizard quickly via
//    a deep link + programmatic completion is complex; instead capture the
//    /reserve confirmation by replaying the happy path is out of scope here, so
//    we capture the fleet step-1 grid (the wizard line-up) which reflects the
//    fleet renders. The confirmation render is verified present by verify-reserve.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/reserve?vehicle=lumen-gt&color=col-graphite&wheels=whl-aero`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await shot(page, 'closeout-reserve-step1.png');
  await page.close();
}

// 8) Responsive widths: 320 / 1440 / 2560 full home (top fold).
for (const [w, h, label] of [[320, 690, '320'], [1440, 900, '1440'], [2560, 1280, '2560']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await shot(page, `closeout-home-${label}.png`);
  await page.close();
}

await browser.close();
console.log('\nDone — close-out screenshots in scripts/.screenshots/');
