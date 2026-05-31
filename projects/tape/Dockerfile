# syntax=docker/dockerfile:1.7
#
# tape — production image for Fly.io.
#
# Four stages so the runtime image carries only what is needed to
# serve traffic. The build is co-located in the same image rather
# than split into a multi-process Fly app (one machine per service)
# because v1 traffic is dominated by the per-client WebSocket and
# splitting would add coordination cost (an extra hop for /api/*
# calls, a private network between machines) for no scale win at
# single-instance demo traffic.
#
# Build assumes the build context is `projects/tape/` (NOT the repo
# root). The pnpm workspace's root lockfile (`/Portfolio/pnpm-lock.yaml`)
# is not in this context — instead each stage pulls the per-project
# subset it needs and runs an isolated install. If the workspace grows
# cross-project shared packages this needs revisiting; today the tape
# project has no `packages/*` upstream of it.
#
# Single-image vs split (documented trade-off):
#   - single image (this Dockerfile) — one Fly Machine, entrypoint
#     fan-out, simpler logs, shared filesystem for the bridge UDS at
#     /tmp/tape-bridge.sock, one health check covers everything.
#   - split (v2 candidate) — `[processes]` block in fly.toml with
#     `server = "bun run src/server.ts"` and `web = "node web/server.js"`,
#     scale each independently. Pay an internal network hop for any
#     /api call. Requires a separate Postgres tunnel and a
#     non-`/tmp` location for the bridge UDS (or move the worker into
#     the server machine and keep the web machine pure).
#
# v1 picks single. Document the split path in DEPLOY.md.

# ---- Stage 1: rust-builder -----------------------------------------------
# Compiles the Rust worker once, in release profile. Cached against the
# `worker/Cargo.toml + Cargo.lock` layer so a source-only change rebuilds
# in seconds.
FROM rust:1.96-bookworm AS rust-builder
WORKDIR /build

# Copy the manifests first so dependency-resolution caches before the
# source layer invalidates. The `dummy lib` trick (touch src/lib.rs and
# build) is how we get cargo to populate ~/.cargo/registry before the
# real sources land. Skipped here because the worker's source is small;
# the BuildKit cache mounts below give us the same win without the
# scaffolding overhead.
COPY worker/Cargo.toml worker/Cargo.lock* ./worker/
# `cargo build --release --bin worker` needs the .cargo/config.toml
# (TS_RS_EXPORT_DIR pinning) but the bridge:check pipeline is a dev
# concern — production builds only need the worker binary itself.
COPY worker/.cargo ./worker/.cargo
COPY worker/src ./worker/src

# BuildKit cache mounts on the registry + target dir survive across
# builds, so a `worker/src/bin/worker.rs` edit only recompiles the
# affected crate, not the full dependency graph.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/worker/target \
    cd worker && \
    cargo build --release --bin worker && \
    # Copy the built binary OUT of the cache mount so the next stages
    # can COPY --from=rust-builder. The cache mount is invisible to
    # later FROMs.
    cp target/release/worker /build/worker-bin


# ---- Stage 2: web-builder ------------------------------------------------
# Builds the Next.js standalone bundle. The bundle lands at
# `web/.next/standalone/` and brings the minimal subset of node_modules
# the server runtime needs; the rest is dropped.
FROM oven/bun:1.3-debian AS web-builder
WORKDIR /build

# pnpm via corepack — Bun's base image ships Node, which is what we
# need for `pnpm` (pnpm itself runs on Node). `corepack enable`
# unpacks the bundled pnpm; the explicit `prepare` call pins the
# version so the build is reproducible.
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.14.4/pnpm-linux-x64" \
        -o /usr/local/bin/pnpm && chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# Workspace skeleton — a thin pnpm-workspace.yaml + a minimal root
# package.json so pnpm resolves the workspace links between
# `tape-server` and `tape-web`. The Next build needs `tape-server`
# resolved (types-only import via `tape-web/src/lib/api/treaty.ts`).
COPY package.json ./
COPY tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
# Write a tiny isolated workspace descriptor — the repo-root one
# globs ALL projects, which we do not have in this context.
RUN printf 'packages:\n  - "server"\n  - "web"\n' > pnpm-workspace.yaml

# Install dependencies for both halves in one pass. `--ignore-scripts`
# would skip msgpackr's native extract build; let it run so the
# runtime image inherits the prebuilt artifact.
RUN pnpm install --frozen-lockfile=false

# Now copy the real sources and build the web bundle. The server
# source is needed because `tape-web` imports `tape-server` for
# types-only inference (Eden Treaty App type).
COPY server ./server
COPY web ./web

# Next 15 emits a standalone server at web/.next/standalone when
# `output: 'standalone'` is set in next.config.ts (verified Phase 6).
RUN pnpm -F tape-web build


# ---- Stage 3: server-builder ---------------------------------------------
# Installs the server's dependencies as a separate stage so the runtime
# image gets a slimmer node_modules subset. Bun runs `.ts` directly so
# there is no compile step — this stage exists to materialise the
# pnpm-resolved node_modules tree in a layer Stage 4 can copy.
FROM oven/bun:1.3-debian AS server-builder
WORKDIR /build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.14.4/pnpm-linux-x64" \
        -o /usr/local/bin/pnpm && chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN printf 'packages:\n  - "server"\n  - "web"\n' > pnpm-workspace.yaml

# Server-only install. `--filter` keeps the deps tree narrow so the
# runtime layer is smaller — the web side already shipped its
# standalone bundle from Stage 2.
RUN pnpm install --frozen-lockfile=false --filter tape-server...

COPY server ./server

# pnpm deploy: produces a self-contained per-package install at
# /build/server-deploy with a node_modules tree that does NOT depend
# on the workspace root .pnpm store. Including dev deps because
# drizzle-kit (entrypoint migration runner) lives there.
RUN pnpm deploy --filter tape-server /build/server-deploy


# ---- Stage 4: runtime ----------------------------------------------------
# The image Fly.io actually runs. Contains the Bun runtime + the Rust
# worker binary + the Next standalone bundle + a tiny entrypoint.
FROM oven/bun:1.3-debian AS runtime

# curl is needed by the entrypoint health probe AND the HEALTHCHECK
# instruction. ca-certificates is needed for outbound TLS — Binance
# Futures WebSocket is wss://, Postgres-on-Fly is sslmode=require by
# default, and any future replay archive fetch from data.binance.vision
# is HTTPS.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.14.4/pnpm-linux-x64" \
        -o /usr/local/bin/pnpm && chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# Non-root user — `bun` is provided by the oven/bun base image at UID
# 1000 and owns its own home directory. We chown the runtime app dir
# to it so the entrypoint can write logs / temp files without
# escalating.
RUN mkdir -p /app/server /app/web /app/worker && \
    chown -R bun:bun /app

WORKDIR /app

# 1. Rust worker binary — single file, executable.
COPY --from=rust-builder --chown=bun:bun /build/worker-bin /app/worker/worker
RUN chmod +x /app/worker/worker

# 2. Server source + node_modules. Bun runs `src/server.ts` directly,
# so we ship the source tree intact alongside the resolved
# node_modules. The server's package.json + tsconfig stay so the
# runtime's `import` resolution and any `process.env` reads behave
# identically to dev.
COPY --from=server-builder --chown=bun:bun /build/server-deploy /app/server

# 3. Next standalone bundle. Next 15's standalone output puts a
# self-contained server.js + the minimal node_modules in
# .next/standalone/. Static assets (.next/static + public) are
# emitted separately and have to be copied alongside.
#
# The Next standalone server resolves the project files relative to
# its own location, so the layout under /app/web mirrors what `next
# build` produced.
COPY --from=web-builder --chown=bun:bun /build/web/.next/standalone /app/web
# Static + public paths mirror the standalone server's own nesting.
# Because Next's outputFileTracingRoot resolves to / inside the
# container, the bundle nests as /app/web/build/web/server.js, and
# the standalone server expects its sibling .next/static + public
# alongside the server.js — so the COPY targets must point there,
# not at /app/web/web/.
COPY --from=web-builder --chown=bun:bun /build/web/.next/static /app/web/build/web/.next/static
COPY --from=web-builder --chown=bun:bun /build/web/public /app/web/build/web/public

# 4. Entrypoint script.
COPY --chown=bun:bun entrypoint.sh /app/entrypoint.sh
# Strip CRLF in case Windows git autocrlf checked the file out with
# CRLF endings — the kernel reads `#!/usr/bin/env sh\r` as interpreter
# `sh\r` and refuses to exec.
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER bun

# Production env defaults — fly.toml overrides where it matters.
# These are baked into the image so a `docker run` without --env
# still does something useful.
ENV NODE_ENV=production
ENV PORT=3001
ENV WEB_PORT=3000
# Worker binary path (per Task 1.5 + AGENT_NOTES). The supervisor's
# default resolver assumes the dev layout (`projects/tape/worker/target/...`);
# in production we explicitly point at the runtime location.
ENV BRIDGE_WORKER_BIN=/app/worker/worker
# Bridge UDS path inside the container. Co-located with the worker
# (same PID-1 process tree), so /tmp is fine — Fly's persistent
# volume is not in play here.
ENV BRIDGE_PATH=/tmp/tape-bridge.sock

EXPOSE 3000 3001

# The healthcheck is a backup signal for `docker run` use. Fly.io
# reads its own [checks] section in fly.toml and ignores this — but
# leaving it documents the canonical liveness URL and helps any
# `docker run` smoke against the image locally.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -sf http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
