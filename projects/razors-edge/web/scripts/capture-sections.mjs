// @ts-nocheck
/* eslint-disable */
/**
 * Headless capture + CSP verification of the Phase 4a homepage sections
 * under the PRODUCTION build + CSP (the meld lesson: never test CSP under
 * `next dev`).
 *
 * Captures full-page + per-section frames (desktop + mobile + one light-
 * theme full page) and the gallery horizontal-scroll behaviour, while
 * listening for ANY CSP violation / console error / page error so GSAP +
 * the sections are proven CSP-clean. Outputs land in `web/.review/`.
 *
 * Run from a workspace that has chromium (e.g. meld's e2e):
 *   OUT_DIR=.../web/.review BASE_URL=http://localhost:3070 node <copy>
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ?? join(here, '..', '.review');
const BASE = process.env.BASE_URL ?? 'http://localhost:3070';

const violations = [];
const consoleErrors = [];
const pageErrors = [];

function attach(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`));
  page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} :: ${e.blockedURI}`);
    });
  });
}
async function pull(page, label) {
  const v = await page.evaluate(() => window.__csp ?? []);
  v.forEach((x) => violations.push(`[${label}] ${x}`));
}

/** Scroll a section into view by id and settle the reveal/scrub. */
async function toSection(page, id, block = 'start') {
  await page.evaluate(
    ([sid, b]) => {
      const el = document.getElementById(sid);
      if (el) el.scrollIntoView({ block: b, behavior: 'instant' });
    },
    [id, block],
  );
  await page.waitForTimeout(700);
}

async function shotSection(page, id, name, block = 'start') {
  const el = page.locator(`#${id}`);
  await toSection(page, id, block);
  if (await el.count()) {
    await el.first().screenshot({ path: join(OUT, name) }).catch(async () => {
      await page.screenshot({ path: join(OUT, name) });
    });
  } else {
    await page.screenshot({ path: join(OUT, name) });
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---- Desktop sections (1440) ----------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'desktop');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    await shotSection(page, 'intro', 'sec-intro.png', 'center');
    await shotSection(page, 'services', 'sec-services.png');
    // Gallery: capture the pinned strip at a couple of scrub progresses.
    await shotSection(page, 'gallery', 'sec-gallery-01.png');
    // nudge the scroll forward inside the pin to advance the horizontal track
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'sec-gallery-02.png') });
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.4));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'sec-gallery-03.png') });

    await shotSection(page, 'barbers', 'sec-barbers.png');
    await page.evaluate(() => {
      const el = document.querySelector('[aria-labelledby="testimonials-heading"]');
      if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, 'sec-testimonials.png') });
    await shotSection(page, 'visit', 'sec-visit.png');

    await pull(page, 'desktop');

    const stCount = await page.evaluate(() =>
      window.ScrollTrigger ? window.ScrollTrigger.getAll().length : 'n/a',
    );
    console.log('ScrollTrigger count (desktop):', stCount);
    await ctx.close();
  }

  // ---- Desktop FULL PAGE (stitched) -----------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce', // reduced so the gallery is the vertical stack
    });
    const page = await ctx.newPage();
    attach(page, 'fullpage');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    // Walk the page to trigger all reveals/lazy images, then full-page shot.
    for (let f = 0; f <= 1; f += 0.1) {
      await page.evaluate((ff) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.round(max * ff));
      }, f);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, 'fullpage-desktop.png'), fullPage: true });
    await pull(page, 'fullpage');
    await ctx.close();
  }

  // ---- LIGHT theme full page ------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript(() => {
      try {
        window.localStorage.setItem('theme', 'light');
      } catch {}
    });
    const page = await ctx.newPage();
    attach(page, 'light');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    for (let f = 0; f <= 1; f += 0.1) {
      await page.evaluate((ff) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.round(max * ff));
      }, f);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, 'fullpage-light.png'), fullPage: true });
    // A couple of light section frames too.
    await shotSection(page, 'services', 'light-sec-services.png');
    await shotSection(page, 'barbers', 'light-sec-barbers.png');
    await shotSection(page, 'visit', 'light-sec-visit.png');
    await pull(page, 'light');
    await ctx.close();
  }

  // ---- Mobile sections (iPhone 12) ------------------------------------
  {
    const ctx = await browser.newContext({
      ...devices['iPhone 12'],
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'mobile');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await shotSection(page, 'services', 'mob-services.png');
    await shotSection(page, 'gallery', 'mob-gallery.png');
    await shotSection(page, 'barbers', 'mob-barbers.png');
    await shotSection(page, 'visit', 'mob-visit.png');
    // Full mobile page.
    for (let f = 0; f <= 1; f += 0.12) {
      await page.evaluate((ff) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.round(max * ff));
      }, f);
      await page.waitForTimeout(220);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'fullpage-mobile.png'), fullPage: true });
    await pull(page, 'mobile');
    await ctx.close();
  }

  // ---- 320px narrow sanity --------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 720 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'w320');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await shotSection(page, 'services', 'w320-services.png');
    await shotSection(page, 'barbers', 'w320-barbers.png');
    await pull(page, 'w320');
    await ctx.close();
  }

  // ---- /book deep-link stub -------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    attach(page, 'book');
    await page.goto(`${BASE}/book?service=svc-cut-and-beard&barber=brb-marco`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'book-stub.png') });
    await pull(page, 'book');
    await ctx.close();
  }

  await browser.close();

  console.log('\n================ SECTIONS CAPTURE SUMMARY ================');
  console.log('Output dir:', OUT);
  console.log('CSP violations:', violations.length);
  violations.forEach((v) => console.log('  CSP!', v));
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.slice(0, 30).forEach((e) => console.log('  ERR', e));
  console.log('Page errors:', pageErrors.length);
  pageErrors.slice(0, 30).forEach((e) => console.log('  PAGEERR', e));
  const clean =
    violations.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
  console.log(clean ? '\nRESULT: CLEAN' : '\nRESULT: ISSUES FOUND');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
