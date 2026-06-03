// @ts-nocheck
/**
 * capture-gallery-legibility.mjs — gallery overlay-heading legibility capture.
 *
 * Drives the BUILT + SERVED prod app on :3070 (NOT next dev — the strict CSP
 * forbids unsafe-eval) and captures the gallery section's heading overlay
 * ("The work" kicker + "A room, a chair, and the result." h2) over the dark
 * pinned photo strip in BOTH themes on DESKTOP (>=1024, fine pointer, no
 * reduced motion), plus the MOBILE (390px) gallery heading on the page
 * ground, in both themes.
 *
 * Output dir defaults to e2e/.gallery-legibility but can be overridden with
 * OUT_DIR (so before/after runs can write to distinct folders).
 *
 *   node capture-gallery-legibility.mjs
 *   OUT_DIR=.gallery-legibility/after node capture-gallery-legibility.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ARG = process.env.OUT_DIR ?? '.gallery-legibility';
const OUT_DIR = isAbsolute(OUT_ARG) ? OUT_ARG : join(__dirname, OUT_ARG);
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3070';

mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };

async function seedTheme(context, theme) {
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {}
  }, theme);
}

async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', file);
}

/**
 * Scroll into the pinned gallery so the heading overlay is over a photo.
 * The gallery pins when its section top reaches the viewport top; once
 * pinned, scrolling further scrubs the horizontal track. We scroll to the
 * gallery's pin start, then add a little extra so the strip has translated
 * and a real frame sits behind the heading.
 */
async function scrollIntoPinnedGallery(page, extraVh = 0.25) {
  await page.evaluate((extra) => {
    const el = document.querySelector('#gallery');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.round(top + window.innerHeight * extra));
  }, extraVh);
  // Let ScrollTrigger's rAF-driven pin + scrub settle.
  await page.waitForTimeout(700);
}

async function desktopGallery(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: DESKTOP.deviceScaleFactor,
    colorScheme: theme,
  });
  await seedTheme(context, theme);
  const page = await context.newPage();

  console.log(`Desktop ${theme} — gallery overlay heading over photo`);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1100); // let GSAP register + pins settle

  await scrollIntoPinnedGallery(page, 0.18);
  await shot(page, `gallery-desktop-${theme}`);

  // A second frame a little further into the scrub so a different photo is
  // behind the heading — confirms legibility holds over any frame.
  await scrollIntoPinnedGallery(page, 0.45);
  await shot(page, `gallery-desktop-${theme}-scrubbed`);

  await context.close();
}

async function mobileGallery(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: MOBILE.width, height: MOBILE.height },
    deviceScaleFactor: MOBILE.deviceScaleFactor,
    colorScheme: theme,
    isMobile: true,
    hasTouch: true,
  });
  await seedTheme(context, theme);
  const page = await context.newPage();

  console.log(`Mobile ${theme} — gallery heading on page ground`);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    const el = document.querySelector('#gallery');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.round(top - 8));
  });
  await page.waitForTimeout(600);
  await shot(page, `gallery-mobile-${theme}`);

  await context.close();
}

async function run() {
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    await desktopGallery(browser, theme);
  }
  for (const theme of ['dark', 'light']) {
    await mobileGallery(browser, theme);
  }
  await browser.close();
  console.log('\nDone. Screenshots in', OUT_DIR);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
