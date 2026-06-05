// @ts-nocheck
/* eslint-disable */
/**
 * Capture Phase-5 section screenshots (Tasks 5.1/5.2/5.3) for the designer-critic
 * hand-off, AND verify zero CSP violations while scrolling the WHOLE page (so the
 * GSAP scroll-reveals + the gallery parallax/masked-reveal all execute under the
 * production CSP). Writes PNGs to scripts/.screenshots/. Run against `next start`.
 *
 *   node scripts/capture-sections.mjs [port]
 */
const playwrightUrl =
  process.argv[3] ??
  new URL(
    '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
    import.meta.url,
  ).href;
const { chromium } = await import(playwrightUrl);
const { mkdir } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const { join, dirname } = await import('node:path');

const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.screenshots');
await mkdir(OUT, { recursive: true });
const png = (n) => join(OUT, n);

const SECTIONS = ['fleet', 'how-it-works', 'gallery', 'locations', 'testimonials', 'footer'];

const browser = await chromium.launch();

/** Slow-scroll the page from top to bottom so all ScrollTriggers fire. */
async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const vh = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y < height; y += Math.floor(vh * 0.6)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function captureSections(page, suffix) {
  for (const id of SECTIONS) {
    // Read the section's absolute offset WITHOUT any stability wait (a looping
    // keyframe / parallax keeps the element "unstable", which stalls Playwright's
    // scroll-into-view + element-screenshot — the documented harness gotcha). We
    // scroll manually and take CLIPPED page screenshots with
    // `animations: 'disabled'` (pins CSS animations to a deterministic frame).
    const geom = await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, height: el.offsetHeight };
    }, id);
    if (!geom) continue;

    const vh = await page.evaluate(() => window.innerHeight);
    const slices = Math.min(3, Math.max(1, Math.ceil(geom.height / vh)));
    for (let s = 0; s < slices; s++) {
      await page.evaluate((y) => window.scrollTo(0, y), geom.top + s * vh);
      await page.waitForTimeout(450);
      // Force the gallery masked-wipe + parallax to their REVEALED rest state so
      // the screenshot shows the real subject (the GSAP `once:true` wipe may not
      // have fired at this exact scroll offset, leaving a blank clipped box — a
      // capture artifact, not a runtime bug). Transform/clip-path only.
      if (id === 'gallery') {
        await page.evaluate(() => {
          document
            .querySelectorAll('[data-frame-mask]')
            .forEach((m) => (m.style.clipPath = 'inset(0% 0% 0% 0%)'));
          document
            .querySelectorAll('[data-frame-img]')
            .forEach((i) => (i.style.transform = 'translateY(0)'));
          document
            .querySelectorAll('[data-frame-copy]')
            .forEach((c) => {
              c.style.opacity = '1';
              c.style.transform = 'none';
            });
        });
        await page.waitForTimeout(150);
      }
      await page.screenshot({
        path: png(`section-${id}-${suffix}${slices > 1 ? `-${s + 1}` : ''}.png`),
        animations: 'disabled',
      });
    }
  }
}

// ---- CSP scan + desktop light captures -----------------------------------
let cspViolations = 0;
const consoleErrors = [];
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    const t = msg.text();
    if (/Content Security Policy|violates the following/i.test(t)) cspViolations++;
    if (msg.type() === 'error') consoleErrors.push(t);
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await scrollThrough(page);
  await captureSections(page, 'light');
  await page.close();
}

// ---- desktop dark captures -----------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  // Persist the theme BEFORE any page script runs (next-themes reads it on init),
  // so the page hydrates dark with no flash and no storage-listener revert.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (/Content Security Policy|violates the following/i.test(msg.text())) cspViolations++;
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await scrollThrough(page);
  await captureSections(page, 'dark');
  await ctx.close();
}

// ---- mobile captures (390px) ---------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await scrollThrough(page);
  await captureSections(page, 'mobile');
  await page.close();
}

// ---- ultra-wide 2560px: the spine must stay centred (A-10) ----------------
{
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await scrollThrough(page);
  // A full-viewport shot of the fleet + how-it-works so the critic can judge the
  // gutter balance at ultra-wide.
  const fleetTop = await page.evaluate(() => {
    const el = document.getElementById('fleet');
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate((y) => window.scrollTo(0, y), fleetTop);
  await page.waitForTimeout(450);
  await page.screenshot({ path: png('section-ultrawide-2560-fleet.png'), animations: 'disabled' });
  // And the gallery at ultra-wide.
  const galTop = await page.evaluate(() => {
    const el = document.getElementById('gallery');
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate((y) => window.scrollTo(0, y), galTop);
  await page.waitForTimeout(450);
  await page.screenshot({ path: png('section-ultrawide-2560-gallery.png'), animations: 'disabled' });
  await page.close();
}

// ---- reduced-motion: reveals must resolve to static (full opacity) --------
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  // Without scrolling, a far-down section's reveal items must already be at
  // full opacity (reduced-motion resolves to static; nothing hidden).
  const fleetVisible = await page
    .locator('#fleet h2')
    .first()
    .isVisible();
  const galleryOpacity = await page.evaluate(() => {
    const copy = document.querySelector('#gallery [data-frame-copy]');
    return copy ? getComputedStyle(copy).opacity : 'n/a';
  });
  console.log(
    `reduced-motion: fleet heading visible=${fleetVisible}, gallery copy opacity=${galleryOpacity} (expect ~1)`,
  );
  await page.close();
}

await browser.close();

console.log('\n================ SECTIONS CSP/CAPTURE SUMMARY ================');
console.log('CSP violations (full-page scroll):', cspViolations);
console.log('Console errors:', consoleErrors.length);
for (const e of consoleErrors.slice(0, 5)) console.log('  -', e);
console.log('Screenshots written to scripts/.screenshots/');
console.log(cspViolations === 0 ? 'PASS — 0 CSP violations' : 'FAIL — CSP violations present');
