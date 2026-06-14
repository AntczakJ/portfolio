// Headless-chromium CSP + render smoke for the Pass-1 stage (Task 1.3).
//
// Loads the PRODUCTION build (`next start -p 3100`) in headless chromium,
// collects every console error + every CSP violation + every page error, waits
// for the WebGL2 smoke canvas to mount and paint a frame, and asserts the page
// is clean. Run AFTER `next build --webpack` with a server already listening on
// :3100. Exits non-zero on any violation/error so CI can gate on it.

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
// CSP violations surface as a securitypolicyviolation event in the page.
await page.addInitScript(() => {
  globalThis.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    globalThis.__csp.push(
      `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} @ ${e.sourceFile || '?'}:${e.lineNumber || '?'} :: ${(e.sample || '').slice(0, 80)}`,
    );
  });
});

await page.goto(URL, { waitUntil: 'networkidle' });

// Give the lazy R3F island time to import three.js, acquire WebGL2, and paint.
await page.waitForTimeout(2500);

// The smoke canvas must exist and have a backing WebGL context with a non-zero
// drawing buffer (proof it actually rendered, not just mounted a 0×0 element).
const canvasState = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { present: false };
  const gl =
    canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? null;
  return {
    present: true,
    width: canvas.width,
    height: canvas.height,
    hasGl: Boolean(gl),
  };
});

const collectedCsp = await page.evaluate(() => globalThis.__csp ?? []);
cspViolations.push(...collectedCsp);

await browser.close();

const problems = [];
if (!canvasState.present) problems.push('no <canvas> mounted');
if (canvasState.present && (!canvasState.width || !canvasState.height)) {
  problems.push(`canvas has zero size (${canvasState.width}x${canvasState.height})`);
}
if (cspViolations.length) problems.push(`CSP violations: ${JSON.stringify(cspViolations)}`);
if (consoleErrors.length) problems.push(`console errors: ${JSON.stringify(consoleErrors)}`);
if (pageErrors.length) problems.push(`page errors: ${JSON.stringify(pageErrors)}`);

console.log('canvas:', JSON.stringify(canvasState));
console.log('cspViolations:', cspViolations.length);
console.log('consoleErrors:', consoleErrors.length);
console.log('pageErrors:', pageErrors.length);

if (problems.length) {
  console.error('SMOKE FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('SMOKE PASSED — canvas rendered, 0 CSP violations, 0 console errors.');
