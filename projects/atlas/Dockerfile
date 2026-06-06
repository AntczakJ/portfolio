# syntax=docker/dockerfile:1.7
#
# atlas-server — production image for Fly.io (ADR-007).
#
# ONE Fly app, ONE process, ONE machine, kept WARM: the Fastify server that runs
# the in-process simulation engine (the pure-reducer loop, ADR-002), the
# @fastify/websocket telemetry gateway (the JSON frame contract, ADR-003), and
# the small REST read surface (/health). It is the SINGLE SOURCE OF TRUTH — every
# browser connects to the one engine; tick -> broadcast is an in-memory emitter,
# NO broker, NO Redis (ADR-002/ADR-007).
#
# Like pulse/meld, atlas-server runs its TypeScript DIRECTLY via `tsx`
# (a `node --import` loader) — there is NO compile step, no `dist`. The runtime
# image carries the server source tree + its prod node_modules (materialised by
# `pnpm deploy`), plus drizzle-kit (a devDep, kept in the deploy tree) so the
# entrypoint can migrate + seed on boot.
#
# THE atlas-shared LESSON (the apex "inline tsconfig.base.json so the Docker
# build context resolves it" lesson, applied to a THREE-package workspace):
# atlas is NOT a two-package (server + web) shape like pulse. It has a THIRD
# workspace package, `atlas-shared` (the project-root package.json + `src/`),
# that the server depends on for REAL (not types-only): the Zod schemas it
# validates WS control frames against at runtime, and the turf geo IMPL the
# engine's projection/ETA/geofence math calls. So:
#   - the build context (projects/atlas/) MUST include the root package.json
#     (= atlas-shared's manifest), tsconfig.base.json, AND `src/` (atlas-shared's
#     TypeScript source). The .dockerignore keeps all three.
#   - `pnpm deploy --filter atlas-server --legacy` materialises atlas-shared
#     into the deploy tree's node_modules as a real package. Because atlas-shared
#     ships its `.ts` source (its `exports` resolve to `./src/*.ts` via a
#     `default` condition — there is NO build step) and the server runs via tsx,
#     the deploy tree carries atlas-shared's source intact and tsx resolves
#     `atlas-shared`, `atlas-shared/schemas`, `atlas-shared/schemas/ws`, and
#     `atlas-shared/geo` exactly as in dev.
#   - the workspace descriptor below lists BOTH `.` (atlas-shared, the root) and
#     `server` as members so the `atlas-server -> atlas-shared` `workspace:*`
#     link resolves during install.
#
# Build context: `projects/atlas/` (NOT the repo root). The workspace-root
# lockfile is not in this context; this stage writes a tiny isolated
# pnpm-workspace.yaml and resolves against the manifests (the pulse/meld
# precedent). atlas has no `packages/*` upstream.
#
# This Dockerfile builds atlas-server ONLY. The Next frontend (atlas-web) is
# built by the SEPARATE `Dockerfile.web` and shipped as its own Fly app that
# reverse-proxies the WebSocket (`/ws`) + REST to this server over Fly's private
# network so the browser is single-origin (the strict CSP `connect-src 'self'`
# holds). Two images, two apps; see DEPLOY.md.

# ---- Stage 1: server-builder ---------------------------------------------
# Materialises atlas-server's prod node_modules subset (INCLUDING the
# atlas-shared workspace dep) as a self-contained tree at /build/server-deploy
# via `pnpm deploy`. drizzle-kit + tsx live in devDeps but the entrypoint needs
# them on boot, so this stage keeps devDeps (the install footprint is small —
# Fastify + Drizzle + postgres-js + turf + faker + a few helpers).
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

# Manifests first for layer caching. atlas's ROOT package.json IS the
# atlas-shared manifest (name: "atlas-shared"), so it doubles as both the
# umbrella manifest and a workspace member. tsconfig.base.json is the shared TS
# base both packages extend. The server member manifest declares the
# `atlas-shared: workspace:*` link the isolated workspace below resolves.
COPY package.json ./
COPY tsconfig.base.json ./
COPY server/package.json ./server/

# Write a tiny isolated workspace descriptor — the repo-root one globs every
# `projects/*` member, which is not in this build context. List BOTH the root
# (".", atlas-shared) and `server` so the `atlas-server -> atlas-shared`
# workspace link resolves. Mirror the root pnpm-workspace.yaml `allowBuilds`
# allowlist so pnpm 11's "ignored build scripts" gate does not abort the install
# on esbuild (a transitive dep of vitest/tsx) or unrs-resolver.
RUN printf 'packages:\n  - "."\n  - "server"\nallowBuilds:\n  esbuild: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

# Server-subtree install. `--filter atlas-server...` resolves the server's deps
# AND its workspace dep atlas-shared. `--frozen-lockfile=false` because the
# per-project lockfile is not committed at this nesting — pnpm resolves against
# the manifests (the meld precedent).
RUN pnpm install --frozen-lockfile=false --filter atlas-server...

# Real sources. atlas-shared's source (`src/`) is needed BOTH for the install's
# workspace link AND at runtime (the server resolves atlas-shared's `.ts`
# exports via tsx). The server source (`server/src` + `server/scripts` +
# `server/drizzle` migrations + `server/drizzle.config.ts` + tsconfig). The seed
# script under server/scripts/ is needed at runtime — the entrypoint runs it.
COPY src ./src
COPY server ./server

# `pnpm deploy` produces a self-contained per-package install at
# /build/server-deploy whose node_modules does NOT depend on the workspace-root
# .pnpm store — exactly what the runtime image needs. devDeps included so
# drizzle-kit + tsx are present for the entrypoint. The atlas-shared workspace
# dep is INJECTED into the deploy tree's node_modules with its source intact
# (its exports point at `.ts`, no build artifact), so tsx resolves it at runtime.
#
# `--legacy` is required as of pnpm v10 for a non-injected workspace dep (the
# `atlas-server -> atlas-shared` link is a plain `workspace:*` dependency). The
# meld/pulse precedent.
RUN pnpm deploy --filter atlas-server --legacy /build/server-deploy

# The atlas-shared package carries its tsconfig + the shared tsconfig.base.json
# only indirectly. tsx/esbuild reads the SERVER's tsconfig.json, which
# `extends "../tsconfig.base.json"`. `pnpm deploy` copies only the server
# package, NOT the sibling base config — without it tsx would fall back to
# defaults that may differ (verbatimModuleSyntax etc.). The entrypoint runs from
# /app/server, so `../tsconfig.base.json` resolves to /app/tsconfig.base.json —
# we stage the base config in the runtime image at /app (see below).


# ---- Stage 2: runtime ----------------------------------------------------
# The image Fly.io runs. Node 22 runtime + the server source tree + its prod
# node_modules (incl. drizzle-kit + tsx + the materialised atlas-shared) + a
# tiny entrypoint.
FROM node:22-bookworm-slim AS runtime

# curl: the HEALTHCHECK instruction (a `docker run` smoke signal; Fly reads its
# own [checks] in fly.toml). ca-certificates: outbound TLS — Fly Postgres is
# sslmode=require. Both load-bearing.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root. The Node base image ships a `node` user at UID 1000 that owns its
# home dir; we run as it.
RUN mkdir -p /app/server && chown -R node:node /app
WORKDIR /app

# Server source + node_modules (incl. drizzle-kit + tsx + the seed script under
# /app/server/scripts + the materialised atlas-shared under node_modules). Node
# runs `src/main.ts` directly via the tsx loader; the source tree + package.json
# + tsconfig ship intact so import resolution + env reads behave identically to
# dev.
COPY --from=server-builder --chown=node:node /build/server-deploy /app/server

# CRITICAL: the server's tsconfig.json `extends "../tsconfig.base.json"`. The
# entrypoint runs from /app/server, so `../tsconfig.base.json` resolves to
# /app/tsconfig.base.json — ship the shared base config there so tsx/esbuild
# honours the same compiler options (verbatimModuleSyntax, moduleResolution) the
# source was authored against. (The pulse experimentalDecorators lesson, here
# for the general "tsx needs the base tsconfig" reason.)
COPY --chown=node:node tsconfig.base.json /app/tsconfig.base.json

# Entrypoint. Migrations + the idempotent demo seed run here on boot.
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh
# Strip CRLF in case Windows git autocrlf checked the file out with CRLF — the
# kernel reads `#!/usr/bin/env sh\r` as interpreter `sh\r` and refuses to exec.
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER node

# Production env defaults — fly.toml overrides where it matters. Baked so a bare
# `docker run` (with a DATABASE_URL) does something useful for a local smoke.
# PORT 3092 is the atlas-server slot (AGENT_NOTES port hygiene). RUN_MIGRATIONS /
# RUN_SEED default ON so a fresh DB is migrated + the demo definitions seeded on
# first boot (idempotent — safe to re-run every deploy).
ENV NODE_ENV=production
ENV PORT=3092
ENV RUN_MIGRATIONS=1
ENV RUN_SEED=1

# The Fastify HTTP + WS surface.
EXPOSE 3092

# Backup liveness signal for `docker run`; Fly uses its own [checks] in fly.toml
# and ignores this. The engine boots from the frozen Porto baseline (NOT the DB
# — ADR-005), so /health is up as soon as the server binds, even before the
# migrate/seed completes.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -sf http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
