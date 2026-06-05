import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * APEX — Next 15 config.
 *
 * `output: 'standalone'` lets the Phase-8 deploy emit a minimal
 * `.next/standalone/server.js` with the exact `node_modules` subset the
 * runtime needs (mirrors razors-edge ADR-005).
 *
 * `outputFileTracingRoot` is pinned to the apex PROJECT root (one hop up
 * from `web/` — `projects/apex/`), NOT the workspace root. The meld Phase 6
 * incident is the source: pinning the trace too high drags the whole
 * workspace `node_modules` into the standalone trace. We resolve via
 * `fileURLToPath(new URL('../', ...))` and NOT `new URL(...).pathname`,
 * because on Windows `.pathname` yields `/C:/Portfolio/projects/apex/`
 * which Next's tracer treats as a Unix path and silently skips the
 * standalone emit. The try/catch falls back to `.pathname` only for
 * non-`file:` evaluation contexts (e.g. Vitest importing this module to
 * assert the header set).
 *
 * Security headers — ADR-002 §5 CSP posture: razors-edge's verified string
 * carried forward, PLUS the WebGL additions for the R3F configurator
 * (Phase 4) and its draco/meshopt decoder.
 *
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` — the LOAD-BEARING guarantee is
 *     **no `'unsafe-eval'`**. GSAP core + ScrollTrigger + `@gsap/react`,
 *     and three.js + @react-three/fiber + @react-three/drei, do NOT use
 *     `eval` / `new Function` in normal operation (three.js shader
 *     compilation is GPU-side, not JS `eval`). Verified in Task 1.3 (GSAP
 *     smoke) and Task 1.4 (R3F smoke Canvas) by loading the PRODUCTION
 *     build in a browser and observing zero CSP violations with GSAP and
 *     the live WebGL scene fully hydrated. `'unsafe-inline'` for SCRIPTS is
 *     the meld/razors-edge lesson: Next 15 emits its hydration bootstrap +
 *     the next-themes flash-guard as UNHASHED inline `<script>` elements
 *     that a bare `script-src 'self'` blocks outright, killing hydration.
 *     The v1.1 hardening is nonce middleware + dropping `'unsafe-inline'`
 *     for scripts — documented as debt in AGENT_NOTES.md. The
 *     `'unsafe-eval'` ban does NOT relax: it is the part that proves
 *     three.js + GSAP need no eval.
 *
 *     `style-src 'self' 'unsafe-inline'` is REQUIRED and accepted: Tailwind
 *     v4 emits inline style attributes, GSAP writes inline `style`
 *     transforms during scrubs, and R3F writes inline canvas styles — none
 *     of which CSP `style-src` can nonce here. v1.1 style-nonce debt.
 *
 *     `img-src 'self' data: blob:` covers favicons, AVIF renders/placeholders,
 *     the client-side `.ics` blob (Phase 5), AND the WebGL canvas
 *     `toDataURL` / texture blob paths (Phase 4).
 *     `font-src 'self'` covers self-hosted `next/font` faces (Phase 2.2).
 *     `connect-src 'self' blob:` — there is no external network in v1 (the
 *     reservation flow is mocked in-memory, ADR-003; the GLBs are same-origin
 *     static assets). `blob:` is required by three.js's GLTFLoader, which loads
 *     the wheel GLBs' embedded PNG texture (the Kenney colormap atlas) via a
 *     same-origin in-memory `blob:` URL it `fetch`-es (model-swap PASS A) — an
 *     in-memory data fetch, not an external connection.
 *     `worker-src 'self' blob:` — kept for apex: R3F/drei may spin up a
 *     blob-URL worker (and it is harmless self-hosted surface). `'self'
 *     blob:` covers any such worker. `child-src 'self' blob:` is included as
 *     the legacy fallback some engines still consult for workers.
 *     WASM note (model-swap PASS A): the configurator no longer loads a
 *     meshopt/draco-compressed GLB. The shipped models (a body GLB + three
 *     wheel GLBs from the CC0 Kenney Car Kit) are tiny, textureless, and
 *     UNCOMPRESSED, so there is NO WebAssembly decoder at load — and
 *     `'wasm-unsafe-eval'` has been REMOVED from `script-src` (a genuine
 *     tightening). The `'unsafe-eval'` JS ban was, and remains, absolute.
 *     `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 *     `base-uri 'self'` blocks `<base>` injection.
 *     `form-action 'self'` keeps the mocked server-action submit same-origin.
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
              // `'wasm-unsafe-eval'` was REMOVED in model-swap PASS A. It had
              // been required by the self-hosted meshopt decoder that
              // decompressed the previous EXT_meshopt_compression GLB. The
              // configurator now ships tiny, textureless, UNCOMPRESSED GLBs (the
              // CC0 Kenney Car Kit body + wheels), so NO WebAssembly decoder
              // runs at load and the directive is gone — a genuine tightening.
              // The `'unsafe-eval'` JS ban was, and remains, absolute: GSAP +
              // three.js + R3F + drei need no `eval` / `new Function`.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              // `blob:` is needed by three.js's GLTFLoader: it loads the wheel
              // GLBs' embedded PNG texture (the Kenney colormap atlas) by
              // creating a same-origin in-memory `blob:` URL and `fetch`-ing it
              // (model-swap PASS A — the wheels keep their atlas; the body is
              // textureless). `blob:` is in-memory, same-origin data, not an
              // external connection. No CDN; the GLBs are same-origin static
              // assets under `'self'`.
              "connect-src 'self' blob:",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
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
