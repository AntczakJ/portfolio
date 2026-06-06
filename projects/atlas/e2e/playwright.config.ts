import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

/**
 * Playwright config — atlas-e2e harness (Phase 8.2).
 *
 * The surface under test is the BUILT + SERVED production stack behind a
 * same-origin proxy (NOT `next dev` — the strict CSP forbids `unsafe-eval` and
 * the zero-CSP-violation + one-WebSocket assertions are only meaningful against
 * the prod build; the meld/razors-edge/pulse lesson carried in atlas
 * AGENT_NOTES). The topology the `webServer` brings up:
 *
 *   browser ─▶ proxy :3096  (baseURL — the single origin)
 *                ├─ /ws            ─▶ Fastify gateway :3092  (DB-less)
 *                └─ everything else ─▶ Next prod (next start) :3097
 *
 * The same-origin proxy means the client derives its WS same-origin and the
 * strict `connect-src 'self'` CSP covers it — the production posture (ADR-007),
 * verified locally. The Fastify gateway runs DB-LESS (the engine boots from the
 * frozen Porto baseline; the fleet MOVES with no Postgres), so the E2E run needs
 * no docker/Postgres.
 *
 * DETERMINISM: the suite drives the DETERMINISTIC engine — for the geofence
 * beat it clicks the demo affordance ("Play geofence beat", which focuses an
 * approaching vehicle and bumps the demo speed via `sim.control`) and waits on
 * REAL STATE (an event row appears, the ETA decrements), NEVER an arbitrary
 * sleep. Web-first assertions auto-retry, so the specs are robust to the live
 * tick cadence without fixed timeouts.
 *
 * Chromium only — the wow-moment audience (PLAN.md viewer 1) is desktop Chrome.
 * A developer can point at an already-running stack on :3096 (the proxy) via
 * `reuseExistingServer`.
 */

loadDotenv({ path: '.env.test' });

const PROXY_PORT = process.env.ATLAS_PROXY_PORT ?? '3096';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PROXY_PORT}`;
const isCI = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './tests',
  // Serial, single worker: the suite shares ONE live engine (single in-process
  // source of truth, ADR-007) — the demo speed/seek controls affect the WORLD
  // every connection sees, so parallel specs would race the shared sim state.
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 90_000,
  expect: {
    // The live channel ticks ~1 Hz; web-first assertions retry until real state
    // transitions land. Generous so a geofence beat at the demo speed resolves.
    timeout: 20_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Dark is the canonical control-room theme; specs that pin a scheme do so
    // via `contextOptions` / `emulateMedia`.
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    // SwiftShader gives a software WebGL context so MapLibre renders headless.
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Build the web prod bundle first (the CSP-faithful surface), then start the
    // three-process stack (gateway DB-less + Next prod + same-origin proxy).
    command: 'pnpm --filter atlas-web build && node atlas-stack.mjs',
    url: BASE_URL,
    timeout: 240_000,
    reuseExistingServer: !isCI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
