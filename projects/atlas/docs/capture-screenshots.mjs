// @ts-nocheck
/**
 * Screenshot capture for the atlas README — driven headlessly (Playwright
 * chromium) against a LOCAL prod stack served behind the same-origin proxy.
 *
 * WHY A LOCAL STACK (not a live deploy, like pulse does): atlas is not yet
 * deployed (Phase 9.2). These shots are captured against the faithful prod
 * stack the E2E suite uses — `next build && next start` for the web behind the
 * same-origin proxy (so the strict `connect-src 'self'` CSP covers the WS), and
 * the Fastify gateway DB-LESS (the engine boots from the frozen Porto baseline,
 * the fleet MOVES with no Postgres). Bring the stack up first:
 *
 *   cd projects/atlas/e2e
 *   ATLAS_WEB_PORT=3097 ATLAS_WS_PORT=3092 ATLAS_PROXY_PORT=3096 node atlas-stack.mjs
 *
 * Then (in another terminal):
 *
 *   node projects/atlas/docs/capture-screenshots.mjs
 *
 * Surfaces captured, dark + light where the surface supports both:
 *   - the live ops dashboard (the map + the fleet panel)   — the headline (wow)
 *   - a focused vehicle's detail panel pinned
 *   - the live events feed (with a geofence beat driven)
 *   - the no-WebGL fleet table fallback (the same live data, no canvas)
 *
 * The wow capture drives the deterministic "Play geofence beat" affordance and
 * waits on a real events-feed row before shooting — never a fixed sleep for the
 * beat itself (a short settle for the map paint is unavoidable on a canvas).
 *
 * Determinism: the engine is seeded (`faker.seed`), so the fleet, routes, and
 * zones are identical on every run; the motion is live forward ticks.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');

const BASE = process.env.ATLAS_BASE_URL ?? 'http://localhost:3096';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${name}.png`);
}

/** Open the dashboard in a theme and wait for the WS to reach "Live". */
async function openLive(context, scheme) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // Wait for the connection pill to read "Live" (the WS connected + a snapshot
  // arrived) so the fleet is on the map before the shot.
  await page
    .getByText(/Live/i)
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  // A short settle for the MapLibre canvas to paint the basemap + fleet and for
  // a few ticks to populate the panels.
  await sleep(4000);
  return page;
}

async function captureDashboard(context, scheme) {
  const page = await openLive(context, scheme);
  await shoot(page, `dashboard-${scheme}`);
  await page.close();
}

/** Click the first fleet-panel row to pin the vehicle detail panel. */
async function captureVehicleDetail(context, scheme) {
  const page = await openLive(context, scheme);
  const row = page.getByRole('button').filter({ hasText: /U\d|Truck|Van|Courier/i }).first();
  await row.click({ timeout: 10_000 }).catch(() => {});
  await sleep(2500);
  await shoot(page, `vehicle-detail-${scheme}`);
  await page.close();
}

/**
 * Drive the deterministic "Play geofence beat" affordance and capture the
 * events feed once a real event row lands (never a fixed sleep for the beat).
 */
async function captureEventsBeat(context, scheme) {
  const page = await openLive(context, scheme);
  const beat = page.getByRole('button', { name: /geofence beat|play.*beat/i }).first();
  await beat.click({ timeout: 10_000 }).catch(() => {});
  // Wait for an events-feed row carrying a geofence transition to materialise.
  await page
    .getByText(/entered|exited|geofence|zone/i)
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await sleep(1500);
  await shoot(page, `events-beat-${scheme}`);
  await page.close();
}

/** The no-WebGL fallback: toggle to the Table view (the first-class non-map path). */
async function captureTableView(context, scheme) {
  const page = await openLive(context, scheme);
  const toggle = page.getByRole('button', { name: /table/i }).first();
  await toggle.click({ timeout: 10_000 }).catch(() => {});
  await sleep(2500);
  await shoot(page, `table-view-${scheme}`);
  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'UTC',
  });

  // The wow first (dark is canonical), then light.
  await captureDashboard(context, 'dark');
  await captureDashboard(context, 'light');
  await captureVehicleDetail(context, 'dark');
  await captureEventsBeat(context, 'dark');
  await captureTableView(context, 'dark');

  await context.close();

  // Mobile dashboard (the dispatcher-on-a-phone surface).
  const mobile = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const mpage = await mobile.newPage();
  await mpage.emulateMedia({ colorScheme: 'dark' });
  await mpage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await mpage
    .getByText(/Live/i)
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await sleep(4000);
  await mpage.screenshot({ path: join(OUT, 'dashboard-mobile.png') });
  console.log('captured dashboard-mobile.png');
  await mobile.close();

  await browser.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
