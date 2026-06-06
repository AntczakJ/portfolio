/**
 * Ambient typings for the `process.env` lookups in the Playwright config +
 * helpers. The atlas-e2e stack is driven entirely by ports (the proxy origin is
 * the single target) — these document the override knobs:
 *
 *   - BASE_URL           the single proxy origin under test (default :3096)
 *   - ATLAS_PROXY_PORT   the same-origin proxy port (default 3096)
 *   - ATLAS_WEB_PORT     the Next prod `next start` port (default 3097)
 *   - ATLAS_WS_PORT      the Fastify gateway port (default 3092)
 *   - CI                 set in CI to enable retries + forbidOnly
 */
declare namespace NodeJS {
  interface ProcessEnv {
    BASE_URL?: string;
    ATLAS_PROXY_PORT?: string;
    ATLAS_WEB_PORT?: string;
    ATLAS_WS_PORT?: string;
    CI?: string;
    PWDEBUG?: string;
  }
}
