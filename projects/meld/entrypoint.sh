#!/usr/bin/env sh
# meld — production container entrypoint.
#
# Pipeline:
#
#   1. Run drizzle migrations (gated on RUN_MIGRATIONS=1; default ON).
#   2. Spawn the Hono + Hocuspocus server in the background on :3001.
#   3. Wait for the server's /health to return 200.
#   4. Spawn the Next.js standalone server in the background on :3000.
#   5. `wait -n` on either child — first to exit takes the container
#      down. SIGTERM is forwarded to both via the shutdown trap.
#
# SIGTERM is the canonical orchestrator shutdown signal. Fly.io's
# Machines API sends it on `flyctl apps restart`, on rolling deploys,
# and on machine scale-to-zero. We trap it and forward to both
# children so meld-server can flush pending Hocuspocus snapshots
# (Task 1.3 storage adapter `flushPendingStores()`) and the Next
# server can close keepalive connections cleanly.
#
# Why /bin/sh and not /bin/bash: the runtime base image is
# `node:22-bookworm-slim` which ships dash as /bin/sh and has bash
# available, but staying POSIX keeps the entrypoint portable if the
# base image is changed in v2 (e.g., distroless).

set -eu

SERVER_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${SERVER_PORT}/health"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-30}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"

server_pid=""
web_pid=""

shutdown() {
    # Idempotent — the trap can fire twice during a rapid SIGTERM +
    # SIGINT sequence. `kill 0 $pid` is portable to dash / busybox sh.
    echo "[entrypoint] received shutdown signal — forwarding SIGTERM to children" >&2
    if [ -n "$web_pid" ] && kill -0 "$web_pid" 2>/dev/null; then
        kill -TERM "$web_pid" 2>/dev/null || true
    fi
    if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
        kill -TERM "$server_pid" 2>/dev/null || true
    fi
    # Give the children a chance to drain. Fly's machine kill grace
    # window is 5 s by default; we wait up to 10 s here so the inner
    # graceful-shutdown path (Hocuspocus pending-stores flush, http
    # server keepalive close) has time to finish. If we are still
    # alive after that, Fly's SIGKILL will end us — acceptable last
    # resort.
    wait 2>/dev/null || true
}

trap shutdown TERM INT

# ---- Step 1: Drizzle migrations --------------------------------------
#
# drizzle-kit reads DATABASE_URL from the env Fly injected via
# `flyctl postgres attach`. Idempotent — re-applying a no-op migration
# set is a fast NOOP. If the migration fails the whole container
# fails fast so Fly's restart policy stops cycling on a broken schema.
#
# RUN_MIGRATIONS=0 disables this step entirely (for ops scenarios where
# the operator wants to deploy the image without touching the DB —
# e.g., backfilling a snapshot column manually first).
if [ "$RUN_MIGRATIONS" = "1" ]; then
    echo "[entrypoint] running drizzle migrations" >&2
    cd /app/server
    # Invoke drizzle-kit's CJS entry directly to bypass corepack —
    # the runtime image has pnpm installed but corepack would try to
    # honour a `packageManager` field somewhere up the workspace tree
    # and trigger a network download of pnpm@<minor> on every boot
    # (verified Phase 6.1 local smoke). The CJS entry runs with the
    # `node` binary directly; drizzle-kit reads DATABASE_URL from the
    # env Fly injected via `flyctl postgres attach`. Idempotent — re-
    # applying a no-op migration set is a fast NOOP.
    if ! node ./node_modules/drizzle-kit/bin.cjs migrate; then
        echo "[entrypoint] drizzle migration failed — aborting" >&2
        exit 1
    fi
else
    echo "[entrypoint] RUN_MIGRATIONS=$RUN_MIGRATIONS — skipping drizzle migrations" >&2
fi

# ---- Step 2: meld-server --------------------------------------------
#
# Node runs the TypeScript entrypoint via `tsx`'s loader hook. The
# server reads DATABASE_URL, MELD_ALLOWED_ORIGINS, WS_DEBOUNCE_MS, etc.
# from the environment Fly.io injected from `[env]` + `flyctl secrets`.
#
# PORT and HOSTNAME are bound to 0.0.0.0:3001 so Fly's proxy can reach
# the Hono + Hocuspocus listener on the container's external interface.
echo "[entrypoint] starting meld-server on :${SERVER_PORT}" >&2
cd /app/server
PORT="$SERVER_PORT" HOSTNAME="0.0.0.0" node --import tsx src/server.ts &
server_pid=$!

# Wait for /health 200 before launching the Next server, so any client
# arriving in the first 100 ms of boot does not see a 502 on the
# /api/* proxy path. curl is in the runtime image.
echo "[entrypoint] waiting up to ${HEALTH_TIMEOUT_SEC}s for ${HEALTH_URL}" >&2
elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT_SEC" ]; do
    if curl -sf -o /dev/null "$HEALTH_URL"; then
        echo "[entrypoint] meld-server is healthy after ${elapsed}s" >&2
        break
    fi
    # Surface the case where the server crashed during boot — no
    # point waiting the full timeout if the child already exited.
    if ! kill -0 "$server_pid" 2>/dev/null; then
        echo "[entrypoint] meld-server exited before /health returned 200 — aborting" >&2
        exit 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ "$elapsed" -ge "$HEALTH_TIMEOUT_SEC" ]; then
    echo "[entrypoint] /health did not return 200 within ${HEALTH_TIMEOUT_SEC}s — aborting" >&2
    kill -TERM "$server_pid" 2>/dev/null || true
    exit 1
fi

# ---- Step 3: meld-web (Next standalone) -----------------------------
#
# Next 15 standalone output mirrors the cwd path under
# outputFileTracingRoot. In the container the tracing root resolves to
# one hop above `web/` (web/next.config.ts pins
# `new URL('../', import.meta.url)`), so the standalone bundle nests
# as /app/web/web/server.js. Find it defensively in case future Next
# versions change the layout.
echo "[entrypoint] locating Next standalone server.js" >&2
WEB_SERVER_JS=$(find /app/web -maxdepth 5 -name 'server.js' -type f | head -1)
if [ -z "$WEB_SERVER_JS" ]; then
    echo "[entrypoint] could not locate web server.js under /app/web — aborting" >&2
    kill -TERM "$server_pid" 2>/dev/null || true
    exit 1
fi
WEB_DIR=$(dirname "$WEB_SERVER_JS")
echo "[entrypoint] web server.js at $WEB_SERVER_JS" >&2

# The standalone server.js binds to PORT (Next reads it). HOSTNAME is
# set to 0.0.0.0 so Fly's edge proxy reaches it on the private
# interface when the catch-all is wired in v2. In v1 the Hono server
# at :3001 is the canonical external surface; Next runs on the same
# IP at :3000 so a future v1.1 catch-all proxy on the server side can
# forward via 127.0.0.1:3000 without a DNS hop.
echo "[entrypoint] starting meld-web on :${WEB_PORT}" >&2
cd "$WEB_DIR"
PORT="$WEB_PORT" HOSTNAME="0.0.0.0" node server.js &
web_pid=$!

# ---- Step 4: supervise ----------------------------------------------
#
# Wait on either child. The first to exit takes the container down;
# the shutdown handler above cleans up the other. Fly's restart
# policy then brings the Machine back per the configured strategy.
wait -n 2>/dev/null || wait
exit_code=$?

echo "[entrypoint] a child process exited with code ${exit_code} — shutting down" >&2
shutdown
exit "$exit_code"
