/**
 * Ambient typings for `process.env` lookups inside the Playwright specs +
 * helpers. The Zod-parsed env loader in `playwright.config.ts` validates and
 * narrows the runtime read path; this file exists so the IDE surfaces the keys
 * at intellisense without diving into the loader.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    BASE_URL?: string;
    NOCTURNE_E2E_TARGET_URL?: string;
    CI?: string;
    PWDEBUG?: string;
  }
}
