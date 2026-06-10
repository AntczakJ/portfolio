// @ts-nocheck
// Production-build verification for the polish pass: pin count, CSP violations,
// console/page errors, reduced-motion composed frame, 320px overflow. Drives the
// BUILT + SERVED app (next start on :3080), headless chromium.
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';

function attachDiagnostics(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error') bag.console.push(m.text());
  });
  page.on('pageerror', (e) => bag.pageerror.push(String(e)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.endsWith('favicon.ico')) bag.reqfailed.push(`${u} ${r.failure()?.errorText ?? ''}`);
  });
  // CSP violations are reported via the SecurityPolicyViolation event.
  page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} :: ${e.blockedURI}`);
    });
  });
}

async function run() {
  const browser = await chromium.launch();
  let failures = 0;

  // 1 — Desktop, no-preference motion: 7 pin-spacers, zero CSP/console/page errors.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const bag = { console: [], pageerror: [], reqfailed: [] };
    attachDiagnostics(page, bag);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    // gentle full scroll so every pin attaches
    await page.evaluate(async () => {
      const h = document.body.scrollHeight; const steps = 60;
      for (let i = 1; i <= steps; i += 1) { window.scrollTo(0, (h * i) / steps); await new Promise((r) => requestAnimationFrame(() => r())); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(800);
    const pins = await page.evaluate(() => document.querySelectorAll('.pin-spacer').length);
    const csp = await page.evaluate(() => window.__csp || []);
    console.log('DESKTOP no-preference:');
    console.log('  pin-spacers:', pins, pins === 7 ? 'OK' : 'FAIL (expected 7)');
    console.log('  CSP violations:', csp.length, csp.length === 0 ? 'OK' : JSON.stringify(csp));
    console.log('  console errors:', bag.console.length, bag.console.length === 0 ? 'OK' : JSON.stringify(bag.console));
    console.log('  page errors:', bag.pageerror.length, bag.pageerror.length === 0 ? 'OK' : JSON.stringify(bag.pageerror));
    console.log('  req failed (non-favicon):', bag.reqfailed.length, JSON.stringify(bag.reqfailed));
    if (pins !== 7) failures += 1;
    if (csp.length) failures += 1;
    if (bag.console.length) failures += 1;
    if (bag.pageerror.length) failures += 1;
    await ctx.close();
  }

  // 2 — Reduced motion: 0 pin-spacers, every bay title resolved/visible, nothing frozen.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const bag = { console: [], pageerror: [], reqfailed: [] };
    attachDiagnostics(page, bag);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const pins = await page.evaluate(() => document.querySelectorAll('.pin-spacer').length);
    const titles = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-bay-title-final]')).map((el) => {
        const cs = getComputedStyle(el);
        return { visible: cs.visibility, opacity: cs.opacity, clip: cs.clipPath };
      }));
    const allResolved = titles.every((t) => t.visible !== 'hidden' && Number(t.opacity) > 0.9 && (t.clip === 'none' || !t.clip.includes('100%')));
    const csp = await page.evaluate(() => window.__csp || []);
    console.log('REDUCED MOTION:');
    console.log('  pin-spacers:', pins, pins === 0 ? 'OK' : 'FAIL (expected 0)');
    console.log('  bay titles all resolved:', allResolved ? 'OK' : 'FAIL', JSON.stringify(titles));
    console.log('  CSP violations:', csp.length);
    if (pins !== 0) failures += 1;
    if (!allResolved) failures += 1;
    await ctx.close();
  }

  // 3 — 320px: zero horizontal overflow.
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 720 }, reducedMotion: 'no-preference', colorScheme: 'dark', isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    const ok = overflow.scrollW <= overflow.clientW + 1;
    console.log('320px:');
    console.log('  scrollW/clientW:', overflow.scrollW, '/', overflow.clientW, ok ? 'OK (no overflow)' : 'FAIL (overflow)');
    if (!ok) failures += 1;
    await ctx.close();
  }

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
