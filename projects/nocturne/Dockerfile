# syntax=docker/dockerfile:1.7
#
# nocturne — production image for Fly.io.
#
# WEB-ONLY (ADR-001). nocturne is a single Next.js standalone Node server and
# nothing else — no backend, no database, no migrations. The entire experience
# (the GPGPU particle field, the Web Audio reactivity) runs CLIENT-SIDE in the
# visitor's browser on THEIR GPU; the server only serves the bundle + the
# dynamic OG image / robots / sitemap. ZERO secrets, ZERO network at runtime.
#
# We need the Node runtime (NOT a static export) because the app uses a
# dynamically-generated `opengraph-image`, `sitemap.ts`, `robots.ts`, and
# JSON-LD/metadata — `output: 'standalone'` serves all of these.
#
# NOTE — no `web/public`: nocturne has NO `public/` dir (fonts are self-hosted
# by next/font into .next/static; OG/robots/sitemap are dynamic routes; the
# poster is a code-rendered gradient). So there is NO `COPY web/public` step. If
# a public/ dir is ever added, add the matching COPY back (the atrium precedent).
#
# WINDOWS STANDALONE EPERM: on the Windows host `next build` emits the standalone
# trace with EPERM symlink warnings (no Developer Mode), so the host artifact is
# unshippable. This Dockerfile builds the standalone INSIDE the Linux build stage
# where symlink tracing works; the host `.next` is excluded by `.dockerignore`.
#
# Build context: `projects/nocturne/` (NOT the repo root). The build stage writes
# a tiny isolated `pnpm-workspace.yaml` (just the `web` member) and installs
# resolved against the manifests — the apex/atrium precedent.
#
# Standalone path nesting: `web/next.config.ts` pins `outputFileTracingRoot` one
# hop up to `projects/nocturne/`, so Next emits `web/.next/standalone/web/server.js`.
# The runtime COPY lands `server.js` at `/app/web/web/server.js` with
# `.next/static` as its sibling. Getting this wrong yields "Cannot find module".

# ---- Stage 1: deps -------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

COPY package.json ./
COPY tsconfig.base.json ./
COPY web/package.json ./web/

# Isolated workspace descriptor (the repo-root one globs all of projects/*,
# not in this context). Mirror the root allowBuilds allowlist so pnpm 11's
# ignored-build-scripts gate does not abort on the native deps nocturne pulls:
# sharp (next/image + the dynamic OG ImageResponse satori render), esbuild,
# unrs-resolver (transitive). three / R3F are pure JS — nothing to build.
RUN printf 'packages:\n  - "web"\nallowBuilds:\n  esbuild: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile=false


# ---- Stage 2: build ------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/web/node_modules ./web/node_modules
COPY --from=deps /build/pnpm-workspace.yaml ./
COPY package.json tsconfig.base.json ./
COPY web/package.json ./web/

COPY web ./web

# Next inlines NEXT_PUBLIC_* at BUILD time. NEXT_PUBLIC_SITE_URL drives
# metadataBase, the canonical/OG URLs, sitemap, robots, JSON-LD (via
# src/lib/site-config.ts). The real Fly app is `nocturne-demo`. Override with
# --build-arg for a renamed app (see DEPLOY.md).
ARG NEXT_PUBLIC_SITE_URL=https://nocturne-demo.fly.dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

# Build. `next build --webpack` (Next 16 keeps webpack via the flag; Turbopack
# default mis-roots the pnpm monorepo standalone trace — the repo-wide decision).
# output:'standalone' + the one-hop outputFileTracingRoot emit
# web/.next/standalone/web/server.js. Built on Linux, the Windows symlink EPERM
# does not occur.
RUN pnpm -F nocturne-web build


# ---- Stage 3: runtime ----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/web && chown -R node:node /app
WORKDIR /app

# The one-hop outputFileTracingRoot nests the bundle as
# web/.next/standalone/web/server.js (the standalone root holds package.json +
# the web/ member; the Next entry is the nested web/server.js, which chdir's to
# its own dir and resolves .next/static relative to itself). NO public copy —
# nocturne has no public dir.
COPY --from=build --chown=node:node /build/web/.next/standalone /app/web
COPY --from=build --chown=node:node /build/web/.next/static /app/web/web/.next/static

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_PUBLIC_SITE_URL=https://nocturne-demo.fly.dev

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://127.0.0.1:3000/ || exit 1

CMD ["node", "/app/web/web/server.js"]
