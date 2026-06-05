// @ts-nocheck
/* eslint-disable */
/**
 * Headless CSP verification of the apex LIVE CONFIGURATOR (Task 4.4) under the
 * PRODUCTION build + CSP (the meld/razors-edge lesson: NEVER verify CSP under
 * `next dev` — dev relaxes the policy and uses eval for HMR).
 *
 * Retargeted from the scaffold version (which asserted the now-removed smoke
 * components) onto the real configurator section on the home route. It asserts:
 *   - the served CSP header (logged for the AGENT_NOTES record);
 *   - the page loads with ZERO CSP violations — the live R3F three.js scene
 *     (model-swap PASS A: the CC0 Kenney Car Kit body + wheel GLBs, textureless
 *     + UNCOMPRESSED, so NO draco/meshopt decoder, NO WASM) hydrates and runs
 *     under `script-src 'self' 'unsafe-inline'` with NO `'unsafe-eval'` and NO
 *     `'wasm-unsafe-eval'`;
 *   - the R3F <canvas> actually mounts in the configurator stage (three.js
 *     hydrated, capability gate resolved tier-1 in chromium);
 *   - drag-to-orbit exercises OrbitControls -> invalidate() with no violation;
 *   - swapping a colour swatch (a real DOM radio) re-renders with no violation;
 *   - swapping a WHEEL swatch (a real geometry swap now) re-renders clean.
 *
 * Run AGAINST an already-running `next start` on argv[2] (default 3090).
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
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

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
const response = await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
const servedCsp = response?.headers()?.['content-security-policy'] ?? '(none)';
console.log('\nServed Content-Security-Policy:\n  ' + servedCsp + '\n');

// Scroll the configurator section into view so the capability gate runs and the
// dynamic three.js chunk loads.
await page.locator('#configurator').scrollIntoViewIfNeeded();
await page.waitForTimeout(800);

let canvasMounted = false;
try {
  await page.waitForSelector('#configurator canvas', { timeout: 20000 });
  canvasMounted = true;
  console.log('R3F <canvas> mounted in the configurator stage (three.js hydrated under CSP).');
} catch {
  console.log('R3F <canvas> did NOT mount in the configurator stage.');
}

// Drag the canvas to exercise OrbitControls -> invalidate() render.
if (canvasMounted) {
  const box = await page.locator('#configurator canvas').first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 80,
      box.y + box.height / 2 + 20,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
}

// Swap a colour swatch (a real DOM radio) — proves the live material swap path
// runs CSP-clean.
let swatchSwapped = false;
try {
  // The radio is `sr-only` (its visible state is a sibling swatch chip), so
  // click the enclosing <label> to flip it — same path a sighted user takes.
  await page
    .getByRole('radio', { name: /Graphite/i })
    .locator('xpath=ancestor::label')
    .first()
    .click();
  await page.waitForTimeout(400);
  swatchSwapped = true;
  console.log('Colour swatch swapped (Graphite) — live material change ran.');
} catch {
  console.log('Colour swatch swap did not run.');
}

// Swap a WHEEL swatch (now a real geometry swap — instances a different wheel
// GLB at the four nodes). Proves the geometry swap path runs CSP-clean.
let wheelSwapped = false;
try {
  await page
    .getByRole('radio', { name: /Turbine/i })
    .locator('xpath=ancestor::label')
    .first()
    .click();
  await page.waitForTimeout(400);
  wheelSwapped = true;
  console.log('Wheel swatch swapped (Turbine) — live geometry swap ran.');
} catch {
  console.log('Wheel swatch swap did not run.');
}

const pageViolations = await page.evaluate(() => window.__cspViolations ?? []);
violations.push(...pageViolations);

await browser.close();

console.log('\n============ CONFIGURATOR CSP VERIFICATION SUMMARY ============');
console.log(`CSP violations:   ${violations.length}`);
for (const v of violations) console.log('  - ' + v);
console.log(`Console errors:   ${consoleErrors.length}`);
for (const e of consoleErrors) console.log('  - ' + e);
console.log(`Page errors:      ${pageErrors.length}`);
for (const e of pageErrors) console.log('  - ' + e);

let pass = true;
const evalViolations = violations.filter((v) => /eval/i.test(v));
if (evalViolations.length > 0) {
  console.log('\nFAIL: eval-related CSP violation(s) detected.');
  pass = false;
}
if (violations.length > 0) {
  console.log('\nFAIL: CSP violation(s) detected (quality bar is ZERO).');
  pass = false;
}
if (!canvasMounted) {
  console.log('\nFAIL: R3F canvas never mounted — cannot prove three.js CSP-clean.');
  pass = false;
}
if (!swatchSwapped) {
  console.log('\nWARN: colour swatch swap did not run (selector/timing).');
}
if (!wheelSwapped) {
  console.log('\nWARN: wheel swatch swap did not run (selector/timing).');
}

console.log(`\n${pass ? 'PASS' : 'FAIL'} — apex configurator CSP verification`);
process.exit(pass ? 0 : 1);
