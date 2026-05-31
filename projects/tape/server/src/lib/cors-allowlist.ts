/**
 * CORS allowlist — Phase 6 deploy hardening.
 *
 * The reviewer flagged `cors()` with no options (which returns
 * `Access-Control-Allow-Origin: *`) as the single biggest production
 * risk before the first deploy. This module resolves an explicit
 * allowlist from the `ALLOWED_ORIGINS` env var (comma-separated) and
 * exposes a predicate the `@elysiajs/cors` plugin consumes via its
 * `origin: (request) => boolean` callback API.
 *
 * Defaults policy:
 *
 *   - **Development** (`NODE_ENV !== 'production'`): localhost on the
 *     four ports the project actually uses — 3000 (web canonical),
 *     3001 (server canonical, sometimes also web on port-collision),
 *     3002 (web fallback when both are taken), 3003 (rare next
 *     fallback). Covers the owner's "everything is open" laptop
 *     workflow without a `.env` override.
 *
 *   - **Production** (`NODE_ENV === 'production'`): NO fallback list.
 *     If `ALLOWED_ORIGINS` is unset, the predicate denies every
 *     cross-origin request — same-origin requests do NOT carry an
 *     `Origin` header in most browsers (they do for `fetch` from a
 *     different scheme; not for navigation), and the CORS plugin
 *     does not gate same-origin traffic anyway, so the demo URL
 *     keeps working under "missing env" while every external origin
 *     is denied. The bootstrap path logs a WARN so the
 *     misconfiguration surfaces.
 *
 * Request-origin matching is exact case-sensitive string equality
 * against the allowlist. Scheme + host + port must all match — a
 * request from `http://tape-demo.fly.dev` (no https) is NOT covered
 * by an allowlist entry of `https://tape-demo.fly.dev`. This is
 * intentional: every demo URL on Fly.io is HTTPS-forced via
 * `fly.toml`, so an http origin pointing at it is a misconfiguration
 * we should reject.
 *
 * v2 caveat: this is a flat allowlist with no wildcard support. If
 * the demo grows preview deployments (`pr-123.tape-demo.fly.dev`)
 * the right move is a regex predicate, not a longer comma list.
 * Document the change in an ADR — wildcard CORS is the canonical
 * source of "I left it open and forgot" production incidents.
 */

const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
] as const;

export interface CORSAllowlistOptions {
  /**
   * Override `process.env.ALLOWED_ORIGINS`. Tests use this so they
   * do not perturb the live env. Production callers should not.
   */
  envOverride?: string | undefined;
  /**
   * Override `process.env.NODE_ENV`. Tests use this. Production
   * callers should not.
   */
  modeOverride?: string | undefined;
}

export interface CORSAllowlistResult {
  /** The resolved allowlist. Empty in production-with-no-env. */
  origins: readonly string[];
  /**
   * Reason the allowlist resolved as it did. Logged at boot so the
   * source of the policy is visible without trial-and-error.
   */
  source: 'env' | 'dev-default' | 'production-empty';
  /** True if production mode resolved an empty allowlist. */
  productionMissingEnv: boolean;
}

export function resolveCORSAllowlist(
  options: CORSAllowlistOptions = {},
): CORSAllowlistResult {
  const env = options.envOverride ?? process.env.ALLOWED_ORIGINS;
  const mode = options.modeOverride ?? process.env.NODE_ENV;

  if (env !== undefined && env.trim() !== '') {
    const origins = env
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      origins,
      source: 'env',
      productionMissingEnv: false,
    };
  }

  if (mode === 'production') {
    return {
      origins: [],
      source: 'production-empty',
      productionMissingEnv: true,
    };
  }

  return {
    origins: [...DEV_DEFAULT_ORIGINS],
    source: 'dev-default',
    productionMissingEnv: false,
  };
}

/**
 * Build the `origin` predicate the `@elysiajs/cors` plugin consumes.
 *
 * Returning `true` permits the origin; `false` denies. The plugin's
 * type signature also tolerates `void`, but we always return a
 * boolean so the policy is explicit at the call site.
 *
 * Requests with no `Origin` header (same-origin navigations,
 * non-browser clients) bypass this predicate at the plugin level —
 * the plugin only invokes the callback for cross-origin requests.
 */
export function buildOriginPredicate(
  allowlist: readonly string[],
): (request: Request) => boolean {
  const set = new Set(allowlist);
  return (request: Request): boolean => {
    const origin = request.headers.get('origin');
    if (origin === null) return false;
    return set.has(origin);
  };
}
