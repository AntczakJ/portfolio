import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Atrium — Next 15 config.
 *
 * `output: 'standalone'` keeps the future Fly deploy (Phase 7) able to emit a
 * minimal `.next/standalone/server.js` with the exact `node_modules` subset the
 * runtime needs (the razors-edge / atlas single-Machine web-only pattern).
 *
 * `outputFileTracingRoot` is pinned to the atrium PROJECT root (one hop up from
 * `web/` — `projects/atrium/`), NOT the workspace root. The meld Phase 6
 * incident is the source: pinning the trace too high drags the whole workspace
 * `node_modules` into the standalone trace. We resolve via
 * `fileURLToPath(new URL('../', import.meta.url))` and NOT `new URL(...).pathname`,
 * because on Windows `.pathname` yields `/C:/portfolio/projects/atrium/` which
 * Next's tracer treats as a Unix path and silently skips the standalone emit.
 * The try/catch falls back to `.pathname` only for non-`file:` evaluation
 * contexts (e.g. a future Vitest import of this module to assert the headers).
 *
 * Security headers — ADR-002 CSP posture, the razors-edge-verified set — ship
 * over EVERY route via the catch-all `/(.*)` source:
 *
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` — the load-bearing guarantee is **no
 *     `'unsafe-eval'`**: GSAP core + ScrollTrigger + `@gsap/react` do NOT use
 *     `eval` / `new Function` (verified in razors-edge by loading the production
 *     build in headless Chromium with GSAP hydrated + a ScrollTrigger smoke
 *     running and observing zero CSP violations; re-verified here in Task 1.2).
 *     `'unsafe-inline'` for SCRIPTS is required because Next 15 emits its
 *     hydration bootstrap + the next-themes flash-guard as UNHASHED inline
 *     `<script>` elements that a bare `script-src 'self'` blocks outright,
 *     killing hydration entirely. `style-src 'self' 'unsafe-inline'` is required
 *     and accepted: Tailwind v4 emits inline style attributes and GSAP writes
 *     inline `style` transforms during the scrub that `style-src` governs and
 *     that GSAP cannot nonce. The v1.1 nonce-hardening (per-request nonce
 *     middleware dropping both inline grants) is documented debt in
 *     AGENT_NOTES.md, the same carried debt razors-edge noted. `'unsafe-eval'`
 *     is NEVER granted.
 *     `img-src 'self' data: blob:` covers favicons + AVIF preview stills + the
 *     OG composition. `font-src 'self'` covers self-hosted `next/font` faces.
 *     `connect-src 'self'` — there is no network in v1 (atrium is a static typed
 *     index; ADR-001). `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 *     `base-uri 'self'` blocks `<base>` injection. `form-action 'self'` — no
 *     form collects data in v1, contact is a `mailto:` link (ADR-003).
 *   - `X-Content-Type-Options: nosniff` — no MIME-sniff.
 *   - `Referrer-Policy: strict-origin-when-cross-origin`.
 *   - `X-Frame-Options: DENY` — no iframe-embed use case in v1.
 *   - `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
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
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
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
