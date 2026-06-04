# syntax=docker/dockerfile:1.7
#
# pulse-api — production image for Fly.io (ADR-006).
#
# ONE image, TWO Fly [processes]: `web` (NestJS HTTP + the two @Sse() routes +
# better-auth + the public read surface + the /demo routes) and `worker` (the
# BullMQ probe + rollup + GC worker, NO HTTP). Both boot from this same image;
# the process is selected by the start command in fly.toml's [processes] block:
#
#   web    = node --import tsx /app/server/src/main.ts
#   worker = node --import tsx /app/server/src/worker.ts
#
# This mirrors the Phase-2 split (`src/main.ts` vs `src/worker.ts`, AGENT_NOTES
# "WORKER/WEB PROCESS SPLIT is real"). The web process is a producer only (no
# @Processor); the worker imports the probe/rollup/GC processors. The two share
# the Redis Pub/Sub `pulse:events` bridge (ADR-003), so the worker publishes
# events the web's SSE routes relay.
#
# Like meld, pulse-server runs its TypeScript directly via `tsx` (a
# `node --import` loader) — there is NO compile step, no `dist`. The runtime
# image carries the server source tree + its prod node_modules (materialised by
# `pnpm deploy`), and drizzle-kit (a devDep, COPIED in) so the entrypoint can
# run migrations + the idempotent demo seed on boot.
#
# Build context: `projects/pulse/` (NOT the repo root). The workspace root
# lockfile is not in this context; each stage writes a tiny isolated
# pnpm-workspace.yaml and resolves against the manifests, exactly as meld /
# razors-edge do. pulse has no `packages/*` upstream.
#
# This Dockerfile builds pulse-api ONLY. The Next frontend (pulse-web) is built
# by the SEPARATE `Dockerfile.web` (ADR-006 ships pulse-web as its own Fly app
# proxying this API — the meld precedent). Two images, two apps; see DEPLOY.md.

# ---- Stage 1: server-builder ---------------------------------------------
# Materialises pulse-server's prod node_modules subset as a self-contained tree
# at /build/server-deploy via `pnpm deploy`. drizzle-kit lives in devDeps but
# the entrypoint needs it on boot, so this stage keeps devDeps (the install
# footprint is small — NestJS + BullMQ + Drizzle + ioredis + undici + a few
# helpers).
FROM node:22-bookworm AS server-builder
WORKDIR /build

# pnpm via corepack — Node 22 ships corepack bundled. Pin the version (11.4.0)
# to match the workspace so the build is reproducible.
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate

# Manifests first for layer caching. pulse has NO umbrella package.json (the
# workspace members are discovered by the repo-root workspace, not present in
# this context) — only tsconfig.base.json + the server member's manifest. The
# isolated pnpm-workspace.yaml below makes `server` the lone member.
COPY tsconfig.base.json ./
COPY server/package.json ./server/

# Write a tiny isolated workspace descriptor — the repo-root one globs every
# `projects/*` member, which is not in this build context. Mirror the root
# pnpm-workspace.yaml `allowBuilds` allowlist so pnpm 11's "ignored build
# scripts" gate does not abort the install on esbuild (a transitive dep of
# vitest/tsx). `@nestjs/core: false` mirrors the root (its postinstall is only
# a funding banner — AGENT_NOTES Backend Phase 1).
RUN printf 'packages:\n  - "server"\nallowBuilds:\n  esbuild: true\n  msgpackr-extract: true\n  unrs-resolver: true\n  "@nestjs/core": false\n' > pnpm-workspace.yaml

# Server-only install. `--filter pulse-server...` resolves the server subtree's
# deps. `--frozen-lockfile=false` because the per-project lockfile is not
# committed at this nesting — pnpm resolves against the manifests (the meld
# precedent).
RUN pnpm install --frozen-lockfile=false --filter pulse-server...

# Real server sources (src + scripts + drizzle migrations + drizzle.config.ts +
# tsconfig). The seed scripts under server/scripts/ are needed at runtime — the
# entrypoint runs them on boot.
COPY server ./server

# `pnpm deploy` produces a self-contained per-package install at
# /build/server-deploy whose node_modules does NOT depend on the workspace-root
# .pnpm store — exactly what the runtime image needs. devDeps included so
# drizzle-kit + tsx are present for the entrypoint.
#
# `--legacy` is required as of pnpm v10 for a non-injected workspace (the
# `pulse-server` <-> `pulse-web` link is types-only via `import type`; there is
# no injected workspace dep). The meld precedent.
RUN pnpm deploy --filter pulse-server --legacy /build/server-deploy


# ---- Stage 2: runtime ----------------------------------------------------
# The image Fly.io runs for BOTH processes. Node 22 runtime + the server source
# tree + its prod node_modules (incl. drizzle-kit + tsx) + a tiny entrypoint.
FROM node:22-bookworm-slim AS runtime

# curl: the entrypoint health-probe wait + the HEALTHCHECK instruction.
# ca-certificates: outbound TLS — the prober hits https targets, Fly Postgres is
# sslmode=require, and Upstash Redis is rediss:// (TLS). Both are load-bearing.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root. The Node base image ships a `node` user at UID 1000 that owns its
# home dir (corepack/npm caches resolve there); we run as it.
RUN mkdir -p /app/server && chown -R node:node /app
WORKDIR /app

# Server source + node_modules (incl. drizzle-kit + tsx + the seed scripts under
# /app/server/scripts). Node runs `src/main.ts` / `src/worker.ts` directly via
# the tsx loader; the source tree + package.json + tsconfig ship intact so
# import resolution + env reads behave identically to dev.
COPY --from=server-builder --chown=node:node /build/server-deploy /app/server

# CRITICAL: the server's tsconfig.json `extends "../tsconfig.base.json"`, and
# tsx/esbuild reads it to honour `experimentalDecorators` (NestJS parameter
# decorators). `pnpm deploy` copies only the package, NOT the sibling base
# config — without it tsx fails with "Parameter decorators only work when
# experimental decorators are enabled" the instant a decorated class loads
# (the seeds run fine because they have no decorators; the Nest app does not).
# The entrypoint runs from /app/server, so `../tsconfig.base.json` resolves to
# /app/tsconfig.base.json — ship it there.
COPY --chown=node:node tsconfig.base.json /app/tsconfig.base.json

# Entrypoint. Migrations + the idempotent demo seed (web process only) run here.
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh
# Strip CRLF in case Windows git autocrlf checked the file out with CRLF — the
# kernel reads `#!/usr/bin/env sh\r` as interpreter `sh\r` and refuses to exec.
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER node

# Production env defaults — fly.toml overrides where it matters. Baked so a bare
# `docker run` (with a DATABASE_URL + REDIS_URL) does something useful for a
# local smoke. PROCESS_ROLE selects which process the entrypoint launches
# (`web` | `worker`); fly.toml's [processes] override the start command directly
# (and bypass the entrypoint default), but the default keeps a bare `docker run`
# launching the web process.
ENV NODE_ENV=production
ENV PORT=3080
ENV PROCESS_ROLE=web
ENV RUN_MIGRATIONS=1
ENV RUN_SEED=1

# The NestJS HTTP + SSE surface (web process). The worker exposes no port.
EXPOSE 3080

# Backup liveness signal for `docker run`; Fly reads its own [checks] in
# fly.toml and ignores this. Only meaningful for the web process — the worker
# has no /health (its [processes] entry has no [[services]] health check).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -sf http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
