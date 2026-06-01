import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — meld-e2e harness.
 *
 * Reads BASE_URL via a Zod-parsed env loader so a typo or missing var
 * fails fast at config-load time, not deep inside a `page.goto(undefined)`
 * cascade. Defaults match the local dev split:
 *
 *   - meld-web on :3055
 *   - meld-server on :3099
 *
 * CI sets `MELD_E2E_TARGET_URL` from the workflow_dispatch input
 * (ADR-007 trigger model); the loader treats it as a fallback alias
 * for BASE_URL so the same config drives both local and CI runs.
 *
 * Browser projects: chromium primary + firefox secondary. CI runs
 * chromium only to keep the GHA budget at ~5 hours/mo per ADR-007's
 * napkin math. Local cross-browser is `pnpm -F meld-e2e test
 * --project=firefox`.
 *
 * No `webkit` in the matrix — Playwright's WebKit is a Linux build,
 * not Safari, and the wow moment audience (PLAN.md) targets desktop
 * Chrome first. WebKit can be re-added behind a CLI flag if Phase 6
 * deploy validation reveals a Safari-specific path.
 */

// Load .env.test if present so local runs without env-export work.
// `path` defaults to '.env' which we DO NOT want to clobber a higher-
// scope file; explicit '.env.test' keeps the harness self-contained.
loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .string()
    .url('BASE_URL must be a full URL (e.g. http://localhost:3055)')
    .optional(),
  MELD_E2E_TARGET_URL: z
    .string()
    .url('MELD_E2E_TARGET_URL must be a full URL')
    .optional(),
  WS_BASE_URL: z.string().optional(),
  API_BASE_URL: z.string().url().optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`meld-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

const baseURL =
  env.BASE_URL ?? env.MELD_E2E_TARGET_URL ?? 'http://localhost:3055';

const isCI = env.CI === 'true' || env.CI === '1';

export default defineConfig({
  testDir: './tests',
  // Test files share the suite via globals registered by Playwright
  // test runner — no `globalSetup` in v1 (each test self-mints
  // identity via the cookie roundtrip).
  fullyParallel: false,
  // 1 worker keeps the 9 sequential cases in lockstep with ADR-007's
  // B5 pick (single-job sequential). Two-context tests open two
  // contexts inside ONE worker — no shared browser-instance leakage.
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
    // The board route renders a sovereign palette — color-scheme is
    // light by default, dark via the theme toggle. Tests that pin a
    // scheme do so via `page.emulateMedia({ colorScheme: 'dark' })`.
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
