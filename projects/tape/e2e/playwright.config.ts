import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — tape-e2e harness (Phase 5.3 + 5.5).
 *
 * **Determinism over a live backend.** The CI-gated specs do NOT need
 * the Elysia server, Postgres, or the Rust worker. They drive the
 * Canvas2D chart through two deterministic seams:
 *   1. the dev-only `window.__tapeStore` snapshot-injection hook
 *      (`src/lib/stores/stream-store.ts`, gated on
 *      `NODE_ENV === 'development'`), and
 *   2. `page.routeWebSocket` to stand in for `/ws/stream` so the
 *      connection-state transitions (`connecting → connected`) fire
 *      against a controlled mock rather than a real socket.
 *
 * Because of this, the config auto-starts `tape-web` in DEV mode (the
 * `__tapeStore` global is dead-code-eliminated in a production build)
 * via the `webServer` block — no Docker, no `pnpm -F tape dev` server
 * half. `NEXT_PUBLIC_WS_URL` is pointed at an unreachable port so that,
 * in any spec that does NOT install a WS route, the live provider sits
 * quietly in `connecting`/`reconnecting` backoff instead of erroring.
 *
 * The single `@live` spec hits a REAL `/ws/stream` and is skipped
 * unless `TAPE_E2E_LIVE=1` (it requires the offline synth→worker
 * pipeline to be up — see the e2e README run recipe).
 *
 * BASE_URL resolution: BASE_URL → TAPE_E2E_TARGET_URL (CI alias) →
 * the dev port the `webServer` block boots. A Zod parse fails fast on a
 * malformed URL instead of cascading into `page.goto(undefined)`.
 *
 * Browser projects: chromium only. The wow-moment audience (PLAN.md)
 * is desktop Chrome first, the load test measures Chrome's rAF cadence,
 * and CI budget stays tight. Firefox/WebKit can be added behind a CLI
 * flag if a deploy-validation pass reveals an engine-specific path.
 */

loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .url('BASE_URL must be a full URL (e.g. http://localhost:3000)')
    .optional(),
  TAPE_E2E_TARGET_URL: z
    .url('TAPE_E2E_TARGET_URL must be a full URL')
    .optional(),
  WS_BASE_URL: z.string().optional(),
  TAPE_E2E_LIVE: z.string().optional(),
  TAPE_E2E_WEB_SERVER: z.string().optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`tape-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

/** Port the auto-started dev server listens on. Kept off 3000/3001 to
 *  avoid colliding with a hand-started tape-web (3000) or the dev server
 *  half (3001) the owner runs locally. */
const WEB_PORT = '3210';
/** Deliberately-dead WS port so the live provider never opens a real
 *  socket in deterministic specs (they mock it via routeWebSocket). */
const DEAD_WS_PORT = '39999';

const baseURL =
  env.BASE_URL ?? env.TAPE_E2E_TARGET_URL ?? `http://localhost:${WEB_PORT}`;

const isCI = env.CI === 'true' || env.CI === '1';
// Auto-start the dev server unless explicitly disabled or a BASE_URL /
// CI target override is in play (then the server is assumed external).
const startWebServer =
  env.TAPE_E2E_WEB_SERVER !== '0' &&
  env.BASE_URL === undefined &&
  env.TAPE_E2E_TARGET_URL === undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // 1 worker — the load test (5.5) is timing-sensitive and must not
  // contend for the CPU with a parallel spec, and the deterministic
  // specs share one mock-WS contract per page so isolation is per-test.
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // tape defaults to dark (next-themes defaultTheme="system"); the
    // theme spec pins schemes via page.emulateMedia. Pin light here so
    // `system` resolves deterministically for the non-theme specs.
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  // `exactOptionalPropertyTypes` forbids `webServer: undefined`, so the
  // key is spread in only when the auto-start is wanted.
  ...(startWebServer
    ? {
        webServer: {
          // Run the dev server (NOT a production build) so the
          // `__tapeStore` dev hook is present. Filter to the tape-web
          // package from the repo root.
          command: `pnpm -F tape-web exec next dev -p ${WEB_PORT}`,
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: {
            // Point the live WS at a dead port so the provider does not
            // error against a missing backend in deterministic specs.
            NEXT_PUBLIC_WS_URL: `ws://127.0.0.1:${DEAD_WS_PORT}`,
            NEXT_PUBLIC_API_URL: `http://127.0.0.1:${DEAD_WS_PORT}`,
          },
        },
      }
    : {}),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
