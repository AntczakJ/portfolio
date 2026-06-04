import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — pulse-e2e harness (Phase 8.2).
 *
 * The surface under test is the BUILT + SERVED production stack (NOT `next
 * dev` — the strict CSP forbids `unsafe-eval` and the zero-CSP-violation
 * assertions are only meaningful against the prod build, the meld/razors-edge
 * lesson carried in pulse AGENT_NOTES). Local defaults match the documented
 * split:
 *
 *   - pulse-web (Next)        on :3081
 *   - pulse-server (NestJS)   on :3080   (web process + worker process)
 *   - Postgres :5437 + Redis :6381 via docker-compose
 *
 * CI sets `PULSE_E2E_TARGET_URL` from the workflow_dispatch input; the loader
 * treats it as a fallback alias for BASE_URL so the same config drives both
 * local and CI runs.
 *
 * Reads env via a Zod-parsed loader so a typo or missing var fails fast at
 * config-load time, not deep inside a `page.goto(undefined)` cascade.
 *
 * Timing robustness: the live board reacts to REAL probes (intentionally
 * non-deterministic) and the demo-incident arc takes ~30-45 s through the
 * genuine pipeline, so the suite waits on REAL STATE (incident open/close,
 * card status) rather than fixed sleeps, and runs serially with one worker so
 * the shared seeded demo workspace is not raced by parallel mutations. The
 * demo-arc test carries a longer timeout (its `test.setTimeout`).
 *
 * Chromium only — the wow-moment audience (PLAN.md viewer 1) is desktop Chrome,
 * and the project reuses the already-installed chromium.
 */

loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .string()
    .url('BASE_URL must be a full URL (e.g. http://localhost:3081)')
    .optional(),
  PULSE_E2E_TARGET_URL: z
    .string()
    .url('PULSE_E2E_TARGET_URL must be a full URL')
    .optional(),
  API_BASE_URL: z.string().url().optional(),
  DEMO_STATUS_SLUG: z.string().optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`pulse-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

const baseURL =
  env.BASE_URL ?? env.PULSE_E2E_TARGET_URL ?? 'http://localhost:3081';

const isCI = env.CI === 'true' || env.CI === '1';

export default defineConfig({
  testDir: './tests',
  // Serial, single worker: the suite shares ONE seeded demo workspace and
  // creates real auth sessions / monitors; parallel workers would race the
  // shared backend state and the single SSE-backed live board.
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  // The demo-incident arc runs through the real pipeline (~30-45 s); the per-
  // test default is generous, and the arc test raises it further locally.
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    actionTimeout: 12_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The board + public page render a sovereign palette; light is the SSR
    // default. Tests that pin a scheme do so via `emulateMedia`.
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
