import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * NOCTURNE — Next 16 config.
 *
 * `output: 'standalone'` lets the Phase-8 deploy emit a minimal
 * `.next/standalone/web/server.js` with the exact `node_modules` subset the
 * runtime needs (the apex / atrium / razors-edge single-Machine web-only
 * pattern).
 *
 * `outputFileTracingRoot` is pinned to the nocturne PROJECT root (one hop up
 * from `web/` — `projects/nocturne/`), NOT the workspace root. The meld Phase 6
 * incident is the source: pinning the trace too high drags the whole workspace
 * `node_modules` into the standalone trace. We resolve via
 * `fileURLToPath(new URL('../', import.meta.url))` and NOT `new URL(...).pathname`,
 * because on Windows `.pathname` yields `/C:/portfolio/projects/nocturne/` which
 * Next's tracer treats as a Unix path and silently skips the standalone emit.
 * The try/catch falls back to `.pathname` only for non-`file:` evaluation
 * contexts (e.g. a Vitest import of this module to assert the header set).
 *
 * Security headers — ADR-002 §6 CSP posture. nocturne ships a GPGPU R3F field
 * + @react-three/postprocessing + a Web Audio AnalyserNode pipeline. The CSP is
 * TIGHTER than apex's:
 *
 *   - CSP — `default-src 'self'` denies external surface by default.
 *     `script-src 'self' 'unsafe-inline'` — the LOAD-BEARING guarantee is **no
 *     `'unsafe-eval'` AND no `'wasm-unsafe-eval'`**. three.js + @react-three/fiber
 *     + @react-three/drei + @react-three/postprocessing's `postprocessing` and
 *     the `GPUComputationRenderer` compile GLSL through the WebGL DRIVER, not JS
 *     `eval` (the apex finding holds; verified in Task 1.3 by loading the
 *     PRODUCTION build in headless Chromium with the live WebGL scene + a minimal
 *     EffectComposer/Bloom hydrated and observing zero CSP violations). nocturne
 *     ships NO GLB, NO draco/meshopt decoder, NO WASM at all (the sim is pure
 *     GLSL; nothing to decompress), so even apex's narrow `'wasm-unsafe-eval'`
 *     window is absent — a genuine tightening. The Web Audio analysis uses a
 *     main-thread `AnalyserNode` (NOT an `AudioWorklet`), so `script-src` needs
 *     no worklet `blob:` either. `'unsafe-inline'` for SCRIPTS is the inherited
 *     Next-16-hydration-bootstrap + next-themes flash-guard necessity (the same
 *     v1.1 nonce-hardening debt the siblings carry — recorded in AGENT_NOTES.md).
 *     `'unsafe-eval'` is NEVER granted IN PRODUCTION; the `headers()` dev branch
 *     adds it (plus `ws:`/`wss:` to connect-src) for `next dev` ONLY, because
 *     Next's HMR + React Fast Refresh eval at runtime. The shipped build is
 *     eval-free.
 *
 *     `style-src 'self' 'unsafe-inline'` — Tailwind v4 inline style attributes +
 *     R3F's inline canvas styles. v1.1 style-nonce debt.
 *     `img-src 'self' data: blob:` — the poster + preset-directory AVIF stills,
 *     favicons, and any canvas `toDataURL` poster-export path (ADR-004).
 *     `font-src 'self'` — self-hosted `next/font` faces (Task 2.2).
 *     `media-src 'self' blob:` — the ONLY directive added vs apex: `'self'`
 *     serves the bundled CC0 track from the app's static assets; `blob:` serves
 *     the user-uploaded audio file's object URL (ADR-003). The mic
 *     (`getUserMedia` → `MediaStreamAudioSourceNode`) is a `MediaStream`, not a
 *     fetched resource — it needs NO CSP directive.
 *     `connect-src 'self'` — there is NO network in v1 (presets are static; no
 *     backend; the track + stills are same-origin static assets; mic is a
 *     `MediaStream`; upload is a local `File`→`blob:`, not a fetch). TIGHTER than
 *     apex's `connect-src 'self' blob:` (nocturne has no GLTFLoader-blob fetch).
 *     `worker-src 'self' blob:` / `child-src 'self' blob:` — retained
 *     defensively (R3F/drei or `postprocessing` may spin a self-hosted blob
 *     worker; harmless same-origin surface). NOT for any AudioWorklet (unused).
 *     `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 *     `base-uri 'self'` blocks `<base>` injection.
 *     `form-action 'self'` keeps any same-origin form post in-bounds.
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
    // DEV-ONLY CSP relaxation (the verified atrium/apex pattern). `next dev`
    // (HMR + React Fast Refresh) evaluates code via eval / `new Function` and
    // opens an HMR WebSocket. The production-strict CSP (no `'unsafe-eval'`,
    // `connect-src 'self'`) blocks both outright, which kills ALL client JS in
    // development — three.js / R3F never hydrate, so the field is dead. We add
    // `'unsafe-eval'` to script-src and `ws:`/`wss:` to connect-src for DEV
    // ONLY. PRODUCTION keeps the strict, eval-free CSP ADR-002 §6 mandates.
    // `headers()` is read once at process start, so `NODE_ENV` correctly
    // distinguishes `next dev` (development) from `next build` / `next start`.
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";

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
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              // The ONE Web-Audio delta vs apex: `'self'` serves the bundled
              // CC0 track; `blob:` serves the uploaded-file object URL (ADR-003).
              "media-src 'self' blob:",
              connectSrc,
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
