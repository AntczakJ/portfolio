/**
 * Shared env access for helpers. Mirrors `playwright.config.ts`'s
 * resolution rule:
 *
 *   1. `BASE_URL` (canonical local + override)
 *   2. `MELD_E2E_TARGET_URL` (ADR-007 CI input)
 *   3. fallback `http://localhost:3055`
 *
 * Helpers cannot import from `playwright.config.ts` because Playwright
 * loads the config in a different process context. A small duplicated
 * resolver here keeps the values consistent without a runtime import
 * gymnastics.
 */
export function baseUrl(): string {
  return (
    process.env.BASE_URL ??
    process.env.MELD_E2E_TARGET_URL ??
    'http://localhost:3055'
  );
}

/**
 * API base URL — falls back to BASE_URL when undefined (production
 * single-origin path). Local dev splits the two.
 */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? baseUrl();
}

/**
 * WebSocket base URL — derived from BASE_URL when `WS_BASE_URL` is
 * absent. Production: `wss://meld-demo.fly.dev`. Local: `ws://localhost:3099`.
 */
export function wsBaseUrl(): string {
  if (process.env.WS_BASE_URL !== undefined) return process.env.WS_BASE_URL;
  const base = baseUrl();
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`;
  return base;
}
