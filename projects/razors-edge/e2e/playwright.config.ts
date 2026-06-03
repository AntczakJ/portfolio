import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — razors-edge-e2e harness (Phase 6, Task 6.2).
 *
 * Reads BASE_URL via a Zod-parsed env loader so a typo or a missing var fails
 * fast at config-load time, not deep inside a `page.goto(undefined)` cascade.
 * The default matches the project's pinned dev/prod port (:3070).
 *
 * IMPORTANT — the surface under test is a BUILT + SERVED app, never `next
 * dev`. The project ships a strict CSP that forbids `unsafe-eval`, and
 * `next dev` cannot run under it (the meld lesson, carried in razors-edge
 * AGENT_NOTES). So the suite is run against `pnpm -F razors-edge-web build`
 * then `next start -p 3070` — the same production surface Lighthouse audits.
 * Several assertions (ZERO CSP violations, GSAP-hydrated landing) are only
 * meaningful against that production surface.
 *
 * CI sets `RAZORS_EDGE_E2E_TARGET_URL` from the workflow input; the loader
 * treats it as a fallback alias for BASE_URL so the same config drives both
 * local and CI runs.
 *
 * Determinism: the app pins a frozen `now` (2026-06-10 11:00 Europe/Warsaw)
 * via `src/lib/clock.ts`, so the date strip + availability grid are stable
 * across runs without the test needing to fake the clock. We still pin the
 * runner's timezone + locale so any client-side `Intl` formatting the tests
 * read is reproducible.
 */

// Load .env.test if present so local runs without an exported env work.
loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .string()
    .url('BASE_URL must be a full URL (e.g. http://localhost:3070)')
    .optional(),
  RAZORS_EDGE_E2E_TARGET_URL: z
    .string()
    .url('RAZORS_EDGE_E2E_TARGET_URL must be a full URL')
    .optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`razors-edge-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

const baseURL =
  env.BASE_URL ?? env.RAZORS_EDGE_E2E_TARGET_URL ?? 'http://localhost:3070';

const isCI = env.CI === 'true' || env.CI === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // 1 worker — the booking wizard persists its draft to localStorage; a
  // single worker plus per-test storage clearing keeps the persisted machine
  // from leaking state between specs. (Each spec also clears storage in a
  // beforeEach, so this is belt-and-braces, not the sole guard.)
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
    // Dark is the canonical theme + the default the site ships; tests that
    // assert the light register emulate `colorScheme: 'light'` per-test.
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
