// @ts-nocheck
/**
 * verify-preview-stills.mjs — production-build verification for the atrium v2
 * per-bay PREVIEW STILL enrichment (Task 4.5). Drives the BUILT + SERVED app
 * (next start on :3080), headless chromium. Asserts the brief's hard checks:
 *
 *   - 7 pin-spacers desktop (the bays did not regress);
 *   - 0 CSP violations, 0 console errors, 0 page errors, 0 non-favicon request
 *     failures (watch for any 404 on the new stills);
 *   - the LCP element is STILL the hero wordmark (the still is NEVER the LCP);
 *   - all six stills load (naturalWidth > 0) and are lazy (loading="lazy");
 *   - reduced motion: 0 pin-spacers, all six titles resolved, AND the six stills
 *     are present + visible (static, nothing motion-gated away);
 *   - 320px: zero horizontal overflow.
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';

async function attachDiagnostics(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error') bag.console.push(m.text());
  });
  page.on('pageerror', (e) => bag.pageerror.push(String(e)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.endsWith('favicon.ico')) bag.reqfailed.push(`${u} ${r.failure()?.errorText ?? ''}`);
  });
  // Track any non-2xx/3xx response (a 404 on a still would surface here).
  page.on('response', (res) => {
    if (res.status() >= 400) bag.badstatus.push(`${res.status()} ${res.url()}`);
  });
  // One combined init script, AWAITED (an un-awaited addInitScript can race the
  // navigation and never register — the CSP + LCP observers share one script).
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} :: ${e.blockedURI}`);
    });
    // Record the LCP via the PerformanceObserver. The `url` + `size` are always
    // present; `element` is sometimes omitted for a TEXT LCP in headless. An
    // IMAGE LCP (a still) ALWAYS carries a non-empty `url` — that is the reliable
    // discriminator we assert on.
    window.__lcp = null;
    try {
      const po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          const el = last.element || null;
          window.__lcp = {
            url: last.url || '',
            size: last.size || 0,
            tag: el ? el.tagName : '(text LCP, no element ref in headless)',
            text: el ? (el.textContent || '').trim().slice(0, 40) : '',
            isStill: el ? !!el.closest('[data-preview-still]') : false,
            isImg: (last.url || '').length > 0 || (el ? el.tagName === 'IMG' : false),
          };
        }
      });
      po.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });
}

async function run() {
  const browser = await chromium.launch();
  let failures = 0;

  // 1 — Desktop, no-preference: 7 pins, no errors/404s, LCP is the hero, stills load + lazy.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const bag = { console: [], pageerror: [], reqfailed: [], badstatus: [] };
    await attachDiagnostics(page, bag);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    // Capture the LCP BEFORE scrolling (the hero is the above-the-fold element).
    // Re-query the buffered LCP entries directly here too, in case the init-script
    // observer's `element` was not populated on the first batch.
    // Poll for the LCP entry (the observer can deliver after a beat). A small
    // synthetic scroll-nudge + interaction also finalises LCP in Chromium.
    await page.mouse.move(700, 400);
    const lcp = await page.evaluate(async () => {
      for (let i = 0; i < 40; i += 1) {
        if (window.__lcp) return window.__lcp;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Final fallback: read buffered entries directly.
      const entries = performance.getEntriesByType('largest-contentful-paint');
      const last = entries[entries.length - 1];
      if (last) {
        const el = last.element || null;
        return { url: last.url || '', tag: el ? el.tagName : '(text)', isImg: (last.url || '').length > 0, isStill: el ? !!el.closest('[data-preview-still]') : false };
      }
      return { note: 'no LCP entry observed', isImg: true };
    });

    // Gentle full scroll so every pin attaches + every lazy still enters view.
    await page.evaluate(async () => {
      const h = document.body.scrollHeight; const steps = 70;
      for (let i = 1; i <= steps; i += 1) { window.scrollTo(0, (h * i) / steps); await new Promise((r) => requestAnimationFrame(() => r())); }
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    const pins = await page.evaluate(() => document.querySelectorAll('.pin-spacer').length);
    const csp = await page.evaluate(() => window.__csp || []);
    // The VISIBLE still per bay (the dark one in dark theme) must have loaded.
    const stills = await page.evaluate(() => {
      const figs = Array.from(document.querySelectorAll('[data-preview-still]'));
      return figs.map((f) => {
        const img = f.querySelector('[data-preview-still-dark]');
        return {
          loaded: img ? img.naturalWidth > 0 : false,
          lazy: img ? img.getAttribute('loading') === 'lazy' : false,
        };
      });
    });
    const allLoaded = stills.length === 6 && stills.every((s) => s.loaded);
    const allLazy = stills.length === 6 && stills.every((s) => s.lazy);
    const lcpIsHero = !lcp.isStill && !lcp.isImg;

    console.log('DESKTOP no-preference:');
    console.log('  pin-spacers:', pins, pins === 7 ? 'OK' : 'FAIL (expected 7)');
    console.log('  CSP violations:', csp.length, csp.length === 0 ? 'OK' : JSON.stringify(csp));
    console.log('  console errors:', bag.console.length, bag.console.length === 0 ? 'OK' : JSON.stringify(bag.console));
    console.log('  page errors:', bag.pageerror.length, bag.pageerror.length === 0 ? 'OK' : JSON.stringify(bag.pageerror));
    console.log('  req failed (non-favicon):', bag.reqfailed.length, JSON.stringify(bag.reqfailed));
    console.log('  bad HTTP status (>=400):', bag.badstatus.length, JSON.stringify(bag.badstatus));
    console.log('  stills present:', stills.length, '(all loaded:', allLoaded, '· all lazy:', allLazy, ')');
    console.log('  LCP element:', JSON.stringify(lcp), lcpIsHero ? 'OK (hero, not a still/img)' : 'FAIL (LCP is a still/img!)');

    if (pins !== 7) failures += 1;
    if (csp.length) failures += 1;
    if (bag.console.length) failures += 1;
    if (bag.pageerror.length) failures += 1;
    if (bag.reqfailed.length) failures += 1;
    if (bag.badstatus.length) failures += 1;
    if (!allLoaded) failures += 1;
    if (!allLazy) failures += 1;
    if (!lcpIsHero) failures += 1;
    await ctx.close();
  }

  // 2 — Light theme: the LIGHT stills are the visible ones + loaded; no errors.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', colorScheme: 'light',
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch {} });
    const page = await ctx.newPage();
    const bag = { console: [], pageerror: [], reqfailed: [], badstatus: [] };
    await attachDiagnostics(page, bag);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await page.evaluate(async () => {
      const h = document.body.scrollHeight; const steps = 70;
      for (let i = 1; i <= steps; i += 1) { window.scrollTo(0, (h * i) / steps); await new Promise((r) => requestAnimationFrame(() => r())); }
    });
    await page.waitForTimeout(1000);
    const lightStills = await page.evaluate(() => {
      const figs = Array.from(document.querySelectorAll('[data-preview-still]'));
      return figs.map((f) => {
        const img = f.querySelector('[data-preview-still-light]');
        const cs = img ? getComputedStyle(img) : null;
        return { loaded: img ? img.naturalWidth > 0 : false, shown: cs ? cs.display !== 'none' : false };
      });
    });
    const ok = lightStills.length === 6 && lightStills.every((s) => s.loaded && s.shown);
    console.log('LIGHT theme:');
    console.log('  light stills loaded + shown:', ok ? 'OK' : 'FAIL', JSON.stringify(lightStills));
    console.log('  CSP violations:', (await page.evaluate(() => window.__csp || [])).length);
    console.log('  bad HTTP status:', bag.badstatus.length, JSON.stringify(bag.badstatus));
    if (!ok) failures += 1;
    if (bag.badstatus.length) failures += 1;
    await ctx.close();
  }

  // 3 — Reduced motion: 0 pins, titles resolved, stills present + visible (static).
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const bag = { console: [], pageerror: [], reqfailed: [], badstatus: [] };
    await attachDiagnostics(page, bag);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await page.evaluate(async () => {
      const h = document.body.scrollHeight; const steps = 50;
      for (let i = 1; i <= steps; i += 1) { window.scrollTo(0, (h * i) / steps); await new Promise((r) => requestAnimationFrame(() => r())); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(800);
    const pins = await page.evaluate(() => document.querySelectorAll('.pin-spacer').length);
    const titles = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-bay-title-final]')).map((el) => {
        const cs = getComputedStyle(el);
        return { visible: cs.visibility, opacity: cs.opacity, clip: cs.clipPath };
      }));
    const allResolved = titles.length === 6 && titles.every((t) => t.visible !== 'hidden' && Number(t.opacity) > 0.9 && (t.clip === 'none' || !t.clip.includes('100%')));
    const stillsVisible = await page.evaluate(() => {
      const figs = Array.from(document.querySelectorAll('[data-preview-still]'));
      return figs.map((f) => {
        const fcs = getComputedStyle(f);
        const img = f.querySelector('[data-preview-still-dark]');
        return { figOpacity: fcs.opacity, figVisible: fcs.visibility, imgLoaded: img ? img.naturalWidth > 0 : false };
      });
    });
    const stillsOk = stillsVisible.length === 6 && stillsVisible.every((s) => s.figVisible !== 'hidden' && Number(s.figOpacity) > 0.9 && s.imgLoaded);
    console.log('REDUCED MOTION:');
    console.log('  pin-spacers:', pins, pins === 0 ? 'OK' : 'FAIL (expected 0)');
    console.log('  bay titles all resolved:', allResolved ? 'OK' : 'FAIL', JSON.stringify(titles));
    console.log('  stills present + visible + loaded (static):', stillsOk ? 'OK' : 'FAIL', JSON.stringify(stillsVisible));
    console.log('  CSP violations:', (await page.evaluate(() => window.__csp || [])).length);
    if (pins !== 0) failures += 1;
    if (!allResolved) failures += 1;
    if (!stillsOk) failures += 1;
    await ctx.close();
  }

  // 4 — 320px: zero horizontal overflow (the stills must not break the mobile stack).
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 720 }, reducedMotion: 'no-preference', colorScheme: 'dark', isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.evaluate(async () => {
      const h = document.body.scrollHeight; const steps = 40;
      for (let i = 1; i <= steps; i += 1) { window.scrollTo(0, (h * i) / steps); await new Promise((r) => requestAnimationFrame(() => r())); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
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
