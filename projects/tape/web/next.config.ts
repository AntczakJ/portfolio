import type { NextConfig } from 'next';

/**
 * Phase 6 deploy prep: `output: 'standalone'` is required by the
 * production Dockerfile (`projects/tape/Dockerfile`). Next bundles a
 * minimal `.next/standalone/server.js` plus the exact `node_modules`
 * subset the server runtime needs, so the runtime image does not have
 * to ship the full workspace's `node_modules`. Static assets remain at
 * `.next/static` and are copied separately by the Dockerfile.
 *
 * `outputFileTracingRoot` is pinned to the repo root so Next's tracer
 * walks the pnpm workspace links correctly — without it, the standalone
 * bundle misses `tape-server` (the types-only sibling we depend on) and
 * any other workspace package the page tree pulls in. The two `..`
 * hops climb from `projects/tape/web/` to the repo root.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: new URL('../../../', import.meta.url).pathname,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [],
  },
};

export default nextConfig;
