/**
 * Shared env access for helpers — mirrors `playwright.config.ts`'s
 * resolution rule (helpers cannot import the config; Playwright loads it
 * in a separate process context, so a small duplicated resolver keeps
 * the values consistent).
 */
const WEB_PORT = 3210;

export function baseUrl(): string {
  return (
    process.env.BASE_URL ??
    process.env.TAPE_E2E_TARGET_URL ??
    `http://localhost:${String(WEB_PORT)}`
  );
}

/** WS base origin for the @live spec. Derived from BASE_URL when unset. */
export function wsBaseUrl(): string {
  if (process.env.WS_BASE_URL !== undefined) return process.env.WS_BASE_URL;
  const base = baseUrl();
  if (base.startsWith('https://')) {
    return `wss://${base.slice('https://'.length)}`;
  }
  if (base.startsWith('http://')) {
    return `ws://${base.slice('http://'.length)}`;
  }
  return base;
}

/** True when the @live spec should run (a real pipeline is up). */
export function liveEnabled(): boolean {
  return process.env.TAPE_E2E_LIVE === '1';
}
