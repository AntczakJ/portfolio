// @ts-nocheck
/**
 * Screenshot capture for the pulse README — driven headlessly (Playwright
 * chromium) against the LIVE Fly deploy.
 *
 * Surfaces captured, in both light and dark:
 *   - the live status board        (/dashboard)        — the headline
 *   - the monitor detail            (/dashboard/monitors/<demoId>)
 *   - the public status page        (/status/demo)
 *   - the incidents view            (/dashboard/incidents)
 *   - the alerts view               (/dashboard/alerts)
 *
 * And the money shot — the demo-incident arc:
 *   - POST /demo/trigger, then poll the board until the demo card reads
 *     `data-status=down`, and capture the board with the monitor DOWN + the
 *     incident strip + (if visible) the alert toast (the wow).
 *
 * The deployed demo is OPEN (ADR-007): an unauthenticated visitor reads the
 * shared seeded demo workspace, so the dashboard / detail / incidents / alerts
 * all render without sign-in.
 *
 * Run:  node projects/pulse/docs/capture-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');

const BASE = process.env.PULSE_BASE_URL ?? 'https://pulse-demo-web.fly.dev';
const DEMO_MONITOR_ID =
  process.env.PULSE_DEMO_MONITOR_ID ?? 'b2e2c30b-16fd-47f9-aa89-6b7d1dd680fe';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${name}.png`);
}

/**
 * Hide the toaster container via injected CSS. The demo monitor is intentionally
 * flaky and flaps on its own, so a background recovery toast ("Checkout API is
 * back up") can race the forced-down frame and contradict it. Removing toast DOM
 * nodes does not work (the toaster re-renders them from store state) but a style
 * rule survives re-renders. The hero is the red "Outage detected" board strip;
 * suppressing the toaster gives an unambiguous Down frame. The container is
 * `div[role="region"][aria-label="Notifications"]` (web/src/components/ui/toaster.tsx).
 */
async function hideToaster(page) {
  await page
    .addStyleTag({
      content:
        '[role="region"][aria-label="Notifications"]{display:none !important}',
    })
    .catch(() => {});
}

/** Open a page at a path in a given theme and wait for it to settle. */
async function openThemed(context, path, scheme) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function captureBoard(context, scheme) {
  const page = await openThemed(context, '/dashboard', scheme);
  // Let the board fetch GET /monitors, open the SSE stream, and reach "Live".
  await page
    .getByRole('status')
    .filter({ hasText: /Live/ })
    .first()
    .waitFor({ timeout: 25_000 })
    .catch(() => {});
  await sleep(1500);
  await shoot(page, `board-${scheme}`);
  await page.close();
}

async function captureDetail(context, scheme) {
  const page = await openThemed(
    context,
    `/dashboard/monitors/${DEMO_MONITOR_ID}`,
    scheme,
  );
  await sleep(3500); // uPlot chart + uptime cards + history bar render
  await shoot(page, `monitor-detail-${scheme}`);
  await page.close();
}

async function capturePublic(context, scheme) {
  const page = await openThemed(context, '/status/demo', scheme);
  await sleep(1500);
  await shoot(page, `public-status-${scheme}`);
  await page.close();
}

async function captureIncidents(context, scheme) {
  const page = await openThemed(context, '/dashboard/incidents', scheme);
  await sleep(2000);
  await shoot(page, `incidents-${scheme}`);
  await page.close();
}

async function captureAlerts(context, scheme) {
  const page = await openThemed(context, '/dashboard/alerts', scheme);
  await sleep(2000);
  await shoot(page, `alerts-${scheme}`);
  await page.close();
}

/**
 * The money shot. Trigger the demo incident through the real pipeline and
 * capture the board in the DOWN window (the arc is open->recover->close in
 * ~45 s; we capture while it is open).
 */
async function captureDemoIncidentDown(context, scheme) {
  const page = await openThemed(context, '/dashboard', scheme);
  await page
    .getByRole('status')
    .filter({ hasText: /Live/ })
    .first()
    .waitFor({ timeout: 25_000 })
    .catch(() => {});
  // Suppress the toaster so a background flap's "back up" toast cannot bleed
  // into the Down frame and contradict it (see hideToaster docblock).
  await hideToaster(page);

  // Fire the arc.
  const res = await page.request.post(`${BASE}/demo/trigger`);
  console.log(`demo/trigger (${scheme}) -> ${res.status()}`);

  // Poll the demo card until it reads down (real probe -> classify -> incident).
  const card = page.locator(`[data-monitor-id="${DEMO_MONITOR_ID}"]`).first();
  let down = false;
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    const status = await card.getAttribute('data-status').catch(() => null);
    if (status === 'down') {
      down = true;
      break;
    }
    await sleep(1500);
  }
  console.log(`demo card down=${down} (${scheme})`);
  // Settle one frame so the incident strip is painted, and re-assert the
  // toaster suppression in case it mounted after the initial style injection.
  await sleep(1200);
  await hideToaster(page);
  await sleep(200);
  await shoot(page, `demo-incident-down-${scheme}`);
  await page.close();
  return down;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'UTC',
  });

  // The wow first (so the demo flag is fresh), dark then light.
  await captureDemoIncidentDown(context, 'dark');
  // Let the previous arc fully recover/close before the next trigger.
  await sleep(50_000);
  await captureDemoIncidentDown(context, 'light');
  await sleep(50_000);

  for (const scheme of ['dark', 'light']) {
    await captureBoard(context, scheme);
    await captureDetail(context, scheme);
    await capturePublic(context, scheme);
    await captureIncidents(context, scheme);
    await captureAlerts(context, scheme);
  }

  // Mobile public status page (the most-shared-to-mobile surface).
  const mobile = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const mpage = await mobile.newPage();
  await mpage.emulateMedia({ colorScheme: 'light' });
  await mpage.goto(`${BASE}/status/demo`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await mpage.screenshot({ path: join(OUT, 'public-status-mobile.png') });
  console.log('captured public-status-mobile.png');
  await mobile.close();

  await context.close();
  await browser.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
