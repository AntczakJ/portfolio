# syntax=docker/dockerfile:1.7
#
# atrium — production image for Fly.io.
#
# WEB-ONLY (ADR-001). atrium is the portfolio landing page / lobby: a
# single Next.js 15 standalone Node server and nothing else — no backend
# service, no database, no migrations, no entrypoint fan-out. The whole
# site is a static typed index (the six showcases) with a GSAP
# scroll-driven hero; there is ZERO network at runtime and ZERO secrets.
#
# We still need the Node runtime (NOT a static export) because the app
# uses a dynamically-generated `opengraph-image`, `sitemap.ts`,
# `robots.ts`, and JSON-LD/metadata — all of which `output: 'standalone'`
# serves and a static export cannot.
#
# NOTE — no `web/public`: atrium has NO `public/` directory. Fonts are
# self-hosted by `next/font` (emitted into `.next/static`), and the OG
# image / robots / sitemap are dynamic route handlers under `src/app/`,
# not static files. So unlike apex/razors-edge there is NO
# `COPY web/public` step in the runtime stage. If a `public/` dir is ever
# added (a favicon.ico, preview stills — the deferred Task 4.5), add the
# matching `COPY --from=build ... /app/web/web/public` line back.
#
# ---------------------------------------------------------------------
# WINDOWS STANDALONE EPERM (the load-bearing reason this Dockerfile
# exists): on the Windows host, `next build` emits `output: 'standalone'`
# but logs `⚠ Failed to copy traced files … EPERM: operation not
# permitted, symlink …` because the host lacks the symlink privilege (no
# admin / Developer Mode) — the standalone trace it produces is therefore
# incomplete and unshippable. This Dockerfile builds the standalone
# artifact INSIDE the Linux `node:22-bookworm-slim` build stage, where
# symlink tracing works correctly, so the EPERM never occurs and the
# emitted `web/.next/standalone/web/server.js` is complete. The deploy
# NEVER ships the Windows host's `.next` (excluded by `.dockerignore`).
# This is the apex/razors-edge precedent carried forward.
# ---------------------------------------------------------------------
#
# Build context: `projects/atrium/` (NOT the repo root). The pnpm
# workspace's root lockfile (`/Portfolio/pnpm-lock.yaml`) is not in this
# context — the build stage writes a tiny isolated `pnpm-workspace.yaml`
# (just the `web` member) and runs an install resolved against the
# manifests, exactly as apex / razors-edge / meld do. atrium has no
# `packages/*` upstream, so there is nothing else to resolve.
#
# Standalone path nesting (load-bearing): `web/next.config.ts` pins
# `outputFileTracingRoot` one hop up to the project root
# (`projects/atrium/`), so Next emits the bundle as
# `web/.next/standalone/web/server.js` (the one-hop wrapper). The runtime
# COPY layout therefore lands `server.js` at `/app/web/web/server.js`,
# with `.next/static` as its sibling — the same shape the siblings
# documented. Getting this path wrong yields "Cannot find module
# server.js" at boot.

# ---- Stage 1: deps -------------------------------------------------------
# Installs the workspace dependencies for the `atrium-web` member. Split
# from the build stage so a source-only change reuses the cached install
# layer.
FROM node:22-bookworm-slim AS deps
WORKDIR /build

# pnpm via corepack — Node 22 ships corepack bundled. The explicit
# `prepare` pins the version (11.4.0) to match the workspace so the build
# is reproducible.
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
# 11's "ignored build scripts" gate does not abort the install on the
# native deps atrium pulls: `sharp` (next/image AVIF optimization + the
# dynamic OG `ImageResponse` satori render), `esbuild`, and
# `unrs-resolver` (transitive). The root workspace file is not in this
# context — we inline the directives.
RUN printf 'packages:\n  - "web"\nallowBuilds:\n  esbuild: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

# Install. `--frozen-lockfile=false` because the per-project lockfile is
# not committed at this nesting — pnpm resolves against the manifests.
RUN pnpm install --frozen-lockfile=false


# ---- Stage 2: build ------------------------------------------------------
# Builds the Next.js 15 standalone bundle. The bundle lands at
# `web/.next/standalone/` and brings the minimal node_modules subset the
# Next server runtime needs; everything else is dropped in the runtime
# stage. The standalone trace is produced HERE, on Linux, where symlink
# tracing works — the Windows-EPERM resolution.
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
# `sitemap.ts`, `robots.ts`, and the JSON-LD `url`/`@id` (via
# `src/lib/site-config.ts`). The real Fly app is `atrium-demo` (the bare
# `atrium` name was taken), so we bake that production origin here.
# Override with
# `--build-arg NEXT_PUBLIC_SITE_URL=...` for a renamed app (see DEPLOY.md).
ARG NEXT_PUBLIC_SITE_URL=https://atrium-demo.fly.dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

# NEXT_PUBLIC_GITHUB_BASE is INTENTIONALLY UNSET here. Leaving it unset
# keeps `REPO_LINKS_LIVE === false` (site-config.ts), so the per-project
# repo affordance renders as the disabled "coming soon" control (ADR-003
# / U2) rather than a live link. The repo is currently PRIVATE, so a live
# `github.com/.../tree/main/projects/<slug>` link would 404 for visitors.
# Flip this (set the ARG to the real public base) only once the repo is
# public AND the relevant commits are pushed — see DEPLOY.md "GITHUB_BASE".

# Build. `output: 'standalone'` (web/next.config.ts) emits
# `web/.next/standalone/web/server.js` because of the one-hop
# `outputFileTracingRoot`. The standalone server expects its sibling
# `.next/static` alongside that `server.js`. Built on Linux, the EPERM
# symlink failure that occurs on the Windows host does NOT occur here.
RUN pnpm -F atrium-web build


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

# Non-root. The Node base image ships a `node` user at UID 1000 that owns
# its home dir; we run as it.
RUN mkdir -p /app/web && chown -R node:node /app
WORKDIR /app

# Next standalone bundle. The one-hop `outputFileTracingRoot` nests the
# bundle as `web/.next/standalone/web/server.js` (the standalone ROOT
# contains only `package.json` + the `web/` member — there is no
# top-level launcher; the actual Next entry is the nested
# `web/server.js`). That `server.js` does `process.chdir(__dirname)` and
# resolves `.next/static` relative to ITS OWN directory, so the runtime
# layout under /app/web mirrors what `next build` produced:
#
#   /app/web/package.json          (standalone root manifest)
#   /app/web/web/server.js         (the Next server entry — CMD target)
#   /app/web/web/node_modules      (the runtime node_modules SUBSET,
#                                    carried inside the standalone trace)
#   /app/web/web/.next/static      (hashed build assets — copied below)
#
# `.next/static` is emitted SEPARATELY by Next (NOT inside the standalone
# trace) and must be copied as a sibling of `server.js`. There is NO
# `public` copy — atrium has no `public/` dir (see the header note).
COPY --from=build --chown=node:node /build/web/.next/standalone /app/web
COPY --from=build --chown=node:node /build/web/.next/static /app/web/web/.next/static

USER node

# Production env defaults — fly.toml mirrors these. Baked into the image
# so a bare `docker run` (no --env) still serves correctly for a local
# smoke. The conventional Next standalone PORT is 3000; Fly maps
# 443 → internal 3000. (The dev/start scripts use 3080 locally; the
# standalone `server.js` honours the PORT env, which is 3000 here — the
# 3080 dev port is irrelevant to the container.)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_PUBLIC_SITE_URL=https://atrium-demo.fly.dev

EXPOSE 3000

# Backup liveness signal for `docker run`; Fly uses its own fly.toml
# health check and ignores this.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://127.0.0.1:3000/ || exit 1

# Single process — exec the Next standalone server directly. No
# entrypoint pipeline, no migrations.
CMD ["node", "/app/web/web/server.js"]
