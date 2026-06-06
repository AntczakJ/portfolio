import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Atlas — Next 15 config.
 *
 * `output: 'standalone'` lets the Phase-9 Fly deploy emit a minimal
 * `.next/standalone/server.js` with the exact `node_modules` subset the runtime
 * needs (the apex/razors-edge precedent). `outputFileTracingRoot` is pinned to
 * the atlas PROJECT root (one hop up from `web/` — `projects/atlas/`), NOT the
 * workspace root, so the standalone trace does not drag the whole workspace
 * `node_modules` in (the meld Phase-6 incident). We resolve via
 * `fileURLToPath(new URL('../', ...))` and NOT `.pathname`, because on Windows
 * `.pathname` yields `/C:/...` which Next's tracer treats as a Unix path and
 * silently skips the standalone emit; the catch falls back only for non-`file:`
 * evaluation contexts (e.g. Vitest importing this module to assert the headers).
 *
 * ---------------------------------------------------------------------------
 * SECURITY HEADERS — ADR-006 CSP posture (the load-bearing frontend gate).
 *
 * The hard rule (ADR-001 / ADR-006, the meld/razors-edge/pulse lesson):
 * MapLibre GL JS needs a Web Worker for tile parsing, so the CSP MUST allow
 * `worker-src 'self' blob:` (MapLibre creates its tile-parse worker from a
 * blob URL) WITHOUT opening `'unsafe-eval'`. The keyless basemap is a
 * self-hosted Protomaps `.pmtiles` extract served same-origin (the `pmtiles`
 * plugin reads it via HTTP range requests over `fetch` → `connect-src 'self'`),
 * so self-hosting deliberately SHRINKS the CSP surface to same-origin only.
 *
 *   - `default-src 'self'` — deny external surface by default.
 *
 *   - `script-src 'self' 'unsafe-inline'` — the LOAD-BEARING guarantee is
 *     **no `'unsafe-eval'`**. MapLibre GL JS does NOT use `eval`/`new Function`
 *     in normal operation (its shader work is GPU-side; its worker is spawned
 *     from a `blob:` URL, covered by `worker-src`, not by `eval`). Verified by
 *     loading the PRODUCTION build (`next build && next start`) and observing
 *     ZERO CSP violations with the live WebGL map fully rendered. `zod` is also
 *     opted out of its JIT `new Function` probe (`z.config({ jitless: true })`
 *     in `@/lib/zod-config`) so the runtime WS-frame validation path (Phase 4)
 *     never trips the policy. `'unsafe-inline'` for SCRIPTS is the
 *     meld/razors-edge/apex lesson: Next 15 emits its hydration bootstrap + the
 *     next-themes flash-guard as UNHASHED inline `<script>` elements that a bare
 *     `script-src 'self'` blocks outright, killing hydration. The v1.1
 *     hardening is nonce middleware + dropping `'unsafe-inline'` for scripts
 *     (tracked as debt in AGENT_NOTES.md). The `'unsafe-eval'` ban does NOT
 *     relax — it is the part that proves MapLibre + zod need no eval.
 *
 *   - `style-src 'self' 'unsafe-inline'` — REQUIRED and accepted: Tailwind v4
 *     emits inline style attributes, and MapLibre GL JS injects its control +
 *     canvas styles inline (the `maplibre-gl.css` is imported, but MapLibre also
 *     writes inline `style` on the canvas + controls). `script-src` stays
 *     locked to no-eval; only `style-src` is permissive here. v1.1 style-nonce
 *     debt, documented so the reviewer does not flag it as an oversight.
 *
 *   - `img-src 'self' data: blob:` — favicons, AVIF renders, the OG image, AND
 *     the MapLibre raster/sprite paths: sprites + glyphs are same-origin
 *     (`'self'`), and MapLibre decodes some tile imagery via `data:`/`blob:`.
 *
 *   - `worker-src 'self' blob:` — THE MapLibre allowance. MapLibre spawns its
 *     tile-parsing worker from a same-origin `blob:` URL. `child-src 'self'
 *     blob:` is the legacy fallback some engines still consult for workers.
 *
 *   - `connect-src 'self'` — the keyless `.pmtiles` is served same-origin
 *     (range requests), and the live telemetry WebSocket (Phase 4) connects
 *     same-origin (`ws:`/`wss:` to the Atlas origin, proxied to the Fastify
 *     gateway). NO third-party tile host in the default keyless build — that is
 *     the whole point of self-hosting. When the OPTIONAL `NEXT_PUBLIC_MAP_TILE_KEY`
 *     enrichment is configured at deploy, the chosen tile host is appended to
 *     `connect-src` + `img-src` (see `buildConnectSrc` below); with no key the
 *     policy stays same-origin only.
 *
 *   - `font-src 'self'` — self-hosted `next/font` faces.
 *   - `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 *   - `base-uri 'self'` blocks `<base>` injection.
 *   - `form-action 'self'` keeps any form submit same-origin.
 *
 * The optional tile-host enrichment: if a deploy supplies a tile/style key, the
 * owner ALSO sets `NEXT_PUBLIC_MAP_TILE_HOST` (the host to allow). With no key,
 * NOTHING external is allowed — the keyless self-hosted `.pmtiles` renders under
 * a same-origin-only policy. This keeps the committed repo (no `.env`) on the
 * tightest possible CSP.
 */

const optionalTileHost = process.env.NEXT_PUBLIC_MAP_TILE_HOST?.trim();

/** `connect-src` / `img-src` gain the optional tile host ONLY when configured. */
function withOptionalTileHost(base: string): string {
  return optionalTileHost ? `${base} ${optionalTileHost}` : base;
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // No `'unsafe-eval'` — the load-bearing guarantee. MapLibre + zod(jitless)
  // need no eval. `'unsafe-inline'` covers Next 15's hydration bootstrap.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind v4 + MapLibre inline styles. Scripts stay no-eval.
  "style-src 'self' 'unsafe-inline'",
  // MapLibre sprites/glyphs are same-origin; data:/blob: for decoded imagery.
  withOptionalTileHost("img-src 'self' data: blob:"),
  "font-src 'self'",
  // Same-origin `.pmtiles` range requests + the same-origin telemetry WS.
  withOptionalTileHost("connect-src 'self'"),
  // THE MapLibre allowance: the tile-parse worker is a same-origin blob.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
            value: contentSecurityPolicy,
          },
        ],
      },
      {
        // The keyless basemap is a same-origin static `.pmtiles` served with
        // HTTP range support. A long immutable cache is safe (the extract is
        // versioned by deploy); range requests are handled by the static server.
        source: '/map/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
