# syntax=docker/dockerfile:1.7
#
# meld — production image for Fly.io.
#
# Three stages so the runtime image carries only what is needed to
# serve traffic. The build is co-located in the same image rather
# than split into a multi-process Fly app (one Machine per service)
# because v1 traffic is dominated by the per-board WebSocket fan-out
# and splitting would add an internal-network hop for every Next page
# load + a private socket for the Hono catch-all proxy — for zero
# scale win at single-instance demo traffic. See ADR-006 + AGENT_NOTES
# "Production topology — single Node process".
#
# Build context: `projects/meld/` (NOT the repo root). The pnpm
# workspace's root lockfile (`/Portfolio/pnpm-lock.yaml`) is not in
# this context — each stage pulls the per-project subset it needs and
# runs an isolated install. If meld ever grows a cross-project shared
# package upstream of it (`packages/*`), this needs revisiting; today
# the meld project has no such upstream.
#
# Differences from tape's Dockerfile (load-bearing for review):
#   - No Rust worker stage. meld is pure Node end-to-end (Hono + the
#     Hocuspocus framework running on the same `http.Server`).
#   - Web stage uses `node:22-bookworm` (NOT `oven/bun:1.3-debian`)
#     because Node 22 LTS is the v1 runtime per ADR-001 and the y-
#     websocket / Hocuspocus reference adapter is documented against
#     Node first.
#   - Server "stage" collapses into the runtime — `pnpm deploy
#     --filter meld-server` lands the server's prod node_modules
#     subset directly in the runtime image; no separate
#     server-builder layer because Node runs `.ts` via `tsx` and
#     there is no compile step to materialise.
#   - drizzle-kit lives in devDependencies but is COPIED into the
#     runtime image so the entrypoint can run `pnpm exec drizzle-kit
#     migrate` on boot per the migration policy in DEPLOY.md.
#
# Single-image vs split (documented trade-off, mirrors tape):
#   - single image (this Dockerfile) — one Fly Machine, entrypoint
#     fan-out (Next standalone in background, Node `meld-server` in
#     foreground), shared filesystem, one health check covers
#     everything, simplest logs.
#   - split (v2 candidate) — `[processes]` block in fly.toml with
#     `server = "node --import tsx /app/server/src/server.ts"` and
#     `web = "node /app/web/.../server.js"`, scale each
#     independently. Pay an internal network hop for any HTTP that
#     `meld-server` proxies to Next. Requires a separate Postgres
#     tunnel and a non-`/tmp` location for any future shared socket.
#
# v1 picks single. The split path is documented in DEPLOY.md.

# ---- Stage 1: web-builder ------------------------------------------------
# Builds the Next.js 15 standalone bundle. The bundle lands at
# `web/.next/standalone/` and brings the minimal subset of node_modules
# the Next server runtime needs; the rest is dropped.
FROM node:22-bookworm AS web-builder
WORKDIR /build

# pnpm via corepack — Node 22 ships corepack bundled. The explicit
# `prepare` call pins the version (11.4.0) so the build is
# reproducible. Pinned to the pnpm major used by the workspace
# (`pnpm-workspace.yaml` operates on 11.x).
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

# Workspace skeleton — a thin pnpm-workspace.yaml + the umbrella
# package.json + tsconfig.base.json so pnpm resolves the workspace
# links between `meld-server` and `meld-web`. The Next build needs
# `meld-server` resolved (types-only import via
# `meld-web/src/lib/api/*` and `meld-web` re-exports the WS frame
# types via `import type { WSControlFrame } from 'meld-server'` per
# AGENT_NOTES "WS schemas live in meld-server").
COPY package.json ./
COPY tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
# Write a tiny isolated workspace descriptor — the repo-root one
# globs every project, which we do not have in this build context.
# Mirror the root pnpm-workspace.yaml `allowBuilds` allowlist so pnpm
# 11's "ignored build scripts" gate does not abort the install on
# `esbuild` (transitive dep of `vitest` / `tsx` etc.). The root
# workspace file is not in this Dockerfile's build context — we
# inline the directives.
RUN printf 'packages:\n  - "server"\n  - "web"\nallowBuilds:\n  esbuild: true\n  msgpackr-extract: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

# Install dependencies for both halves in one pass.
# `--frozen-lockfile=false` because the per-project lockfile is not
# committed at this nesting — pnpm resolves against the manifests.
RUN pnpm install --frozen-lockfile=false

# Now copy the real sources and build the web bundle. The server
# source is needed because `meld-web` imports `meld-server` for
# types-only inference (the Hono RPC `App` type AND the WS frame
# discriminated-union types).
COPY server ./server
COPY web ./web

# Next inlines NEXT_PUBLIC_* env vars at BUILD time, not runtime. In
# production the browser reaches the same Fly hostname for HTTP
# (Hono routes + Next standalone served via the catch-all on the
# server) and for WS (Hocuspocus on /ws/board/:boardId). Both URLs
# are the canonical app URL with wss:// for the WS scheme.
#
# CRITICAL: leaving these as defaults bakes `localhost` into the
# bundle. tape's Phase 6 first deploy hit exactly this trap because
# Lighthouse + dev both happened to hit the same hostnames — the
# production bundle silently shipped a `ws://localhost:3001` reference
# until a real recruiter loaded the demo and the WS upgrade failed.
ARG NEXT_PUBLIC_API_URL=https://meld-demo.fly.dev
ARG NEXT_PUBLIC_WS_URL=wss://meld-demo.fly.dev
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

# Next 15 emits a standalone server at `web/.next/standalone` when
# `output: 'standalone'` is set in next.config.ts (verified Phase 6.1
# — see `web/next.config.ts`). The standalone bundle nests under the
# `outputFileTracingRoot` Next computed at build time; with the one-
# hop trace-root from next.config.ts the layout is
# `web/.next/standalone/web/server.js` (one wrapper for the project).
RUN pnpm -F meld-web build


# ---- Stage 2: server-builder ---------------------------------------------
# Materialises the server's prod node_modules subset as a self-contained
# tree at /build/server-deploy. `pnpm deploy` walks the workspace and
# produces an install whose `node_modules` does NOT depend on the
# workspace root `.pnpm` store — exactly what the runtime image needs.
#
# drizzle-kit is in devDependencies but the entrypoint runs `pnpm exec
# drizzle-kit migrate` on boot, so this stage keeps devDeps. The
# install footprint is small (Hocuspocus + Yjs + Hono + Drizzle + a few
# helpers — ~80 MB resolved) so the slim-vs-fat trade-off favours
# correctness over bytes.
FROM node:22-bookworm AS server-builder
WORKDIR /build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

COPY package.json ./
COPY tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
# Mirror the root pnpm-workspace.yaml `allowBuilds` allowlist so pnpm
# 11's "ignored build scripts" gate does not abort the install on
# `esbuild` (transitive dep of `vitest` / `tsx` etc.). The root
# workspace file is not in this Dockerfile's build context — we
# inline the directives.
RUN printf 'packages:\n  - "server"\n  - "web"\nallowBuilds:\n  esbuild: true\n  msgpackr-extract: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

# Server-only install. `--filter meld-server...` resolves the server
# subtree's deps without dragging in `meld-web`'s Next + React graph.
RUN pnpm install --frozen-lockfile=false --filter meld-server...

COPY server ./server

# `pnpm deploy` produces a self-contained per-package install at
# /build/server-deploy. Including dev deps because drizzle-kit (the
# entrypoint migration runner) lives there. `--prod=false` would be
# redundant — the default behaviour copies the workspace-resolved
# deps as-is.
#
# `--legacy` is required as of pnpm v10 — the new default expects
# `inject-workspace-packages=true` on injected workspaces, which we
# do NOT set (meld-server has no injected workspace deps; the
# `meld-server` ↔ `meld-web` link is types-only via `import type`).
# The legacy mode is the right pick for a non-injected workspace.
RUN pnpm deploy --filter meld-server --legacy /build/server-deploy


# ---- Stage 3: runtime ----------------------------------------------------
# The image Fly.io actually runs. Contains the Node 22 runtime + the
# server source tree + the server's prod node_modules + the Next
# standalone bundle + a tiny entrypoint.
FROM node:22-bookworm-slim AS runtime

# curl is needed by the entrypoint health probe AND the HEALTHCHECK
# instruction. ca-certificates is needed for outbound TLS — Postgres-
# on-Fly is sslmode=require by default. tini is the lightweight init
# we rely on through `--init` at run-time (Fly sets this by default);
# we do NOT install it explicitly here because `node` does signal-
# forwarding correctly under PID 1 for our use case.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

# Non-root user. Node's base image ships a `node` user at UID 1000
# that owns its own home directory; we add `meld` at UID 1001 as a
# named alias for clarity in `docker ps` output and `ps aux` inside
# the container. Both users exist; we USE the `node` user that ships
# with the base image because the Node runtime expects its HOME to
# resolve for the corepack cache. The `meld` username is informative
# only.
RUN useradd --uid 1001 --create-home --shell /bin/bash meld || true && \
    mkdir -p /app/server /app/web && \
    chown -R node:node /app

WORKDIR /app

# 1. Server source + node_modules. Node runs `src/server.ts` directly
# via `tsx` (registered as a `node --import` loader); we ship the
# source tree intact alongside the resolved node_modules. The server's
# package.json + tsconfig stay so the runtime's `import` resolution
# and any `process.env` reads behave identically to dev.
COPY --from=server-builder --chown=node:node /build/server-deploy /app/server

# 2. Next standalone bundle. Next 15's standalone output puts a
# self-contained server.js + the minimal node_modules in
# `.next/standalone/`. Static assets (`.next/static` + `public`) are
# emitted separately and have to be copied alongside.
#
# The Next standalone server resolves the project files relative to
# its own location, so the layout under /app/web mirrors what `next
# build` produced. The one-hop `outputFileTracingRoot` in
# `web/next.config.ts` nests the bundle as
# `web/.next/standalone/web/server.js`; the standalone server expects
# its sibling `.next/static` + `public` alongside that `server.js`.
COPY --from=web-builder --chown=node:node /build/web/.next/standalone /app/web
COPY --from=web-builder --chown=node:node /build/web/.next/static /app/web/web/.next/static
COPY --from=web-builder --chown=node:node /build/web/public /app/web/web/public

# 3. Entrypoint script.
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh
# Strip CRLF in case Windows git autocrlf checked the file out with
# CRLF endings — the kernel reads `#!/usr/bin/env sh\r` as
# interpreter `sh\r` and refuses to exec. Belt-and-braces with the
# `.gitattributes` LF pin (committed alongside the file).
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER node

# Production env defaults — fly.toml overrides where it matters.
# These are baked into the image so a `docker run` without `--env`
# still does something useful (smoke from any laptop with docker).
ENV NODE_ENV=production
ENV PORT=3001
ENV WEB_PORT=3000
ENV RUN_MIGRATIONS=1

# The two external ports the container exposes. Fly's edge proxy
# terminates TLS and forwards to ONE internal port per Machine; we
# pick 3001 (the Hono + Hocuspocus surface) as the canonical port in
# fly.toml's `[http_service]` block. Next standalone listens on 3000
# only on the loopback interface and is reachable from the Hono
# catch-all proxy via `127.0.0.1:3000` (not externally).
EXPOSE 3000 3001

# Healthcheck is a backup signal for `docker run` use. Fly.io reads
# its own [checks] section in fly.toml and ignores this — but
# leaving it documents the canonical liveness URL and helps any
# `docker run` smoke against the image locally.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -sf http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
