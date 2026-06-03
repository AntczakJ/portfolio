/**
 * Shared env access for helpers. Mirrors `playwright.config.ts`'s resolution
 * rule:
 *
 *   1. `BASE_URL` (canonical local + override)
 *   2. `RAZORS_EDGE_E2E_TARGET_URL` (CI input)
 *   3. fallback `http://localhost:3070`
 *
 * Helpers cannot import from `playwright.config.ts` (Playwright loads the
 * config in a different process context), so a small duplicated resolver here
 * keeps the values consistent without runtime-import gymnastics.
 */
export function baseUrl(): string {
  return (
    process.env.BASE_URL ??
    process.env.RAZORS_EDGE_E2E_TARGET_URL ??
    'http://localhost:3070'
  );
}
