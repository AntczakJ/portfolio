// Live-deploy screenshot capture for the tape README.
//
// Drives the deployed demo at https://tape-demo.fly.dev/ headlessly via the
// e2e workspace's bundled Chromium and writes a fresh PNG to
// docs/screenshots/. The live board may be partially filled depending on how
// long the Fly machine has been warm — that is acceptable; the shot proves the
// deploy is real and serving the chart.
//
// Run from projects/tape/e2e:
//   node capture-live.mjs
//
// Optional env:
//   TAPE_LIVE_URL   target URL (default https://tape-demo.fly.dev/)
//   TAPE_LIVE_WAIT  ms to wait after load for the board to fill (default 30000)

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'docs', 'screenshots');

const URL = process.env.TAPE_LIVE_URL ?? 'https://tape-demo.fly.dev/';
const WAIT_MS = Number(process.env.TAPE_LIVE_WAIT ?? 30_000);

async function capture(theme, file, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await context.newPage();
  console.log(`[capture] ${theme} ${viewport.width}x${viewport.height} -> ${file}`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
  // Give the WS time to connect and the chart to accumulate cells.
  await page.waitForTimeout(WAIT_MS);
  await page.screenshot({ path: resolve(OUT_DIR, file), fullPage: false });
  await browser.close();
  console.log(`[capture] wrote ${file}`);
}

await capture('dark', 'deploy-live-board.png', { width: 1440, height: 900 });
console.log('[capture] done');
