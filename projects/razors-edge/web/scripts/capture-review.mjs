// @ts-nocheck
/* eslint-disable */
/**
 * Full-site + wizard review capture under the PRODUCTION build + CSP
 * (the meld lesson: never test CSP under `next dev`). Re-captures the brief's
 * required frame set into web/.review/ (overwrite) and reports zero CSP /
 * console / page errors.
 *
 * Required frames:
 *   - hero scrub at 0 / 0.25 / 0.5 / 0.75 / 1 (desktop + mobile + 320px)
 *   - no-JS hero
 *   - barbers section (dark + light)
 *   - wizard barber + datetime steps (desktop + mobile + 320px)
 *   - confirmation
 *   - visit map (dark + light)
 *   - a focus-state shot
 *
 * Run from a workspace with chromium (meld e2e), against next build && next
 * start on :3070:
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`[${label}] ${err.message}`));
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
async function scrollFrac(page, frac) {
  await page.evaluate((f) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(max * f));
  }, frac);
  await page.waitForTimeout(700);
}
// The hero pin maps a fixed scroll distance; translate a scrub progress
// (0..1) into a document scroll fraction empirically (the pin sits in the
// first ~190% of scroll on desktop). These are approximations chosen so the
// five frames land at start / sweep / mid-cut / reveal / hand-off.
const HERO_SCRUB = { 0: 0.0, 0.25: 0.05, 0.5: 0.1, 0.75: 0.16, 1: 0.24 };

async function seedTheme(ctx, theme) {
  await ctx.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {}
  }, theme);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ===== Hero scrub — DESKTOP =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'hero-desktop');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    for (const [p, frac] of Object.entries(HERO_SCRUB)) {
      await scrollFrac(page, frac);
      await page.screenshot({ path: join(OUT, `hero-d-${p}.png`) });
    }
    await pull(page, 'hero-desktop');
    await ctx.close();
  }

  // ===== Hero scrub — MOBILE =====
  {
    const ctx = await browser.newContext({
      ...devices['iPhone 12'],
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'hero-mobile');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    for (const [p, frac] of Object.entries(HERO_SCRUB)) {
      await scrollFrac(page, frac);
      await page.screenshot({ path: join(OUT, `hero-m-${p}.png`) });
    }
    await pull(page, 'hero-mobile');
    await ctx.close();
  }

  // ===== Hero scrub — 320px =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 640 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'hero-320');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    for (const [p, frac] of Object.entries(HERO_SCRUB)) {
      await scrollFrac(page, frac);
      await page.screenshot({ path: join(OUT, `hero-w320-${p}.png`) });
    }
    await pull(page, 'hero-320');
    await ctx.close();
  }

  // ===== No-JS hero =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const page = await ctx.newPage();
    attach(page, 'no-js');
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'nojs-01-hero.png') });
    const h1 = await page.locator('h1').first().textContent();
    console.log('no-JS H1:', JSON.stringify(h1));
    await ctx.close();
  }

  // ===== Focus state =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'focus');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, 'focus-01-nav.png') });
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, 'focus-02-cta.png') });
    await pull(page, 'focus');
    await ctx.close();
  }

  // ===== Barbers section + Visit map — DARK (scroll to each) =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    attach(page, 'sections-dark');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const barbers = page.locator('#barbers');
    if (await barbers.count()) {
      await barbers.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, 'sec-barbers.png') });
    }
    const visit = page.locator('#visit');
    if (await visit.count()) {
      await visit.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, 'sec-visit.png') });
    }
    await pull(page, 'sections-dark');
    await ctx.close();
  }

  // ===== Barbers section + Visit map — LIGHT =====
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: 'no-preference',
    });
    await seedTheme(ctx, 'light');
    const page = await ctx.newPage();
    attach(page, 'sections-light');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const barbers = page.locator('#barbers');
    if (await barbers.count()) {
      await barbers.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, 'light-sec-barbers.png') });
    }
    const visit = page.locator('#visit');
    if (await visit.count()) {
      await visit.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, 'light-sec-visit.png') });
    }
    await pull(page, 'sections-light');
    await ctx.close();
  }

  // ===== Wizard — DESKTOP (barber + datetime + confirmation) =====
  await captureWizard(browser, {
    label: 'wizard-desktop',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    prefix: 'wizard',
  });

  // ===== Wizard — MOBILE =====
  await captureWizard(browser, {
    label: 'wizard-mobile',
    device: devices['iPhone 12'],
    prefix: 'wizard-m',
  });

  // ===== Wizard — 320px =====
  await captureWizard(browser, {
    label: 'wizard-320',
    viewport: { width: 320, height: 640 },
    prefix: 'wizard-w320',
  });

  await browser.close();

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
  console.log(
    clean
      ? '\nRESULT: CLEAN (zero CSP / console / page errors)'
      : '\nRESULT: ISSUES FOUND',
  );
  process.exit(0);
}

/**
 * Drive the wizard: land on the barber step (deep-link a service), capture
 * barber, advance to date-time, pick a date + slot, capture date-time, then
 * fill details + confirm and capture the confirmation.
 */
async function captureWizard(browser, opts) {
  const { label, prefix } = opts;
  const ctxOpts = { reducedMotion: 'no-preference' };
  if (opts.device) Object.assign(ctxOpts, opts.device);
  if (opts.viewport) ctxOpts.viewport = opts.viewport;
  if (opts.deviceScaleFactor) ctxOpts.deviceScaleFactor = opts.deviceScaleFactor;

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  attach(page, label);

  // Deep-link a known service so we land on the barber step. Signature Cut.
  await page.goto(`${BASE}/book?service=svc-signature-cut`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(900);

  // The deep-link advances past service → barber step. Capture barber.
  await page.screenshot({ path: join(OUT, `${prefix}-barber.png`) });

  // Pick the first concrete barber (skip "Any available barber").
  const barberRadios = page.getByRole('radio');
  const n = await barberRadios.count();
  if (n > 1) {
    await barberRadios.nth(1).click();
    await page.waitForTimeout(500);
  }
  // Advance — use whichever Continue is visible (inline on desktop, bar on
  // mobile). Try the bar CTA first, then the inline one.
  await advance(page);
  await page.waitForTimeout(700);

  // Date-time step: pick a FUTURE date (nth 1, never "today") so the grid has
  // no "already passed" slots, then a definitely-available slot.
  const dateRadios = page
    .getByRole('radiogroup', { name: 'Choose a date' })
    .getByRole('radio');
  const dateCount = await dateRadios.count();
  if (dateCount > 1) {
    await dateRadios.nth(1).click();
    await page.waitForTimeout(1000);
  } else if (dateCount === 1) {
    await dateRadios.first().click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: join(OUT, `${prefix}-datetime.png`) });

  const slotRadios = page
    .getByRole('radiogroup', { name: 'Choose a start time' })
    .getByRole('radio');
  const slotCount = await slotRadios.count();
  if (slotCount) {
    // Pick a mid-list available slot (away from any edge disabled slots).
    await slotRadios.nth(Math.min(2, slotCount - 1)).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${prefix}-datetime-selected.png`) });
    await advance(page);
    await page.waitForTimeout(900);

    // Details: fill + confirm (only if we reached the details step).
    const nameField = page.getByLabel('Name');
    if (await nameField.count()) {
      await nameField.fill('Tomasz Antczak');
      await page.getByLabel('Email').fill('tomasz@example.com');
      await page.getByLabel('Phone').fill('+48 600 100 200');
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${prefix}-details.png`) });
      await advance(page, /confirm/i);
      await page.waitForTimeout(1400);
      await page.screenshot({ path: join(OUT, `${prefix}-confirmation.png`) });
    }
  }

  await pull(page, label);
  await ctx.close();
}

/** Click whichever advance control is visible (inline Continue/Confirm or
 * the mobile sticky-bar CTA). Uses a short per-click timeout + force so a
 * disabled slot overlapping the viewport cannot wedge the run. */
async function advance(page, namePattern) {
  const name = namePattern ?? /continue|confirm/i;
  const buttons = page.getByRole('button', { name });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const b = buttons.nth(i);
    const ok =
      (await b.isVisible().catch(() => false)) &&
      (await b.isEnabled().catch(() => false));
    if (ok) {
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 4000 }).catch(() => {});
      return;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
