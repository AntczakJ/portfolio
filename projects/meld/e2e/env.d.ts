/**
 * Ambient typings for `process.env` lookups inside the Playwright
 * specs + helpers. The Zod-parsed env loader in `playwright.config.ts`
 * narrows these to non-undefined for the runtime read path; this file
 * exists so the IDE shows the keys at intellisense without diving into
 * the loader.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    BASE_URL?: string;
    WS_BASE_URL?: string;
    API_BASE_URL?: string;
    MELD_E2E_TARGET_URL?: string;
    CI?: string;
    PWDEBUG?: string;
  }
}
