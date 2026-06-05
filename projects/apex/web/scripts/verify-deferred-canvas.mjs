// @ts-nocheck
/* eslint-disable */
/**
 * Deferred-canvas verification (the Phase-7 perf pass core fix).
 *
 * Proves — by NETWORK + DOM evidence, not the static manifest — that on a
 * Tier-1-capable DESKTOP profile the live R3F canvas (and therefore the three.js
 * chunks + the ~1.5 MB GLB) is NOT requested during the home INITIAL load, and
 * mounts only when the configurator section is approached (IntersectionObserver
 * on a generous rootMargin) or on user intent.
 *
 *   Phase A — load `/`, stay above the fold: assert NO .glb request and NO
 *             <canvas> in the configurator (the heavy scene is off the critical
 *             path Lighthouse measures).
 *   Phase B — scroll the configurator into view: assert the .glb DOES load and a
 *             <canvas> mounts (the deferred mount still arms on approach).
 *
 * Run against a running `next start` on argv[2] (default 3091).
 */
const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);
const PORT = process.argv[2] ?? '3091';
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();
let pass = true;

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const requests = [];
page.on('request', (r) => requests.push(r.url()));

const isGlb = (u) => /\.glb(\?|$)/i.test(u);
// three.js / fiber / drei live in a code-split chunk; we detect the GLB (the
// unambiguous heavy asset) for the network claim, plus the live <canvas> mount.

await page.goto(BASE, { waitUntil: 'load' });
// Give the page a beat past load + any idle scheduling; stay scrolled to top.
await page.waitForTimeout(2500);

// ---- Phase A: above the fold, nothing heavy should have loaded --------------
const glbBeforeScroll = requests.filter(isGlb);
const canvasBeforeScroll = await page.locator('#configurator canvas').count();
const scrollY = await page.evaluate(() => window.scrollY);
console.log(`[Phase A] scrollY=${scrollY} (expect 0)`);
console.log(
  `[Phase A] .glb requests during initial load: ${glbBeforeScroll.length} (expect 0)`,
);
console.log(
  `[Phase A] <canvas> in configurator: ${canvasBeforeScroll} (expect 0)`,
);
if (glbBeforeScroll.length !== 0) {
  console.log('FAIL: the GLB loaded on the home initial load.');
  glbBeforeScroll.forEach((u) => console.log('   ', u));
  pass = false;
}
if (canvasBeforeScroll !== 0) {
  console.log('FAIL: a <canvas> mounted before approach/intent.');
  pass = false;
}

// ---- Phase B: approach the configurator -> the canvas arms + the GLB loads --
await page.locator('#configurator').scrollIntoViewIfNeeded();
// Wait for the GLB to be requested (the canvas armed + the dynamic chunk ran).
try {
  await page.waitForRequest(isGlb, { timeout: 8000 });
} catch {
  // fall through to the assertions below for a clear message
}
await page.waitForTimeout(2500);

const glbAfterScroll = requests.filter(isGlb);
const canvasAfterScroll = await page.locator('#configurator canvas').count();
console.log(
  `[Phase B] .glb requests after approach: ${glbAfterScroll.length} (expect >= 1)`,
);
console.log(
  `[Phase B] <canvas> in configurator: ${canvasAfterScroll} (expect >= 1)`,
);
if (glbAfterScroll.length < 1) {
  console.log('FAIL: the GLB never loaded after approaching the configurator.');
  pass = false;
}
if (canvasAfterScroll < 1) {
  console.log('FAIL: the live canvas never mounted on approach (Tier-1).');
  pass = false;
}

await ctx.close();
await browser.close();
console.log(`\n${pass ? 'PASS' : 'FAIL'} — apex deferred-canvas verification`);
process.exit(pass ? 0 : 1);
