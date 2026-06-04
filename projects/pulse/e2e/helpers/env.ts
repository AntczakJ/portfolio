/**
 * Shared env access for helpers. Mirrors `playwright.config.ts`'s resolution
 * rule (helpers cannot import the config — Playwright loads it in a different
 * process context, so a small duplicated resolver keeps the values consistent):
 *
 *   1. `BASE_URL`              (canonical local + override; the Next web origin)
 *   2. `PULSE_E2E_TARGET_URL`  (CI workflow_dispatch input)
 *   3. fallback `http://localhost:3081`
 */
export function baseUrl(): string {
  return (
    process.env.BASE_URL ??
    process.env.PULSE_E2E_TARGET_URL ??
    'http://localhost:3081'
  );
}

/**
 * The NestJS API origin. Local dev splits web (:3081) from the API (:3080);
 * the deployed topology proxies the API under the web origin (ADR-006), so this
 * falls back to BASE_URL when `API_BASE_URL` is unset.
 */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3080';
}

/** The seeded public status page slug (ADR-007 demo page). */
export function demoStatusSlug(): string {
  return process.env.DEMO_STATUS_SLUG ?? 'demo';
}
