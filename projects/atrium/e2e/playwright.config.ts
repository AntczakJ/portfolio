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
 * GITHUB_BASE seam — production parity. The repo is now PUBLIC + pushed, and the
 * production build bakes `NEXT_PUBLIC_GITHUB_BASE` (Dockerfile ARG + fly.toml
 * [env]) so `REPO_LINKS_LIVE` is true and the six per-project repo links are live
 * `<a>`s. Next inlines `NEXT_PUBLIC_*` at BUILD time, so to make the local E2E
 * surface match production this config OWNS the build+serve via `webServer`,
 * baking the same `NEXT_PUBLIC_GITHUB_BASE` into the build. Without this the
 * local build would default to the placeholder base (`REPO_LINKS_LIVE` false) and
 * the suite would test the pre-flip code path that no longer ships. When a
 * `BASE_URL`/`ATRIUM_E2E_TARGET_URL` points at an already-running server (a
 * deployed URL, or a manually started one), `webServer` is skipped — that target
 * is assumed to be the production-parity surface already (the live Fly app is).
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

/**
 * The production GitHub base — kept in lockstep with `fly.toml [env]` /
 * the Dockerfile ARG. Baked into the E2E build so `REPO_LINKS_LIVE` is true and
 * the served app matches production. (Re-stated here rather than imported from
 * the helpers because the config is loaded in a separate process context — same
 * reason `helpers/env.ts` duplicates the BASE_URL resolver.)
 */
const GITHUB_BASE = 'https://github.com/AntczakJ/portfolio';

/**
 * Only own the build+serve when targeting the default local port. If the caller
 * pointed BASE_URL / ATRIUM_E2E_TARGET_URL at an already-running server (a
 * deployed URL or a hand-started one), do not spawn a server — and trust that
 * target to be the production-parity surface.
 */
const ownsServer = !env.BASE_URL && !env.ATRIUM_E2E_TARGET_URL;

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
  // Own the production surface: build with the GITHUB_BASE seam flipped (so
  // REPO_LINKS_LIVE is true, matching production), then serve it on :3080. Next
  // inlines NEXT_PUBLIC_* at BUILD time, so the env must be present for `build`,
  // not just `start` — `webServer.env` applies to the whole command's process,
  // which runs the build, so it is. Skipped when pointing at an external target.
  // `reuseExistingServer` lets a developer keep a hand-started prod server up
  // between runs locally; CI always builds fresh.
  ...(ownsServer
    ? {
        webServer: {
          command:
            'pnpm -F atrium-web build && pnpm -F atrium-web start',
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: !isCI,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: {
            NEXT_PUBLIC_GITHUB_BASE: GITHUB_BASE,
          },
        },
      }
    : {}),
});
