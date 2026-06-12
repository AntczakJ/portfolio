// @ts-nocheck
// Fresh-frame capture for the two craft residuals closed in this pass:
//   1. the kinetic title-resolve clip WIPE (D-15) — several scrub steps across one
//      bay's resolve so the travelling wipe edge is visible frame-to-frame;
//   2. the descent BACK-THIRD camera change (N-01) — the late scrub steps of the
//      hero descent so the strengthened late travel + rising hand-off are visible.
// Both in dark + light. Drives the BUILT + SERVED app (next start :3080), headless
// chromium. Output: docs/craft-residuals-shots/.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'docs', 'craft-residuals-shots');
mkdirSync(OUT, { recursive: true });

const VW = { width: 1440, height: 900 };

// Smoothly scroll to an absolute Y via rAF steps (the ScrollTrigger scrub needs
// real incremental scroll, never a teleport — the Phase-3 lesson).
async function scrollTo(page, y) {
  await page.evaluate(async (target) => {
    const start = window.scrollY;
    const steps = 24;
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, start + ((target - start) * i) / steps);
      // two rAFs per step so the scrub settles
      await new Promise((r) => requestAnimationFrame(() => r()));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }, y);
  await page.waitForTimeout(120);
}

// The geometry of each pin-spacer (absolute document top + height), so we can
// land precise fractional scrub positions inside a pin.
async function pinGeometry(page) {
  return page.evaluate(() => {
    const spacers = Array.from(document.querySelectorAll('.pin-spacer'));
    return spacers.map((s) => {
      const r = s.getBoundingClientRect();
      return { top: r.top + window.scrollY, height: r.height };
    });
  });
}

async function captureTheme(browser, theme) {
  const ctx = await browser.newContext({
    viewport: VW,
    reducedMotion: 'no-preference',
    colorScheme: theme,
  });
  // next-themes reads the persisted choice (attribute="class", defaultTheme dark),
  // so the OS colorScheme alone does not flip the class — seed localStorage.theme.
  await ctx.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  // prime all pins by scrolling to the bottom and back so every pin-spacer exists
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let i = 1; i <= 40; i += 1) {
      window.scrollTo(0, (h * i) / 40);
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);

  const pins = await pinGeometry(page);
  // pins[0] = hero descent; pins[1] = bay 1 (tape) resolve.
  const hero = pins[0];
  const bay1 = pins[1];

  // ── 1. TITLE RESOLVE WIPE (bay 1 / tape). The bay pin is +=0.6vh; the title
  //    clip wipe runs over roughly the first ~0.5 of that pin. Sample a tight
  //    ladder across the resolve so the travelling edge is visible frame-to-frame.
  const bayFractions = [0.04, 0.12, 0.2, 0.28, 0.38, 0.5];
  for (let i = 0; i < bayFractions.length; i += 1) {
    const f = bayFractions[i];
    const y = bay1.top + bay1.height * f;
    await scrollTo(page, y);
    const n = String(i + 1).padStart(2, '0');
    await page.screenshot({
      path: resolve(OUT, `title-resolve-${n}-${theme}.png`),
    });
  }

  // ── 2. DESCENT BACK-THIRD (hero). Sample the LATE scrub fractions so the
  //    strengthened late camera travel + the rising hand-off doorway show.
  const heroFractions = [0.6, 0.7, 0.8, 0.9, 0.98];
  for (let i = 0; i < heroFractions.length; i += 1) {
    const f = heroFractions[i];
    const y = hero.top + hero.height * f;
    await scrollTo(page, y);
    const n = String(i + 1).padStart(2, '0');
    await page.screenshot({
      path: resolve(OUT, `descent-backthird-${n}-${theme}.png`),
    });
  }

  await ctx.close();
}

const browser = await chromium.launch();
await captureTheme(browser, 'dark');
await captureTheme(browser, 'light');
await browser.close();
console.log('captured craft-residuals frames →', OUT);
