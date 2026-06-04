import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Pulse — Next 15 config.
 *
 * `output: 'standalone'` lets the future deploy (ADR-006, the separate
 * `pulse-web` Fly app proxying `pulse-api`) emit a minimal
 * `.next/standalone/server.js` with the exact `node_modules` subset
 * the runtime needs.
 *
 * `outputFileTracingRoot` is pinned to the pulse PROJECT root (one hop
 * up from `web/` — `projects/pulse/`), NOT the workspace root. The meld
 * Phase 6 incident is the source: pinning the trace too high drags the
 * whole workspace `node_modules` into the standalone trace (a multi-GB
 * image). We resolve via `fileURLToPath(new URL('../', import.meta.url))`
 * and NOT `new URL(...).pathname`, because on Windows `.pathname` yields
 * `/C:/Portfolio/projects/pulse/` which Next's tracer treats as a Unix
 * path and silently skips the standalone emit (the meld Windows
 * standalone fix). The try/catch falls back to `.pathname` only for
 * non-`file:` evaluation contexts (e.g. Vitest importing this module to
 * assert the header set — see `src/__tests__/next-config-headers.test.ts`).
 *
 * Security headers (mirroring the meld / razors-edge reviewer set) ship
 * over EVERY route via the catch-all `/(.*)` source:
 *
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` — the load-bearing guarantee
 *     is **no `'unsafe-eval'`**. The Pulse browser surface (Motion
 *     micro-interactions, the future uPlot canvas charts, and the
 *     SSE/Zod-envelope validation path) must run clean under it; uPlot
 *     is plain canvas (no eval), Motion does not eval, and Zod 4's JIT
 *     `new Function` probe is opted out globally via
 *     `z.config({ jitless: true })` (see `src/lib/zod-config.ts`) so the
 *     no-`unsafe-eval` posture holds even though the live SSE board
 *     validates events at runtime (the razors-edge fix carried forward).
 *     `'unsafe-inline'` for scripts is the honest meld lesson: Next 15
 *     emits its hydration bootstrap + the next-themes flash-guard as
 *     UNHASHED inline `<script>` elements that a bare `script-src 'self'`
 *     blocks, which kills hydration. v1.1 hardening = per-request nonce
 *     middleware + drop `'unsafe-inline'` for scripts (documented as debt
 *     in AGENT_NOTES.md). `style-src 'self' 'unsafe-inline'` covers
 *     Tailwind's emitted inline style attributes + Motion's inline
 *     `style` writes. `connect-src 'self'` allows same-origin fetch + the
 *     `EventSource` SSE stream — in the deployed topology (ADR-006)
 *     `pulse-web` reverse-proxies `pulse-api` so the API and the SSE
 *     stream are same-origin; the meld single-origin proxy precedent.
 *     `img-src 'self' data:` covers favicons + inline SVG status dots /
 *     sparklines + the future `next/og` OG image. `font-src 'self'`
 *     covers the self-hosted `next/font` faces. `frame-ancestors 'none'`
 *     mirrors `X-Frame-Options: DENY`. `base-uri 'self'` blocks `<base>`
 *     injection. `form-action 'self'` keeps the create-monitor + auth
 *     POSTs same-origin.
 *   - `X-Content-Type-Options: nosniff` — no MIME-sniff.
 *   - `Referrer-Policy: strict-origin-when-cross-origin`.
 *   - `X-Frame-Options: DENY` — no iframe-embed use case in v1.
 *   - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
 *     — Fly.io canonical (2-year HSTS + subdomain coverage); Fly
 *     terminates TLS at the edge and forwards `X-Forwarded-Proto: https`.
 *
 * NOTE on `connect-src` (dev vs prod — the load-bearing SSE detail): the
 * board's `EventSource` and the dashboard fetches target the API origin
 * (`NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SSE_URL`). In the DEPLOYED topology
 * (ADR-006) `pulse-web` reverse-proxies `pulse-api`, so both collapse to
 * SAME-ORIGIN and `connect-src 'self'` is sufficient — the production
 * posture. In LOCAL DEV (and a hypothetical split-origin deploy) the API is
 * a DISTINCT origin (`http://localhost:3080`), which a bare `'self'`
 * `connect-src` would block — the board could not connect and the wow
 * moment would be dead. So `connect-src` is computed from the configured
 * API + SSE origins: `'self'` plus any origin that is NOT same-as-site.
 * When the env points at the same origin (the proxy deploy), nothing is
 * added and the policy is exactly `connect-src 'self'`. This is the only
 * directive that varies by environment, and it never widens beyond the
 * explicitly-configured API origin — it is not a blanket wildcard.
 */

/**
 * Compute the `connect-src` allowlist. Always includes `'self'`; adds the
 * distinct ORIGIN (scheme + host + port, no path) of the API and SSE URLs
 * when they differ from the site origin. Falls back to `'self'`-only if the
 * env vars are unset (the production single-origin proxy default).
 */
function connectSrc(): string {
  const sources = new Set<string>(["'self'"]);
  const candidates = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_SSE_URL,
  ];
  const siteOrigin = (() => {
    try {
      return process.env.NEXT_PUBLIC_SITE_URL
        ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin
        : null;
    } catch {
      return null;
    }
  })();
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const { origin } = new URL(raw);
      if (origin !== siteOrigin) {
        sources.add(origin);
      }
    } catch {
      // ignore an unparseable env value — keep `'self'`
    }
  }
  return Array.from(sources).join(' ');
}

/**
 * Reverse-proxy the API paths to pulse-api (ADR-006, the single-origin posture).
 *
 * In the deployed topology pulse-web and pulse-api are SEPARATE Fly apps, but
 * the browser must see ONE origin so the dashboard `EventSource` SSE stream
 * carries the better-auth session cookie first-party (ADR-003/ADR-007) and the
 * strict CSP `connect-src 'self'` holds. We achieve that by rewriting the NestJS
 * route prefixes through the Next server to `API_PROXY_TARGET` (pulse-api's
 * internal Fly address, e.g. `http://pulse-api.internal:3080`) — the meld
 * Next-proxies-API precedent.
 *
 * The proxied prefixes are EXACTLY the NestJS surface (the server has no global
 * `/api` prefix — only the SSE + auth routes live under `/api`; the rest are
 * top-level): `/api/*` (SSE stream + better-auth), `/public/*` (public read +
 * public SSE), `/demo/*` (the wow trigger), `/monitors*`, `/incidents*`,
 * `/alert-channels*`, and `/health`. Next must NOT own any of these route
 * segments itself (it does not — the app routes are `/`, `/dashboard/*`,
 * `/status/[slug]`), so there is no collision.
 *
 * `API_PROXY_TARGET` is a SERVER-side env (no NEXT_PUBLIC_ prefix). Next
 * evaluates `rewrites()` at BUILD time and bakes the destination string into the
 * routing manifest, so this is a BUILD-TIME value (Dockerfile.web ARG), not a
 * per-request runtime read. In LOCAL dev it is unset, so these rewrites are
 * inert and the browser talks to the API cross-origin via NEXT_PUBLIC_API_URL
 * (the two-port dev loop). Only the deployed image bakes it.
 *
 * SSE NOTE (load-bearing): Next's rewrite proxy STREAMS the upstream response
 * body (it does not buffer `text/event-stream`), so the long-lived SSE
 * connection on `/api/stream` flows through the rewrite intact. The 15 s
 * heartbeat (ADR-003) keeps it under the Fly edge idle timeout; the immediate
 * `: connected` comment flushes proxy headers. Verified posture mirrors meld's
 * catch-all proxy (which additionally strips transport-encoding headers — Next's
 * rewrite handles that internally).
 */
const apiProxyTarget = process.env.API_PROXY_TARGET;
const PROXY_PREFIXES = [
  '/api/:path*',
  '/public/:path*',
  '/demo/:path*',
  '/monitors/:path*',
  '/monitors',
  '/incidents/:path*',
  '/incidents',
  '/alert-channels/:path*',
  '/alert-channels',
  '/health',
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  rewrites() {
    if (!apiProxyTarget) {
      // Local dev (and any split-origin deploy): no proxy. The browser reaches
      // the API directly via NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SSE_URL.
      return Promise.resolve([]);
    }
    const target = apiProxyTarget.replace(/\/$/, '');
    return Promise.resolve(
      PROXY_PREFIXES.map((source) => ({
        source,
        destination: `${target}${source}`,
      })),
    );
  },
  outputFileTracingRoot: (() => {
    try {
      return fileURLToPath(new URL('../', import.meta.url));
    } catch {
      return new URL('../', import.meta.url).pathname;
    }
  })(),
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [],
  },
  // Non-async (no awaited work) but returns a Promise to satisfy Next's
  // `headers` config type without an unnecessary `async`.
  headers() {
    return Promise.resolve([
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              `connect-src ${connectSrc()}`,
              "img-src 'self' data:",
              "font-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
