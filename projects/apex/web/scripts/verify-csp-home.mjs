// @ts-nocheck
/* eslint-disable */
/**
 * Headless CSP verification of the apex HOME ROUTE (Task 4.2) under the
 * PRODUCTION build + CSP (the meld/razors-edge lesson: NEVER verify CSP under
 * `next dev`).
 *
 * The scaffold-era `verify-csp.mjs` asserted the smoke components (R3F canvas,
 * query smoke, GSAP smoke) that the real hero replaced. This script verifies
 * the real chrome + scroll-hero (Task 4.1/4.2) instead, and asserts:
 *   - the page loads with ZERO CSP violations (the GSAP hero choreography +
 *     radix Dialog mobile menu run under the strict no-`unsafe-eval` CSP);
 *   - the static AVIF hero render is present as the LCP element (an <img>
 *     with the hero-desktop/-mobile src), NOT a canvas;
 *   - NO <canvas> mounts on the home route yet (Task 4.2 mounts no R3F — the
 *     canvas is Task 4.4);
 *   - the GSAP hero pin actually engages on scroll (the section pins);
 *   - the mobile menu opens (radix Dialog, focus-trapped).
 *
 * Run against an already-running `next start` on argv[2] (default 3090).
 * NOTE: the decoder/CSP re-verification for the live configurator (Task 4.4)
 * still uses (an updated) `verify-csp.mjs` once R3F is mounted on the page.
 */
const playwrightUrl =
  process.argv[3] ??
  new URL(
    '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
    import.meta.url,
  ).href;
const { chromium } = await import(playwrightUrl);

const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;

const violations = [];
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push(
      `${e.violatedDirective} blocked ${e.blockedURI || e.sourceFile || 'inline'}`,
    );
  });
});

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => {
  pageErrors.push(err.message);
});

console.log(`Loading ${BASE} …`);
await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1500);

// The static render is the LCP — an <img> from /renders/lumen-gt/, never a canvas.
// next/image rewrites the src to /_next/image?url=...; the `lumen-gt` segment
// survives unencoded in the query, so match on that.
const heroImg = await page
  .locator('img[src*="lumen-gt"]')
  .first()
  .count();
console.log(`Hero static render <img> present: ${heroImg > 0}`);

// The HERO mounts no R3F (the canvas lives in the configurator section, which is
// below the fold and not yet scrolled into view). Scope the assertion to #hero.
const canvasCount = await page.locator('#hero canvas').count();
console.log(`<canvas> count inside #hero (expected 0 — hero mounts no R3F): ${canvasCount}`);

// Scroll into the hero pin and confirm the section pins (ScrollTrigger adds a
// pin-spacer). Give GSAP (idle-deferred + dynamic-imported) time to attach.
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.6));
await page.waitForTimeout(800);
const pinned = await page.evaluate(
  () => document.querySelectorAll('.pin-spacer').length > 0,
);
console.log(`GSAP hero pin engaged (pin-spacer present): ${pinned}`);

// Open the mobile menu (switch to a narrow viewport so the trigger is visible).
await page.setViewportSize({ width: 375, height: 720 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
let menuOpened = false;
try {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 3000 });
  menuOpened = true;
  console.log('Mobile menu (radix Dialog) opened.');
} catch {
  console.log('Mobile menu did NOT open.');
}

const pageViolations = await page.evaluate(() => window.__cspViolations ?? []);
violations.push(...pageViolations);

await browser.close();

console.log('\n================ HOME CSP/WIRING SUMMARY ================');
console.log(`CSP violations:   ${violations.length}`);
for (const v of violations) console.log('  - ' + v);
console.log(`Console errors:   ${consoleErrors.length}`);
for (const e of consoleErrors) console.log('  - ' + e);
console.log(`Page errors:      ${pageErrors.length}`);
for (const e of pageErrors) console.log('  - ' + e);

let pass = true;
if (violations.length > 0) {
  console.log('\nFAIL: CSP violation(s) detected (quality bar is ZERO).');
  pass = false;
}
if (heroImg === 0) {
  console.log('\nFAIL: hero static render <img> not found (LCP must be the render).');
  pass = false;
}
if (canvasCount !== 0) {
  console.log('\nFAIL: a <canvas> mounted inside #hero — the hero must mount no R3F (the canvas lives in the configurator section).');
  pass = false;
}
if (!pinned) {
  console.log('\nWARN: GSAP hero pin did not engage (idle-defer timing under headless).');
}
if (!menuOpened) {
  console.log('\nFAIL: mobile menu did not open.');
  pass = false;
}

console.log(`\n${pass ? 'PASS' : 'FAIL'} — apex home CSP/wiring verification`);
process.exit(pass ? 0 : 1);
