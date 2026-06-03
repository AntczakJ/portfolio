# syntax=docker/dockerfile:1.7
#
# razors-edge — production image for Fly.io.
#
# WEB-ONLY. Unlike meld (Hono + Hocuspocus + Postgres + migrations) and
# tape (a Rust worker), razors-edge is a single Next.js 15 standalone
# Node server and nothing else: no backend service, no database, no
# migrations, no entrypoint fan-out. The booking flow is fully mocked
# in-memory against seeded faker data (ADR-001 / ADR-003), so the
# runtime needs ZERO secrets and makes ZERO network calls. We still need
# the Node runtime (NOT a static export) because the app uses server
# actions (`app/book/actions.ts`), a dynamically-generated
# `opengraph-image`, `sitemap.ts` / `robots.ts`, and JSON-LD/metadata —
# all of which `output: 'standalone'` serves and a static export cannot.
#
# Build context: `projects/razors-edge/` (NOT the repo root). The pnpm
# workspace's root lockfile (`/Portfolio/pnpm-lock.yaml`) is not in this
# context — the build stage writes a tiny isolated `pnpm-workspace.yaml`
# (just the `web` member) and runs an install resolved against the
# manifests, exactly as meld does. razors-edge has no `packages/*`
# upstream, so there is nothing else to resolve.
#
# Standalone path nesting (load-bearing): `web/next.config.ts` pins
# `outputFileTracingRoot` one hop up to the project root (`projects/
# razors-edge/`), so Next emits the bundle as
# `web/.next/standalone/web/server.js` (the one-hop wrapper). The
# runtime COPY layout therefore lands `server.js` at
# `/app/web/web/server.js`, with `.next/static` + `public` as its
# siblings — the same shape meld documented. Getting this path wrong
# yields "Cannot find module server.js" at boot.

# ---- Stage 1: deps -------------------------------------------------------
# Installs the workspace dependencies for the `razors-edge-web` member.
# Split from the build stage so a source-only change reuses the cached
# install layer.
FROM node:22-bookworm-slim AS deps
WORKDIR /build

# pnpm via corepack — Node 22 ships corepack bundled. The explicit
# `prepare` pins the version (11.4.0) to match the workspace
# (`package.json` `packageManager` + the root pnpm-workspace.yaml run on
# 11.x) so the build is reproducible.
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

# Manifests first for layer caching. Only the umbrella + the single web
# member exist in this project (no `server`).
COPY package.json ./
COPY tsconfig.base.json ./
COPY web/package.json ./web/

# Write a tiny isolated workspace descriptor — the repo-root one globs
# every project under `projects/*`, which is not in this build context.
# Mirror the root pnpm-workspace.yaml `allowBuilds` allowlist so pnpm
# 11's "ignored build scripts" gate does not abort the install on
# `esbuild` / `sharp` (the photo-grading devDep) / `unrs-resolver`
# (transitive). The root workspace file is not in this context — we
# inline the directives.
RUN printf 'packages:\n  - "web"\nallowBuilds:\n  esbuild: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

# Install. `--frozen-lockfile=false` because the per-project lockfile is
# not committed at this nesting — pnpm resolves against the manifests.
RUN pnpm install --frozen-lockfile=false


# ---- Stage 2: build ------------------------------------------------------
# Builds the Next.js 15 standalone bundle. The bundle lands at
# `web/.next/standalone/` and brings the minimal node_modules subset the
# Next server runtime needs; everything else is dropped in the runtime
# stage.
FROM node:22-bookworm-slim AS build
WORKDIR /build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

# Reuse the resolved install + the generated workspace descriptor from
# the deps stage (`pnpm-workspace.yaml` is written by `printf` in deps,
# so it is not in this build context — pull it from the deps layer).
COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/web/node_modules ./web/node_modules
COPY --from=deps /build/pnpm-workspace.yaml ./
COPY package.json tsconfig.base.json ./
COPY web/package.json ./web/

# Real sources.
COPY web ./web

# Next inlines NEXT_PUBLIC_* env vars at BUILD time, not runtime.
# `NEXT_PUBLIC_SITE_URL` drives `metadataBase`, the canonical/OG URLs,
# `sitemap.ts`, `robots.ts`, and the JSON-LD `@id`/`url` (via
# `src/lib/site-config.ts`). Leaving it unset bakes the placeholder
# `https://razors-edge-demo.vercel.app` into the bundle — the meld
# lesson (a wrong baked NEXT_PUBLIC_* silently ships) applied: we bake
# the real production origin here so every absolute URL points at the
# Fly demo host.
ARG NEXT_PUBLIC_SITE_URL=https://razors-edge-demo.fly.dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

# Build. `output: 'standalone'` (web/next.config.ts) emits
# `web/.next/standalone/web/server.js` because of the one-hop
# `outputFileTracingRoot`. The standalone server expects its sibling
# `.next/static` + `public` alongside that `server.js`.
RUN pnpm -F razors-edge-web build


# ---- Stage 3: runtime ----------------------------------------------------
# The image Fly.io actually runs. A SINGLE Node process: the Next
# standalone server. No entrypoint script, no migrations, no second
# service — `CMD` execs `server.js` directly.
FROM node:22-bookworm-slim AS runtime

# curl is for the HEALTHCHECK instruction (a `docker run` smoke signal;
# Fly reads its own [http_service.checks] in fly.toml). ca-certificates
# is harmless hygiene. No pnpm/corepack in the runtime — the standalone
# bundle is self-contained Node.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root. The Node base image ships a `node` user at UID 1000 that
# owns its home dir; we run as it.
RUN mkdir -p /app/web && chown -R node:node /app
WORKDIR /app

# Next standalone bundle. The one-hop `outputFileTracingRoot` nests the
# bundle as `web/.next/standalone/web/server.js`; the standalone server
# resolves `.next/static` + `public` relative to its own location, so
# the runtime layout under /app/web mirrors what `next build` produced:
#
#   /app/web/server.js            (the standalone launcher wrapper)
#   /app/web/web/server.js        (the actual Next server entry)
#   /app/web/web/.next/static     (hashed build assets)
#   /app/web/web/public           (graded photography, favicon, etc.)
#
# `.next/static` and `public` are emitted SEPARATELY by Next (not inside
# the standalone trace) and must be copied alongside `server.js`.
COPY --from=build --chown=node:node /build/web/.next/standalone /app/web
COPY --from=build --chown=node:node /build/web/.next/static /app/web/web/.next/static
COPY --from=build --chown=node:node /build/web/public /app/web/web/public

USER node

# Production env defaults — fly.toml mirrors these. Baked into the image
# so a bare `docker run` (no --env) still serves correctly for a local
# smoke. The conventional Next standalone PORT is 3000; Fly maps
# 443 → internal 3000.
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_PUBLIC_SITE_URL=https://razors-edge-demo.fly.dev

EXPOSE 3000

# Backup liveness signal for `docker run`; Fly uses its own fly.toml
# health check and ignores this.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://127.0.0.1:3000/ || exit 1

# Single process — exec the Next standalone server directly. No
# entrypoint pipeline, no migrations.
CMD ["node", "/app/web/web/server.js"]
