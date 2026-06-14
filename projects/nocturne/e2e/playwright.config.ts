import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Playwright config — nocturne-e2e harness (slot 8, PLAN Phase 7).
 *
 * Reads BASE_URL via a Zod-parsed env loader so a typo or a missing var fails
 * fast at config-load time, not deep inside a `page.goto(undefined)` cascade.
 * The default matches the project's pinned dev/start port (:3100).
 *
 * IMPORTANT — the surface under test is a BUILT + SERVED app, never `next dev`.
 * nocturne ships a strict CSP that forbids `'unsafe-eval'` (ADR-002 §6), and
 * `next dev` cannot run under it (the meld/atrium/apex lesson; nocturne also
 * carries `z.config({ jitless: true })` so the client-reachable Zod parse stays
 * eval-free under that CSP). So the suite runs against
 * `pnpm -F nocturne-web build` then `next start -p 3100` — the same production
 * surface Lighthouse audits. Several assertions (ZERO CSP violations, the live
 * canvas mounting / NOT mounting, the no-FOUC theme) are only meaningful against
 * that production surface.
 *
 * CRITICAL headless constraint (ADR-002, AGENT_NOTES Pass-2): headless chromium
 * here is software-GL (SwiftShader). The live 60fps GPU field CANNOT be
 * meaningfully measured headless, so this suite NEVER asserts frame rate, pixel
 * fidelity, or GPU timing. It covers the deterministic surfaces only: the
 * chrome, the four-tier degradation paths, a11y, SEO, and the audio-graph /
 * store behaviour through the pure layer. The live-field fidelity + 60fps are
 * proven separately (the engine verifier + the real-GPU deploy; the canvas
 * route's perf is documented, not Lighthouse-asserted — the apex precedent).
 *
 * CI sets `NOCTURNE_E2E_TARGET_URL` from the workflow input; the loader treats
 * it as a fallback alias for BASE_URL so the same config drives both local and
 * CI runs.
 *
 * Determinism: the app has no server data and no render-time randomness on the
 * deterministic surfaces (the only `Math.random`-flavoured value, the synth
 * detune, is a seeded mulberry32 — AGENT_NOTES N2, and it lives inside the
 * software-GL canvas path the suite does not assert on). Renders are
 * reproducible without faking a clock. We still pin the runner's locale/timezone
 * for any `Intl` formatting.
 */

// Load .env.test if present so local runs without an exported env work.
loadDotenv({ path: '.env.test' });

const envSchema = z.object({
  BASE_URL: z
    .url('BASE_URL must be a full URL (e.g. http://localhost:3100)')
    .optional(),
  NOCTURNE_E2E_TARGET_URL: z
    .url('NOCTURNE_E2E_TARGET_URL must be a full URL')
    .optional(),
  CI: z.string().optional(),
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`nocturne-e2e env validation failed:\n${issues}`);
}
const env = envResult.data;

const baseURL =
  env.BASE_URL ?? env.NOCTURNE_E2E_TARGET_URL ?? 'http://localhost:3100';

const isCI = env.CI === 'true' || env.CI === '1';

/**
 * Only own the build+serve when targeting the default local port. If the caller
 * pointed BASE_URL / NOCTURNE_E2E_TARGET_URL at an already-running server (a
 * deployed URL or a hand-started one), do not spawn a server — and trust that
 * target to be the production-parity surface.
 */
const ownsServer = !env.BASE_URL && !env.NOCTURNE_E2E_TARGET_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // 1 worker — several specs toggle the persisted next-themes value
  // (localStorage `theme`) and emulate prefers-color-scheme / prefers-
  // reduced-motion per-spec; a single worker keeps that emulation/state from
  // leaking across files. Cheap here (small suite, fast assertions — nothing
  // waits on the slow software-GL field).
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
    // No fixed colorScheme: nocturne's chrome respects prefers-color-scheme
    // (defaultTheme="system"), and the theme spec asserts BOTH light and dark
    // first-load. Specs that need a specific scheme set it via `test.use`.
    locale: 'en-GB',
    timezoneId: 'Europe/Warsaw',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Own the production surface: build, then serve it on :3100 (next start —
  // verified to serve chunks as application/javascript under the strict prod
  // CSP; the standalone-served text/plain caveat in AGENT_NOTES applies only to
  // manually serving the .next/standalone artifact, NOT to `next start`).
  // Skipped when pointing at an external target. `reuseExistingServer` lets a
  // developer keep a hand-started prod server up between runs locally; CI always
  // builds fresh.
  ...(ownsServer
    ? {
        webServer: {
          command:
            'pnpm -F nocturne-web build && pnpm -F nocturne-web exec next start -p 3100',
          url: baseURL,
          timeout: 240_000,
          reuseExistingServer: !isCI,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      }
    : {}),
});
