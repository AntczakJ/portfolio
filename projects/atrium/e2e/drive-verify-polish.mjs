// @ts-nocheck
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
// AFTER the polish pass (frontend-engineer 2026-06-10): the original designer-
// critic BEFORE shots lived in `critique-polish-shots/` (never committed). The
// post-fix comparison set is written to `verify-polish-shots/`. Override with
// OUT_DIR / BASE_URL env vars to re-shoot elsewhere.
const OUT_DIR = process.env.OUT_DIR ?? join(__dirname, '..', 'docs', 'verify-polish-shots');
const BASE_URL = process.env.BASE_URL ?? 'https://atrium-demo.fly.dev';
mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const BAYS = ['tape', 'meld', 'razors-edge', 'pulse', 'apex', 'atlas'];

const diag = [];
function attach(page, label) {
  const bag = { label, console: [], pageerror: [], csp: [], reqfailed: [] };
  page.on("console", (m) => { if (m.type() === "error") bag.console.push(m.text()); });
  page.on("pageerror", (e) => bag.pageerror.push(String(e)));
  page.on("requestfailed", (r) => { const u = r.url(); if (!u.endsWith("favicon.ico")) bag.reqfailed.push(u); });
  page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => { window.__csp.push(e.violatedDirective + " :: " + e.blockedURI); }); });
  diag.push(bag); return bag;
}
async function collectCsp(page, bag) { try { bag.csp = await page.evaluate(() => window.__csp || []); } catch (e) {} }

async function seedTheme(context, theme) {
  await context.addInitScript((t) => { try { window.localStorage.setItem('theme', t); } catch {} }, theme);
}
async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', name);
}
async function ready(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 60000 });
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
  const bag = attach(page, `desktop-${theme}`);
  console.log(`Desktop ${theme}`);
  bag.pins = await ready(page);
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
  await collectCsp(page, bag);
  await context.close();
}

async function mobileRun(browser, theme) {
  const context = await browser.newContext({
    viewport: MOBILE, deviceScaleFactor: 2, colorScheme: theme, isMobile: true, hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await seedTheme(context, theme);
  const page = await context.newPage();
  const bag = attach(page, `mobile-${theme}`);
  console.log(`Mobile ${theme}`);
  bag.pins = await ready(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await shot(page, `08-m-hero-${theme}`);
  for (const slug of ['tape', 'pulse', 'apex', 'atlas']) {
    await scrollToId(page, `bay-${slug}`, 0.1);
    await shot(page, `09-m-bay-${slug}-${theme}`);
  }
  await scrollToId(page, 'directory');
  await shot(page, `10-m-directory-${theme}`);
  await collectCsp(page, bag);
  await context.close();
}

async function reducedMotionCheck(browser) {
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce", colorScheme: "dark" });
  const page = await context.newPage();
  const bag = attach(page, "reduced-motion");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2200);
  bag.pins = await page.evaluate(() => document.querySelectorAll(".pin-spacer").length);
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll("[data-bay-title-final]")).map((el) => { const cs = getComputedStyle(el); return { v: cs.visibility, o: cs.opacity, c: cs.clipPath }; }));
  bag.titleCount = titles.length;
  bag.allResolved = titles.length === 6 && titles.every((t) => t.v !== "hidden" && Number(t.o) > 0.9 && (t.c === "none" || !t.c.includes("100%")));
  console.log("reduced-motion pins=" + bag.pins + " titles=" + titles.length + " allResolved=" + bag.allResolved);
  await shot(page, "11-reduced-motion-dark");
  await collectCsp(page, bag);
  await context.close();
}

async function overflow320(browser) {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, reducedMotion: "no-preference", colorScheme: "dark", isMobile: true, hasTouch: true });
  await seedTheme(context, "dark");
  const page = await context.newPage();
  const bag = attach(page, "320px");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  bag.overflow = m; bag.overflowOk = m.sw <= m.cw + 1;
  console.log("320px sw=" + m.sw + " cw=" + m.cw + " ok=" + bag.overflowOk);
  await shot(page, "12-320-hero-dark");
  await scrollToId(page, "bay-tape", 0.3);
  await shot(page, "12-320-bay-tape-dark");
  await collectCsp(page, bag);
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  await desktopRun(browser, 'dark');
  await desktopRun(browser, 'light');
  await mobileRun(browser, 'dark');
  await mobileRun(browser, 'light');
  await reducedMotionCheck(browser);
  await overflow320(browser);
  await browser.close();
  console.log("=== DIAGNOSTICS SUMMARY ===");
  for (const b of diag) {
    console.log("[" + b.label + "] pins=" + (b.pins != null ? b.pins : "-") + " csp=" + (b.csp || []).length + " console=" + b.console.length + " pageerror=" + b.pageerror.length + " reqfailed=" + b.reqfailed.length);
    if (b.csp && b.csp.length) console.log("   CSP:", JSON.stringify(b.csp));
    if (b.console.length) console.log("   CONSOLE:", JSON.stringify(b.console.slice(0,5)));
    if (b.pageerror.length) console.log("   PAGEERR:", JSON.stringify(b.pageerror.slice(0,5)));
    if (b.reqfailed.length) console.log("   REQFAIL:", JSON.stringify(b.reqfailed.slice(0,5)));
    if (b.label === "reduced-motion") console.log("   rm allResolved=" + b.allResolved + " titleCount=" + b.titleCount);
    if (b.label === "320px") console.log("   320 overflowOk=" + b.overflowOk, JSON.stringify(b.overflow));
  }
  console.log('Done ->', OUT_DIR);
}
main().catch((e) => { console.error(e); process.exit(1); });
