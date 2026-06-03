import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Razor's Edge — Next 15 config.
 *
 * `output: 'standalone'` keeps the future deploy (Phase 7) able to
 * emit a minimal `.next/standalone/server.js` with the exact
 * `node_modules` subset the runtime needs.
 *
 * `outputFileTracingRoot` is pinned to the razors-edge PROJECT root
 * (one hop up from `web/` — `projects/razors-edge/`), NOT the
 * workspace root. The meld Phase 6 incident is the source: pinning the
 * trace too high drags the whole workspace `node_modules` into the
 * standalone trace. We resolve via `fileURLToPath(new URL('../', ...))`
 * and NOT `new URL(...).pathname`, because on Windows `.pathname`
 * yields `/C:/Portfolio/projects/razors-edge/` which Next's tracer
 * treats as a Unix path and silently skips the standalone emit. The
 * try/catch falls back to `.pathname` only for non-`file:` evaluation
 * contexts (e.g. Vitest importing this module to assert the header set
 * — see `src/__tests__/next-config-headers.test.ts`).
 *
 * Security headers (ADR-002 CSP posture, mirroring meld's reviewer
 * set) ship over EVERY route via the catch-all `/(.*)` source:
 *
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` — the load-bearing guarantee
 *     is **no `'unsafe-eval'`**: GSAP core + ScrollTrigger +
 *     `@gsap/react` do NOT use eval / new Function, verified in
 *     Task 1.3 by loading the production build in headless Chromium and
 *     observing zero CSP violations with GSAP fully hydrated and the
 *     ScrollTrigger smoke running. `'unsafe-inline'` for SCRIPTS is the
 *     meld lesson applied honestly: Next 15 emits its hydration
 *     bootstrap + the next-themes flash-guard as UNHASHED inline
 *     `<script>` elements that a bare `script-src 'self'` blocks
 *     outright — which kills hydration entirely (the app never mounts,
 *     so GSAP never even gets to run). ADR-002's own escape clause
 *     ("a per-request nonce for Next's inline bootstrap IF NEEDED;
 *     `'unsafe-inline'` avoided WHERE THE FRAMEWORK ALLOWS") resolves
 *     here to `'unsafe-inline'`, because the framework does not allow
 *     the strict form without per-request nonce middleware. The v1.1
 *     hardening is exactly that: nonce middleware + drop `'unsafe-inline'`
 *     for scripts — documented as debt in AGENT_NOTES.md. The
 *     `'unsafe-eval'` ban is what proves GSAP needs no eval and is the
 *     part of the posture that does NOT relax.
 *     `style-src 'self' 'unsafe-inline'` is REQUIRED and accepted
 *     (ADR-002): Tailwind v4 emits inline style attributes and GSAP
 *     writes inline `style` transforms during the scrub that CSP
 *     `style-src` governs and that GSAP cannot nonce. Documented as
 *     the v1.1 style-nonce hardening debt in AGENT_NOTES.md.
 *     `img-src 'self' data: blob:` covers favicons, AVIF placeholders,
 *     and the client-side `.ics` blob preview path. `font-src 'self'`
 *     covers self-hosted `next/font` faces (Phase 2.2). `connect-src
 *     'self'` — there is no network in v1 (the booking flow is mocked
 *     in-memory; ADR-003). `frame-ancestors 'none'` mirrors
 *     `X-Frame-Options: DENY`. `base-uri 'self'` blocks `<base>`
 *     injection. `form-action 'self'` keeps the mocked server-action
 *     submit same-origin.
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
