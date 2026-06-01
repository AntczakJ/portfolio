/**
 * Public client-side environment variables.
 *
 * Validated with light defaults so a missing .env does not break the
 * landing page — the eventual presence pill (Phase 3.3) will show
 * "Offline" instead of a blank error.
 *
 * In v2 production deploy, `apiUrl` and `wsUrl` collapse to the same
 * hostname behind a Hono catch-all reverse proxy (matches tape's
 * Phase 6 pattern); the WS upgrade and HTTP control routes share an
 * origin which keeps the server's MELD_ALLOWED_ORIGINS allowlist
 * tight to one value.
 */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001',
} as const;
