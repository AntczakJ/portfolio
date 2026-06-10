// @ts-nocheck
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
// AFTER the polish pass (frontend-engineer 2026-06-10): the original designer-
// critic BEFORE shots lived in `critique-polish-shots/` (never committed). The
// post-fix comparison set is written to `critique-polish-after/`. Override with
// OUT_DIR / BASE_URL env vars to re-shoot elsewhere.
const OUT_DIR = process.env.OUT_DIR ?? join(__dirname, '..', 'docs', 'critique-polish-after');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';
mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const BAYS = ['tape', 'meld', 'razors-edge', 'pulse', 'apex', 'atlas'];

async function seedTheme(context, theme) {
  await context.addInitScript((t) => { try { window.localStorage.setItem('theme', t); } catch {} }, theme);
}
async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', name);
}
async function ready(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const pins = await page.evaluate(() => document.querySelectorAll('.pin-spacer').length);
  console.log('  pin-spacers:', pins);
  return pins;
}
async function scrubScrollY(page, y) {
  await page.evaluate(async (target) => {
    const steps = 24; const start = window.scrollY;
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, Math.round(start + ((target - start) * i) / steps));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }, y);
  await page.waitForTimeout(450);
}
async function scrollToId(page, id, extraVh = 0) {
  await page.evaluate(async ({ anchor, extra }) => {
    const el = document.getElementById(anchor);
    if (!el) return;
    const targetTop = el.getBoundingClientRect().top + window.scrollY + window.innerHeight * extra;
    const steps = 36; const start = window.scrollY;
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, Math.round(start + ((targetTop - start) * i) / steps));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }, { anchor: id, extra: extraVh });
  await page.waitForTimeout(800);
}

async function desktopRun(browser, theme) {
  const context = await browser.newContext({
    viewport: DESKTOP, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'no-preference',
  });
  await seedTheme(context, theme);
  const page = await context.newPage();
  console.log(`Desktop ${theme}`);
  await ready(page);
  const vh = DESKTOP.height;

  await scrubScrollY(page, 0);
  await shot(page, `01-hero-${theme}`);
  // Descent stops across the hero pin (~1.2vh)
  for (const [i, p] of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].entries()) {
    await scrubScrollY(page, Math.round(vh * 1.2 * p));
    await shot(page, `02-descent-${String(i + 1).padStart(2, '0')}-${theme}`);
  }
  // Each bay: mid-resolve (land on top) then resolved (over-scroll)
  for (const slug of BAYS) {
    await scrollToId(page, `bay-${slug}`, 0.05);
    await shot(page, `03-bay-${slug}-enter-${theme}`);
    await scrollToId(page, `bay-${slug}`, 0.5);
    await shot(page, `04-bay-${slug}-resolved-${theme}`);
  }
  await scrollToId(page, 'directory');
  await shot(page, `05-directory-${theme}`);
  await scrollToId(page, 'about');
  await shot(page, `06-about-${theme}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await shot(page, `07-footer-${theme}`);
  await context.close();
}

async function mobileRun(browser, theme) {
  const context = await browser.newContext({
    viewport: MOBILE, deviceScaleFactor: 2, colorScheme: theme, isMobile: true, hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await seedTheme(context, theme);
  const page = await context.newPage();
  console.log(`Mobile ${theme}`);
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await shot(page, `08-m-hero-${theme}`);
  for (const slug of ['tape', 'pulse', 'apex', 'atlas']) {
    await scrollToId(page, `bay-${slug}`, 0.1);
    await shot(page, `09-m-bay-${slug}-${theme}`);
  }
  await scrollToId(page, 'directory');
  await shot(page, `10-m-directory-${theme}`);
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  await desktopRun(browser, 'dark');
  await desktopRun(browser, 'light');
  await mobileRun(browser, 'dark');
  await mobileRun(browser, 'light');
  await browser.close();
  console.log('Done ->', OUT_DIR);
}
main().catch((e) => { console.error(e); process.exit(1); });
