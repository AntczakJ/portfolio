// Screenshot capture for the meld README.
//
// Drives a meld instance with Playwright and writes PNGs into
// docs/screenshots/. The script imports `@playwright/test`, which only
// resolves from inside the e2e workspace, so run it from there:
//
//   cd projects/meld/e2e
//   node ../docs/capture-screenshots.mjs
//
// Target: by default this points at the live demo
// (https://meld-demo.fly.dev). The landing + board shots capture
// reliably against it. The two-tab presence shot (the headline image)
// needs both WebSocket connections held in the same room at the same
// instant; that is stable against a LOCAL dev stack but flaps under
// headless automation against the single-Machine demo, so capture the
// two-tab image by hand from a local run (see README "Screenshots").
//
// Theme is forced by seeding the next-themes localStorage key before the
// app boots (attribute strategy = data-theme on :root). Reduced-motion
// is left at system default so the capture matches a normal visit.

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'screenshots');
const BASE = 'https://meld-demo.fly.dev';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

function seedTheme(theme) {
  // next-themes localStorage key is `theme`; attribute strategy writes
  // data-theme on :root. Seed before any app code runs.
  return `try { localStorage.setItem('theme', '${theme}'); } catch {}`;
}

async function newPage(browser, { theme, viewport }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript(seedTheme(theme));
  const page = await context.newPage();
  return { context, page };
}

async function shot(page, name) {
  const path = join(outDir, name);
  await page.screenshot({ path });
  console.log('wrote', path);
}

async function settle(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

async function captureLanding(browser, theme, file) {
  const { context, page } = await newPage(browser, { theme, viewport: DESKTOP });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  await shot(page, file);
  await context.close();
}

async function captureMobileLanding(browser, theme, file) {
  const { context, page } = await newPage(browser, { theme, viewport: MOBILE });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  await shot(page, file);
  await context.close();
}

async function openBoard(browser, theme, viewport = DESKTOP) {
  const { context, page } = await newPage(browser, { theme, viewport });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Click "Open a board" / "New board" CTA — it navigates to /board/<uuid>.
  const cta = page.getByRole('button', { name: /board/i }).first();
  await cta.click();
  await page.waitForURL(/\/board\//, { timeout: 15000 });
  await settle(page, 1800);
  return { context, page };
}

async function drawSomething(page) {
  // Pick the rectangle tool then drag a couple of shapes onto the canvas
  // so the board is not empty in the screenshots.
  const rect = page.getByTestId('toolbar-slot-rectangle');
  if (await rect.count()) {
    await rect.click();
    const box = page.locator('canvas').first();
    const bb = await box.boundingBox();
    if (bb) {
      const drag = async (x1, y1, x2, y2) => {
        await page.mouse.move(bb.x + x1, bb.y + y1);
        await page.mouse.down();
        await page.mouse.move(bb.x + x2, bb.y + y2, { steps: 12 });
        await page.mouse.up();
      };
      await drag(bb.width * 0.22, bb.height * 0.28, bb.width * 0.42, bb.height * 0.5);
      const ell = page.getByTestId('toolbar-slot-ellipse');
      if (await ell.count()) await ell.click();
      await drag(bb.width * 0.55, bb.height * 0.35, bb.width * 0.74, bb.height * 0.58);
      const select = page.getByTestId('toolbar-slot-select');
      if (await select.count()) await select.click();
    }
  }
  await settle(page, 800);
}

async function captureBoard(browser, theme, file) {
  const { context, page } = await openBoard(browser, theme);
  await drawSomething(page);
  await shot(page, file);
  await context.close();
}

async function captureTwoTabPresence(browser, theme, file) {
  // The wow moment: two contexts, same board, remote cursor visible.
  // Tab A is the observer we screenshot; tab B drives a moving pointer.
  const a = await openBoard(browser, theme);
  const boardUrl = a.page.url();
  await drawSomething(a.page);

  // Park tab A's own pointer well off-canvas (over the top bar) so the
  // OS cursor in A does not appear near the canvas — only B's remote
  // cursor (painted on the cursor canvas) should be in frame.
  await a.page.mouse.move(20, 20);

  const b = await newPage(browser, { theme, viewport: DESKTOP });
  await b.page.goto(boardUrl, { waitUntil: 'networkidle' });
  // Give B's HocuspocusProvider time to complete the sync + awareness
  // handshake against A. The remote cursor only renders once B has
  // broadcast an awareness update carrying a cursor position.
  await settle(b.page, 4000);

  const bbB = (await b.page.locator('canvas').first().boundingBox()) ?? {
    x: 0,
    y: 0,
    width: DESKTOP.width,
    height: DESKTOP.height,
  };

  // Move B's pointer in a continuous loop in a clear region of the
  // board (upper-right quadrant, clear of the two shapes), screenshot A
  // mid-motion so its critical-damped lerp has a fresh target. Retry a
  // few times — the first awareness frame can lag the sync handshake.
  const cx = bbB.x + bbB.width * 0.66;
  const cy = bbB.y + bbB.height * 0.3;
  for (let i = 0; i < 6; i += 1) {
    await b.page.mouse.move(cx - 60, cy - 40, { steps: 8 });
    await b.page.mouse.move(cx + 60, cy + 40, { steps: 8 });
    await b.page.mouse.move(cx, cy, { steps: 6 });
    await a.page.waitForTimeout(250);
  }
  // Final small nudge then a short settle so A's cursor is freshly live
  // and close to its target at the moment of capture.
  await b.page.mouse.move(cx + 8, cy + 6, { steps: 4 });
  await a.page.waitForTimeout(300);

  await shot(a.page, file);
  await b.context.close();
  await a.context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await captureLanding(browser, 'light', 'landing-light.png');
    await captureLanding(browser, 'dark', 'landing-dark.png');
    await captureMobileLanding(browser, 'light', 'landing-mobile.png');
    await captureBoard(browser, 'light', 'board-light.png');
    await captureBoard(browser, 'dark', 'board-dark.png');
    await captureTwoTabPresence(browser, 'light', 'two-tab-presence-light.png');
    await captureTwoTabPresence(browser, 'dark', 'two-tab-presence-dark.png');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
