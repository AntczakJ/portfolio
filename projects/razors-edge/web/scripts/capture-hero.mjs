// @ts-nocheck
/* eslint-disable */
/**
 * Headless capture + verification of the blade-sweep hero under the
 * PRODUCTION build + CSP (the meld lesson: never test CSP under `next dev`).
 *
 * Drives the pinned hero through its scrub at several progresses and saves
 * screenshots, while listening for ANY CSP violation / console error / page
 * error so GSAP is proven CSP-clean. Also captures the reduced-motion path
 * and the no-JS floor. Outputs land in public/.review/ and the script
 * reports every path + a pass/fail summary.
 *
 * Run (from the meld e2e workspace which has chromium installed):
 *   node <this> ; results in projects/razors-edge/web/public/.review/
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
// Scratch capture set for the designer-critic + owner — OUTSIDE public/ so
// it is never served, and .gitignore'd. OUT_DIR env overrides when the
// script is run from another workspace's node_modules (e.g. meld e2e, which
// has chromium installed) so the import of @playwright/test resolves.
const OUT = process.env.OUT_DIR ?? join(here, '..', '.review');
const BASE = process.env.BASE_URL ?? 'http://localhost:3070';

const violations = [];
const consoleErrors = [];
const pageErrors = [];

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`[${label}] ${err.message}`));
  page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(
        `${e.violatedDirective} :: ${e.blockedURI}`,
      );
    });
  });
}

async function pullViolations(page, label) {
  const v = await page.evaluate(() => window.__cspViolations ?? []);
  v.forEach((x) => violations.push(`[${label}] ${x}`));
}

/** Scroll the document to a fraction of the scrollable height and settle. */
async function scrollToFraction(page, frac) {
  await page.evaluate((f) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(max * f));
  }, frac);
  // Let ScrollTrigger's rAF scrub catch up.
  await page.waitForTimeout(700);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---- Desktop, full motion -------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attachListeners(page, 'desktop-full');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900); // hero hydrate + portrait paint

    await page.screenshot({ path: join(OUT, 'hero-01-top.png') });

    // The hero pin maps ~190% scroll; sample a few scrub progresses.
    await scrollToFraction(page, 0.07);
    await page.screenshot({ path: join(OUT, 'hero-02-sweep.png') });

    await scrollToFraction(page, 0.13);
    await page.screenshot({ path: join(OUT, 'hero-03-cut.png') });

    await scrollToFraction(page, 0.2);
    await page.screenshot({ path: join(OUT, 'hero-04-revealed.png') });

    await scrollToFraction(page, 0.32);
    await page.screenshot({ path: join(OUT, 'hero-05-handoff.png') });

    // Full-page tall capture of the chrome + sections.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT, 'page-06-scrolled-header.png'),
    });
    // Scroll near a divider/footer to capture chrome-on-scroll state.
    await scrollToFraction(page, 0.55);
    await page.screenshot({ path: join(OUT, 'page-07-midpage.png') });
    await scrollToFraction(page, 1.0);
    await page.screenshot({ path: join(OUT, 'page-08-footer.png') });

    await pullViolations(page, 'desktop-full');

    // Active ScrollTrigger sanity.
    const stCount = await page.evaluate(() => {
      const ST = window.ScrollTrigger;
      return ST ? ST.getAll().length : 'no-global';
    });
    console.log('ScrollTrigger.getAll().length (global may be undefined):', stCount);

    await ctx.close();
  }

  // ---- Focus state (keyboard) -----------------------------------------
  // Tab through the chrome so the brand focus ring is visible on the nav,
  // the CTA, and the theme toggle (D-12). Capture a representative frame.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attachListeners(page, 'focus');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    // Tab a few times to land focus on a nav link / CTA in the header.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, 'focus-01-nav.png') });
    // A couple more tabs to reach the theme toggle / CTA cluster.
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, 'focus-02-cta.png') });
    await pullViolations(page, 'focus');
    await ctx.close();
  }

  // ---- LIGHT theme hero (D-06) ----------------------------------------
  // Pre-seed next-themes localStorage to 'light' before first paint so the
  // editorial-print register is captured at rest and mid-reveal.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    await ctx.addInitScript(() => {
      try {
        window.localStorage.setItem('theme', 'light');
      } catch {
        /* ignore */
      }
    });
    const page = await ctx.newPage();
    attachListeners(page, 'light');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, 'light-01-top.png') });
    await scrollToFraction(page, 0.2);
    await page.screenshot({ path: join(OUT, 'light-02-revealed.png') });
    // Back to top to capture the light chrome + intro.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await scrollToFraction(page, 0.55);
    await page.screenshot({ path: join(OUT, 'light-03-midpage.png') });
    await pullViolations(page, 'light');
    await ctx.close();
  }

  // ---- Mobile, full motion --------------------------------------------
  {
    const ctx = await browser.newContext({
      ...devices['iPhone 12'],
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attachListeners(page, 'mobile-full');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, 'mobile-01-top.png') });
    await scrollToFraction(page, 0.18);
    await page.screenshot({ path: join(OUT, 'mobile-02-revealed.png') });
    // Open the mobile drawer.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const menuBtn = page.getByRole('button', { name: 'Open menu' });
    if (await menuBtn.count()) {
      await menuBtn.first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, 'mobile-03-drawer.png') });
    }
    await pullViolations(page, 'mobile-full');
    await ctx.close();
  }

  // ---- 320px narrow ---------------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 640 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attachListeners(page, 'w320');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'w320-01-top.png') });
    await pullViolations(page, 'w320');
    await ctx.close();
  }

  // ---- Reduced motion -------------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    attachListeners(page, 'reduced');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, 'reduced-01-top.png') });
    // Under reduced motion there is NO pin — a normal scroll moves the page.
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'reduced-02-scrolled.png') });
    await pullViolations(page, 'reduced');
    await ctx.close();
  }

  // ---- No-JS floor ----------------------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const page = await ctx.newPage();
    attachListeners(page, 'no-js');
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'nojs-01-hero.png') });
    // Confirm the H1 + portrait img are in the served DOM.
    const h1 = await page.locator('h1').first().textContent();
    const imgCount = await page.locator('img').count();
    console.log('no-JS H1 text:', JSON.stringify(h1));
    console.log('no-JS <img> count:', imgCount);
    await ctx.close();
  }

  await browser.close();

  // ---- Report ---------------------------------------------------------
  console.log('\n================ CAPTURE SUMMARY ================');
  console.log('Output dir:', OUT);
  console.log('CSP violations:', violations.length);
  violations.forEach((v) => console.log('  CSP!', v));
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.slice(0, 20).forEach((e) => console.log('  ERR', e));
  console.log('Page errors:', pageErrors.length);
  pageErrors.slice(0, 20).forEach((e) => console.log('  PAGEERR', e));
  const clean =
    violations.length === 0 &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0;
  console.log(clean ? '\nRESULT: CLEAN (zero CSP / console / page errors)' : '\nRESULT: ISSUES FOUND');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
