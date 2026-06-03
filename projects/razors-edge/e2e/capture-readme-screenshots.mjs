// @ts-nocheck
/**
 * capture-readme-screenshots.mjs — curated README screenshot capture.
 *
 * Drives the BUILT + SERVED prod app on :3070 (NOT next dev — the strict CSP
 * forbids unsafe-eval) and writes a curated, high-quality set into
 * projects/razors-edge/docs/screenshots/ (a COMMITTED location, NOT web/.review
 * which is gitignored).
 *
 * Run pattern (from projects/razors-edge/e2e):
 *   node capture-readme-screenshots.mjs
 *
 * Determinism: the app pins a frozen now (2026-06-10 11:00 Europe/Warsaw), so
 * the date strip, the availability grid, and the booking reference are stable
 * across runs.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3070';
const STORAGE_KEY = 'razors-edge:booking-draft';

mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };

/** Pre-seed the theme so the captured frame is not a flash of the default. */
async function seedTheme(context, theme) {
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {}
  }, theme);
}

async function clearDraft(page) {
  await page.evaluate((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }, STORAGE_KEY);
}

async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', file);
}

/**
 * Scrub the pinned hero to a normalised progress (0..1) and settle.
 * The hero pins ~190vh; mapping progress onto window.scrollY gives a frame.
 */
async function scrubHeroTo(page, progress) {
  await page.evaluate((p) => {
    const pinVh = 1.9; // ~190vh desktop pin (see ADR-004 / blade-hero.tsx)
    const y = Math.round(window.innerHeight * pinVh * p);
    window.scrollTo(0, y);
  }, progress);
  // Give ScrollTrigger's rAF-driven scrub a couple of frames to settle.
  await page.waitForTimeout(450);
}

async function run() {
  const browser = await chromium.launch();

  // ── Desktop, dark ──────────────────────────────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: DESKTOP.deviceScaleFactor,
      colorScheme: 'dark',
    });
    await seedTheme(context, 'dark');
    const page = await context.newPage();

    console.log('Desktop dark — hero + sections');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    // Hero resting frame (the wordmark, intact, brass seam).
    await scrubHeroTo(page, 0);
    await shot(page, 'hero-dark');

    // Hero mid-cut / revealed frame — the wow moment (the lead image).
    await scrubHeroTo(page, 0.62);
    await shot(page, 'hero-mid-cut-dark');

    // Services price list.
    await page.evaluate(() => {
      document.querySelector('#services')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(900);
    await shot(page, 'services-dark');

    // Gallery.
    await page.evaluate(() => {
      document.querySelector('#gallery')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(900);
    await shot(page, 'gallery-dark');

    // Barbers.
    await page.evaluate(() => {
      document.querySelector('#barbers')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(900);
    await shot(page, 'barbers-dark');

    await context.close();
  }

  // ── Desktop, light ─────────────────────────────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: DESKTOP.deviceScaleFactor,
      colorScheme: 'light',
    });
    await seedTheme(context, 'light');
    const page = await context.newPage();

    console.log('Desktop light — hero');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    await scrubHeroTo(page, 0);
    await shot(page, 'hero-light');

    await scrubHeroTo(page, 0.62);
    await shot(page, 'hero-mid-cut-light');

    await context.close();
  }

  // ── Desktop, dark — booking wizard ─────────────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: DESKTOP.deviceScaleFactor,
      colorScheme: 'dark',
    });
    await seedTheme(context, 'dark');
    const page = await context.newPage();

    console.log('Desktop dark — booking wizard');
    await page.goto(`${BASE_URL}/book`, { waitUntil: 'domcontentloaded' });
    await clearDraft(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#wizard-step-heading').waitFor({ state: 'visible' });

    // Step 1: service.
    await page
      .getByRole('radiogroup', { name: 'Choose a service' })
      .getByRole('radio')
      .first()
      .click();

    // Step 2: barber — pick the first concrete barber (index 1, after "Any").
    await page
      .getByRole('radiogroup', { name: 'Choose a barber' })
      .getByRole('radio')
      .nth(1)
      .click();

    // Step 3: date + time availability grid (the most important wizard frame).
    await page
      .getByRole('radiogroup', { name: 'Choose a date' })
      .getByRole('radio')
      .first()
      .click();
    await page.waitForTimeout(700);
    await shot(page, 'wizard-datetime-dark');

    // Select a slot, advance to details, then confirm to reach confirmation.
    await page
      .getByRole('radiogroup', { name: 'Choose a start time' })
      .getByRole('radio')
      .first()
      .click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.locator('#wizard-details-form').waitFor({ state: 'visible' });
    await page.getByLabel('Name').fill('Jan Kowalski');
    await page.getByLabel('Email').fill('jan@example.com');
    await page.getByLabel('Phone').fill('+48 600 100 200');
    await page.getByRole('button', { name: /Confirm booking/i }).click();

    await page
      .getByRole('heading', { name: /You are booked in/i })
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await shot(page, 'wizard-confirmation-dark');

    await context.close();
  }

  // ── Mobile, dark — hero ────────────────────────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: MOBILE.width, height: MOBILE.height },
      deviceScaleFactor: MOBILE.deviceScaleFactor,
      colorScheme: 'dark',
      isMobile: true,
      hasTouch: true,
    });
    await seedTheme(context, 'dark');
    const page = await context.newPage();

    console.log('Mobile dark — hero');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    // Mobile pin is ~150vh.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await shot(page, 'hero-mobile-dark');

    await page.evaluate(() => {
      window.scrollTo(0, Math.round(window.innerHeight * 1.5 * 0.62));
    });
    await page.waitForTimeout(500);
    await shot(page, 'hero-mobile-mid-cut-dark');

    await context.close();
  }

  await browser.close();
  console.log('\nDone. Screenshots in', OUT_DIR);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
