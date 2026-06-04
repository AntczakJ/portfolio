/**
 * Ambient typings for `process.env` lookups inside the Playwright
 * specs + helpers. The Zod-parsed env loader in `playwright.config.ts`
 * narrows these for the runtime read path; this file exists so the IDE
 * surfaces the keys at intellisense without diving into the loader.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Full origin of tape-web under test (e.g. http://localhost:3000). */
    BASE_URL?: string;
    /** ADR-compatible CI alias for BASE_URL set by the GHA workflow. */
    TAPE_E2E_TARGET_URL?: string;
    /**
     * WS base origin for the @live spec (the BASE, no /ws/stream path —
     * the provider appends it). Only read by the live spec.
     */
    WS_BASE_URL?: string;
    /**
     * Set to '1' to run the @live spec against a real running pipeline.
     * Default: the @live spec is skipped (no Docker dependency in CI).
     */
    TAPE_E2E_LIVE?: string;
    /**
     * Set to '0' to disable the auto-started dev `webServer` (used when
     * pointing BASE_URL at an already-running server or a deployed URL).
     */
    TAPE_E2E_WEB_SERVER?: string;
    CI?: string;
    PWDEBUG?: string;
  }
}
