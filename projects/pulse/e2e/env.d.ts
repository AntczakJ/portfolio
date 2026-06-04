/**
 * Ambient typings for `process.env` lookups inside the Playwright specs +
 * helpers. The Zod-parsed env loader in `playwright.config.ts` narrows these
 * to non-undefined for the runtime read path; this file exists so the IDE
 * shows the keys at intellisense without diving into the loader.
 *
 *   - BASE_URL              the Next web origin under test (default :3081)
 *   - API_BASE_URL          the NestJS API origin (default :3080); falls back to
 *                           BASE_URL in the single-origin proxied deploy
 *   - PULSE_E2E_TARGET_URL  the CI workflow_dispatch input alias for BASE_URL
 *   - DEMO_STATUS_SLUG      the seeded public status page slug (default `demo`)
 */
declare namespace NodeJS {
  interface ProcessEnv {
    BASE_URL?: string;
    API_BASE_URL?: string;
    PULSE_E2E_TARGET_URL?: string;
    DEMO_STATUS_SLUG?: string;
    CI?: string;
    PWDEBUG?: string;
  }
}
