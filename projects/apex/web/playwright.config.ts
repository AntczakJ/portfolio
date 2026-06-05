import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for apex (Phase 7, Task 7.2).
 *
 * Runs against the BUILT + SERVED production surface (`next build && next
 * start`) — NEVER `next dev`, which cannot run under the strict CSP (the
 * `'unsafe-eval'` ban; the meld/razors-edge lesson). The specs assert the
 * PLAN.md critical paths: the reservation happy path end-to-end, the
 * configurator DOM-swatch interaction + the four-tier degradation (Tier-3 no
 * three.js, Tier-4 no-JS), keyboard operation of the date-range picker, the
 * theme toggle, and the `prefers-reduced-motion` hero.
 *
 * Determinism: the app reads a frozen clock (now = 2026-06-15), so the date
 * window, availability, pricing, and the booking reference are byte-stable —
 * the specs do not need to mock time.
 *
 * Port 3091 (an apex-range port, distinct from the 3090 dev/start port so an
 * E2E run never collides with a running dev server, and far from tape's
 * 3000-3061 + razors-edge 3070 + pulse). `webServer` builds then starts;
 * `reuseExistingServer` lets a developer point at an already-running `next
 * start` on 3091 for fast iteration.
 */

const PORT = process.env.APEX_E2E_PORT ?? '3091';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Light is the canonical theme; theme-specific specs override per-context.
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1000 } },
    },
    {
      name: 'mobile-chromium',
      // The Tier-3 fallback profile (mid-tier mobile, no live WebGL).
      use: { ...devices['Pixel 7'] },
      testMatch: /configurator\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm -F apex-web build && pnpm -F apex-web exec next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
