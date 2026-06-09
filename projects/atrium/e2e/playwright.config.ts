import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — atrium-e2e harness (Phase 6, Task 6.2).
 *
 * Reads BASE_URL via a Zod-parsed env loader so a typo or a missing var fails
 * fast at config-load time, not deep inside a `page.goto(undefined)` cascade.
 * The default matches the project's pinned dev/prod port (:3080).
 *
 * IMPORTANT — the surface under test is a BUILT + SERVED app, never `next dev`.
 * atrium ships a strict CSP that forbids `unsafe-eval`, and `next dev` cannot
 * run under it (the meld lesson, carried in atrium AGENT_NOTES; atrium also had
 * to add `z.config({ jitless: true })` so the client-reachable Zod parse stays
 * eval-free under that CSP). So the suite runs against
 * `pnpm -F atrium-web build` then `next start -p 3080` — the same production
 * surface Lighthouse audits. Several assertions (ZERO CSP violations,
 * GSAP-hydrated descent, the reduced-motion `matchMedia` branch) are only
 * meaningful against that production surface.
 *
 * CI sets `ATRIUM_E2E_TARGET_URL` from the workflow input; the loader treats it
 * as a fallback alias for BASE_URL so the same config drives both local and CI
 * runs.
 *
 * Determinism: the app has no runtime randomness (no `Date.now()`/`Math.random()`
 * in render — the data is six fixed entries with a fixed `year`), so renders are
 * reproducible without faking a clock. We still pin the runner's locale/timezone
 * for any `Intl` formatting.
 */

// Load .env.test if present so local runs without an exported env work.
loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .url('BASE_URL must be a full URL (e.g. http://localhost:3080)')
    .optional(),
  ATRIUM_E2E_TARGET_URL: z
    .url('ATRIUM_E2E_TARGET_URL must be a full URL')
    .optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`atrium-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

const baseURL =
  env.BASE_URL ?? env.ATRIUM_E2E_TARGET_URL ?? 'http://localhost:3080';

const isCI = env.CI === 'true' || env.CI === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // 1 worker — the suite toggles the persisted next-themes value (localStorage
  // `theme`) and emulates reduced-motion per-spec; a single worker keeps that
  // emulation/state from leaking across files. Cheap here (small suite).
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
    // Dark is the canonical theme + the default the site ships; the theme spec
    // emulates light per-test.
    colorScheme: 'dark',
    locale: 'en-GB',
    timezoneId: 'Europe/Warsaw',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
