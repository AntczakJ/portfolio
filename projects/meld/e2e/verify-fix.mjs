// Two-tab verification for the HocuspocusProvider onMessage fix.
//
// Drives a real two-context check against the local production-style
// stack (web :3001 behind server :3002). Asserts, against the bug that
// was just fixed:
//
//   1. No `reading 'data'` pageerror on the board route (the TypeError
//      the raw-MessageEvent destructure used to throw on every frame).
//   2. Tab B's drawn shape appears on tab A's shape canvas (Yjs sync
//      is alive over the wire) — measured as a pixel-region delta in
//      the area B drew into.
//   3. Tab B's moving pointer paints a remote cursor on tab A's cursor
//      canvas (awareness is alive over the wire).
//
// The shape canvas paints a full-canvas grid background, so a raw
// non-empty-pixel count is saturated. Instead we hash the pixel bytes
// of the sub-region B drew into, before and after, and assert it
// changed on A. The cursor canvas is clearRect'd, so a non-empty pixel
// count there is a valid remote-cursor signal.
//
// Run from the e2e workspace so @playwright/test resolves:
//   cd projects/meld/e2e && node verify-fix.mjs

import { chromium } from '@playwright/test';

const BASE = process.env.MELD_LOCAL_BASE ?? 'http://localhost:3002';
const VIEWPORT = { width: 1440, height: 900 };

const pageErrors = [];

async function newPage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
  });
  return { context, page };
}

async function openFreshBoard(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const cta = page.getByRole('button', { name: /board/i }).first();
  await cta.click();
  await page.waitForURL(/\/board\//, { timeout: 15_000 });
  await page.waitForTimeout(2_500);
  return { context, page };
}

async function joinBoard(browser, url) {
  const { context, page } = await newPage(browser);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3_500);
  return { context, page };
}

async function canvasBox(page, testId) {
  const bb = await page.getByTestId(testId).boundingBox();
  if (!bb) throw new Error(`${testId} has no bounding box`);
  return bb;
}

async function selectTool(page, kind) {
  const slot = page.getByTestId(`toolbar-slot-${kind}`);
  if (await slot.count()) await slot.click();
}

// FNV-1a hash of the pixel bytes inside a normalized sub-region of a
// canvas. Region coords are fractions of canvas width/height.
async function regionHash(page, testId, region) {
  return page.getByTestId(testId).evaluate((el, r) => {
    const canvas = el;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-ctx';
    const { width, height } = canvas;
    const x = Math.floor(width * r.x0);
    const y = Math.floor(height * r.y0);
    const w = Math.floor(width * (r.x1 - r.x0));
    const h = Math.floor(height * (r.y1 - r.y0));
    const { data } = ctx.getImageData(x, y, w, h);
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 1) {
      hash ^= data[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  }, region);
}

async function nonEmptyPixelCount(page, testId) {
  return page.getByTestId(testId).evaluate((el) => {
    const ctx = el.getContext('2d');
    if (!ctx) return -1;
    const { width, height } = el;
    if (width === 0 || height === 0) return 0;
    const { data } = ctx.getImageData(0, 0, width, height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) count += 1;
    }
    return count;
  });
}

async function main() {
  const browser = await chromium.launch();
  const results = {};
  // The region B will draw its rectangle into (canvas fractions).
  const drawRegion = { x0: 0.25, y0: 0.3, x1: 0.6, y1: 0.65 };
  try {
    // Tab A — the observer. Draws nothing; we assert REMOTE state on it.
    const a = await openFreshBoard(browser);
    const url = a.page.url();
    console.log('board url:', url);

    const shapeHashBefore = await regionHash(a.page, 'shape-canvas', drawRegion);
    const cursorBefore = await nonEmptyPixelCount(a.page, 'cursor-canvas');
    console.log('A region hash before:', shapeHashBefore, 'cursor px:', cursorBefore);

    // Tab B — distinct identity (fresh context = fresh cookie). Joins,
    // draws a rectangle (sync proof), then drives a live cursor.
    const b = await joinBoard(browser, url);
    const bbB = await canvasBox(b.page, 'shape-canvas');
    await selectTool(b.page, 'rectangle');
    await b.page.mouse.move(bbB.x + bbB.width * 0.3, bbB.y + bbB.height * 0.35);
    await b.page.mouse.down();
    await b.page.mouse.move(
      bbB.x + bbB.width * 0.55,
      bbB.y + bbB.height * 0.6,
      { steps: 16 },
    );
    await b.page.mouse.up();
    await selectTool(b.page, 'select');

    await a.page.waitForTimeout(1_500);
    const shapeHashAfter = await regionHash(a.page, 'shape-canvas', drawRegion);
    console.log('A region hash after B drew:', shapeHashAfter);

    // Park A's pointer off-canvas so only B's remote cursor inks it.
    await a.page.mouse.move(24, 24);

    const tx = bbB.x + bbB.width * 0.42;
    const ty = bbB.y + bbB.height * 0.2;
    for (let i = 0; i < 6; i += 1) {
      await b.page.mouse.move(tx - 60, ty - 30, { steps: 8 });
      await b.page.mouse.move(tx + 40, ty + 24, { steps: 8 });
      await b.page.mouse.move(tx, ty, { steps: 6 });
      await a.page.waitForTimeout(180);
    }
    await a.page.waitForTimeout(400);
    const cursorAfter = await nonEmptyPixelCount(a.page, 'cursor-canvas');
    console.log('A cursor px after B moved:', cursorAfter);

    const ws = await a.page.request.get(`${BASE}/health.ws`);
    const wsJson = await ws.json();
    console.log('/health.ws:', JSON.stringify(wsJson.ws));

    results.dataPageError = pageErrors.some((m) => /reading 'data'/.test(m));
    results.shapeSynced = shapeHashBefore !== shapeHashAfter;
    results.cursorPainted = cursorAfter > cursorBefore + 20;
    results.shapeHashBefore = shapeHashBefore;
    results.shapeHashAfter = shapeHashAfter;
    results.cursorAfter = cursorAfter;
    results.connectedClients = wsJson.ws?.connectedClients;
    results.roomCount = wsJson.ws?.roomCount;
    results.allPageErrors = pageErrors;

    await b.context.close();
    await a.context.close();
  } finally {
    await browser.close();
  }

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  const pass =
    !results.dataPageError && results.shapeSynced && results.cursorPainted;
  console.log('\nVERDICT:', pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
