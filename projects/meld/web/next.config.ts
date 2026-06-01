import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Production-deploy prep — `output: 'standalone'` lets the future
 * Dockerfile (Phase 6) ship a minimal `.next/standalone/server.js`
 * with the exact `node_modules` subset the server runtime needs.
 *
 * `outputFileTracingRoot` is pinned to the meld PROJECT root (one
 * hop up from `web/`), NOT the workspace root. tape's first scaffold
 * pinned this three hops up which dragged the entire workspace
 * `node_modules` into the trace and produced a multi-GB image — see
 * tape Phase 6 incident notes. The meld umbrella package.json sits
 * at `projects/meld/package.json`; Next's tracer walks the pnpm
 * workspace links from there correctly.
 *
 * Security headers — Phase 4.2 reviewer's medium finding (`web/next.
 * config.ts` shipping zero `headers()`), folded into Phase 4.3 so
 * Phase 6 deploy-prep is unblocked. Applied to every route via the
 * catch-all `/(.*)` source pattern.
 *
 *   - `X-Content-Type-Options: nosniff` — refuses MIME-sniff on
 *     responses; cheap defence against `text/html` being interpreted
 *     when the server intended `application/json`.
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — sends the
 *     origin (not the path) on cross-origin navigations; preserves
 *     analytics utility without leaking board ids to third parties.
 *   - `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` — meld
 *     has no iframe-embed use case in v1; defence-in-depth against
 *     clickjacking on the board surface.
 *   - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
 *     — Fly.io canonical (2-year HSTS + subdomain coverage). Fly
 *     terminates TLS at the edge and forwards `X-Forwarded-Proto:
 *     https`; the HSTS pin instructs every modern browser to upgrade
 *     subsequent visits to HTTPS automatically.
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` is needed for Next 15's
 *     runtime inline scripts (hydration boot, theme flash-guard).
 *     v1.1 tightens via a per-request nonce — documented in
 *     `AGENT_NOTES.md` as `unsafe-inline` debt. `style-src 'self'
 *     'unsafe-inline'` covers Tailwind's emitted style attributes
 *     and Motion's inline style writes. `connect-src 'self' wss:
 *     ws:` allows the WS upgrade to `wss://meld-demo.fly.dev/ws/
 *     board/:boardId` (and dev `ws://localhost`). `img-src 'self'
 *     data:` covers favicons + future inline SVG data URIs.
 *     `font-src 'self' data:` covers Inter / system fonts.
 *     `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 *     `base-uri 'self'` blocks `<base>` injection.
 *     `form-action 'self'` keeps any future form POSTs same-origin.
 *
 * These headers ship over EVERY route — including `/_next/static/*`
 * — which is what Next 15's `headers()` config is designed for. The
 * `<source-map-explorer>` overhead is zero (headers are emitted at
 * runtime by the Next server, not baked into the build chunks).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Use `fileURLToPath` rather than `new URL(...).pathname` so the
  // resolved root is a real OS path on both Windows (`C:\Portfolio
  // \projects\meld\`) and Linux (`/build/`). `.pathname` on Windows
  // yields `/C:/Portfolio/projects/meld/` — a string Next's trace
  // tooling treats as a Unix path and silently skips the standalone
  // emit (verified Phase 6.1: `.next/standalone/` was missing on
  // Windows local builds even with `output: 'standalone'` declared).
  // The Dockerfile builds in Linux where both paths resolve the same;
  // the swap is for local-smoke parity.
  //
  // Vitest evaluates this file with a non-`file:` `import.meta.url`
  // when the security-headers test imports the default export — guard
  // with a try/catch so the test environment falls back to the
  // pathname form (which is fine because the test only inspects the
  // returned `headers()` rules, not the tracing root).
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
  async headers() {
    return [
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
              "connect-src 'self' wss: ws:",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
