// Two-tab presence hero shot — LOCAL capture.
//
// The headline image for the meld README: one board, two users, a remote
// cursor (emoji + name pill) painted live on the observer's canvas. This
// is the wow moment and the whole pitch, so it gets its own script.
//
// Why local and not the live demo: the remote cursor only paints while BOTH
// WebSocket connections are held in the same room at the same instant and
// the remote pointer is moving. That handshake is rock-solid against a local
// dev stack but flaps under headless automation against the single-Machine
// Fly demo (edge WS failover), so the hero shot is captured here.
//
// Prereqs (all already up when this runs):
//   - Postgres on :5436 (docker compose)
//   - meld-server on :3002 with localhost:3001 in MELD_ALLOWED_ORIGINS
//   - meld-web on :3001 (web/.env.local points it at :3002)
//
// Run from the e2e workspace so @playwright/test resolves:
//   cd projects/meld/e2e && node ../docs/capture-hero-local.mjs

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'docs', 'screenshots');
const BASE = process.env.MELD_LOCAL_BASE ?? 'http://localhost:3001';
const VIEWPORT = { width: 1440, height: 900 };

function seedTheme(theme) {
  // next-themes localStorage key is `theme`; attribute strategy writes
  // data-theme on :root. Seed before any app code runs.
  return `try { localStorage.setItem('theme', '${theme}'); } catch {}`;
}

async function newPage(browser, theme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(seedTheme(theme));
  const page = await context.newPage();
  return { context, page };
}

async function openFreshBoard(browser, theme) {
  const { context, page } = await newPage(browser, theme);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const cta = page.getByRole('button', { name: /board/i }).first();
  await cta.click();
  await page.waitForURL(/\/board\//, { timeout: 15_000 });
  await page.waitForTimeout(2_000);
  return { context, page };
}

async function joinBoard(browser, theme, url) {
  const { context, page } = await newPage(browser, theme);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2_000);
  return { context, page };
}

async function canvasBox(page) {
  const bb = await page.getByTestId('shape-canvas').boundingBox();
  if (!bb) throw new Error('shape canvas has no bounding box');
  return bb;
}

async function drag(page, bb, x1, y1, x2, y2, steps = 14) {
  await page.mouse.move(bb.x + bb.width * x1, bb.y + bb.height * y1);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * x2, bb.y + bb.height * y2, { steps });
  await page.mouse.up();
}

async function selectTool(page, kind) {
  const slot = page.getByTestId(`toolbar-slot-${kind}`);
  if (await slot.count()) await slot.click();
}

async function capture(browser, theme) {
  // Driver tab — joins FIRST and stays connected, draws two shapes so the
  // board reads as a real working surface, then drives a live cursor.
  const driver = await openFreshBoard(browser, theme);
  const url = driver.page.url();
  const bbD = await canvasBox(driver.page);
  await selectTool(driver.page, 'rectangle');
  await drag(driver.page, bbD, 0.2, 0.3, 0.4, 0.54);
  await selectTool(driver.page, 'ellipse');
  await drag(driver.page, bbD, 0.56, 0.36, 0.76, 0.6);
  await selectTool(driver.page, 'select');
  // Give the driver's WS a moment to register in the room so the observer's
  // SSR snapshot (GET /api/boards/:id) reports it as a connected client —
  // that is what makes the observer's board caption read ">0 connected".
  await driver.page.waitForTimeout(1_500);

  // Observer tab — a second, distinct identity (fresh context = fresh
  // cookie) that joins SECOND. We screenshot THIS tab: it sees the driver's
  // shapes (sync proof), the driver's live cursor (presence proof), and a
  // non-zero connected count (the driver was already in the room when the
  // observer's page was server-rendered).
  const observer = await joinBoard(browser, theme, url);
  // Let the observer's HocuspocusProvider finish the sync + awareness
  // handshake so the driver's shapes appear and the cursor channel is live.
  await observer.page.waitForTimeout(3_500);

  // Park the observer's own OS pointer off the canvas (over the top bar) so
  // only the driver's remote cursor is in frame near the artwork.
  await observer.page.mouse.move(24, 24);

  // Drive the driver's pointer to a clear, legible spot (upper-centre, clear
  // of both shapes) and hold it there. Move in a short loop so at least one
  // ~30 ms-throttled awareness frame fires, ending on the resting target.
  const tx = bbD.x + bbD.width * 0.46;
  const ty = bbD.y + bbD.height * 0.18;
  for (let i = 0; i < 5; i += 1) {
    await driver.page.mouse.move(tx - 50, ty - 30, { steps: 8 });
    await driver.page.mouse.move(tx + 30, ty + 20, { steps: 8 });
    await driver.page.mouse.move(tx, ty, { steps: 6 });
    await observer.page.waitForTimeout(200);
  }
  await driver.page.mouse.move(tx + 4, ty + 3, { steps: 3 });
  // Short settle so the observer's critical-damped lerp lands on the resting
  // target (≈200 ms to ~99.9% convergence) at full cursor opacity.
  await observer.page.waitForTimeout(350);

  const file = join(outDir, `two-tab-presence-${theme}.png`);
  await observer.page.screenshot({ path: file });
  console.log('wrote', file);

  await observer.context.close();
  await driver.context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await capture(browser, 'light');
    await capture(browser, 'dark');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
