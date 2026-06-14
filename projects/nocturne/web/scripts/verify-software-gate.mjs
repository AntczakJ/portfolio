// Headless verification of the software-WebGL gate + the hardware hint (FIX 1+2).
//
// Headless chromium here uses software GL (SwiftShader), which PASSES the WebGL2
// + EXT_color_buffer_float gates. After FIX 1, the real `detectGpuTier` must read
// the software renderer and route to the POSTER with posterReason
// 'software-webgl', and the Stage must render the dismissible "enable hardware
// acceleration" hint (FIX 2). Asserts: the hint renders, the begin gate does NOT
// (no live field), the no-JS directory is visible, and 0 CSP/console/page errors.
//
// Run AFTER `next build` with a server on :3100. Exits non-zero on any failure.

import { chromium } from '@playwright/test';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3100/';

const consoleErrors = [];
const cspViolations = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => {
  pageErrors.push(err.message);
});
await page.addInitScript(() => {
  globalThis.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    globalThis.__csp.push(
      `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`,
    );
  });
});

// NOTE: no `?tier=` override here — that bypasses the software gate. We want the
// REAL probe to see SwiftShader and route to the poster.
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const hint = page.getByRole('status').filter({
  hasText: /hardware-accelerated WebGL appears to be off/i,
});
const hintVisible = await hint.isVisible().catch(() => false);

const beginVisible = await page
  .getByRole('button', { name: /press to begin|begin/i })
  .isVisible()
  .catch(() => false);

const dismissBtn = page.getByRole('button', {
  name: /dismiss hardware acceleration note/i,
});
const dismissReachable = await dismissBtn.count();

// keyboard-dismiss it (no .click() — software-GL canvas stability caveat does not
// apply here since there is no live canvas, but keyboard is the faithful check).
let dismissedOk = false;
if (dismissReachable > 0) {
  await dismissBtn.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  dismissedOk = !(await hint.isVisible().catch(() => false));
}

// the no-JS / Tier-4 directory floor must be present (the readable surface).
const directoryCards = await page
  .locator('[data-nojs-fallback] article, [data-nojs-fallback] a')
  .count();

const collectedCsp = await page.evaluate(() => globalThis.__csp ?? []);
cspViolations.push(...collectedCsp);

await browser.close();

const failures = [];
if (!hintVisible) failures.push('the software-webgl hint did not render');
if (beginVisible)
  failures.push('the begin gate rendered (live field should NOT be armed on software-GL)');
if (dismissReachable === 0) failures.push('no keyboard-reachable dismiss button');
if (!dismissedOk) failures.push('the hint did not dismiss on Enter');
if (directoryCards === 0) failures.push('the no-JS directory floor is missing');
if (cspViolations.length) failures.push(`CSP: ${cspViolations.join(' | ')}`);
if (consoleErrors.length) failures.push(`console: ${consoleErrors.join(' | ')}`);
if (pageErrors.length) failures.push(`page: ${pageErrors.join(' | ')}`);

console.log(
  JSON.stringify(
    {
      hintVisible,
      beginVisible,
      dismissReachable,
      dismissedOk,
      directoryCards,
      cspViolations: cspViolations.length,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
    },
    null,
    2,
  ),
);

if (failures.length) {
  console.error('SOFTWARE-GATE VERIFY FAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('SOFTWARE-GATE VERIFY PASSED');
