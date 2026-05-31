#!/usr/bin/env sh
# tape — production container entrypoint.
#
# Spawns the Bun server in the background, waits for the /health
# endpoint to return 200, then starts the Next.js standalone web
# server in the foreground (so PID 1 keeps the container alive and
# Fly.io's restart policy sees the right process).
#
# SIGTERM is the canonical orchestrator shutdown signal. Fly.io's
# Machines API sends it on `flyctl apps restart`, on rolling deploys,
# and on machine scale-to-zero. We trap it and forward to both
# children so the Bun server has a chance to drain its tick writer
# (50 ms coalescing window + final flush) and the Next server can
# close keepalive connections cleanly.
#
# Why /bin/sh and not /bin/bash: the runtime base image is
# `oven/bun:1.3-debian` which has bash, but the slimmer fallback
# (`debian:bookworm-slim`) does not by default. Sticking to POSIX sh
# keeps the entrypoint portable if the base image is changed in v2.

set -eu

SERVER_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${SERVER_PORT}/health"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-30}"

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
    # graceful-shutdown path (tick writer flush, server.ts shutdown())
    # has time to finish. If we are still alive after that, Fly's
    # SIGKILL will end us — that is acceptable last resort.
    wait 2>/dev/null || true
}

trap shutdown TERM INT

echo "[entrypoint] running drizzle migrations" >&2
cd /app/server
# drizzle-kit reads DATABASE_URL from the env Fly injected via
# `flyctl postgres attach`. Idempotent — re-applying a no-op
# migration set is a fast NOOP. If the migration fails the whole
# container fails fast so Fly's restart policy stops cycling on a
# broken schema.
if ! pnpm exec drizzle-kit migrate; then
    echo "[entrypoint] drizzle migration failed — aborting" >&2
    exit 1
fi

echo "[entrypoint] starting tape-server on :${SERVER_PORT}" >&2
# bun runs the TypeScript entrypoint directly. The server reads
# DATABASE_URL, ALLOWED_ORIGINS, BINANCE_WS_ENABLED, etc. from the
# environment Fly.io injected from `[env]` + `flyctl secrets`.
bun run src/server.ts &
server_pid=$!

# Wait for /health 200 before launching the web server, so the
# Next.js client's first call to /api/health does not see "API
# offline" on a fresh deploy. curl is in the runtime image.
echo "[entrypoint] waiting up to ${HEALTH_TIMEOUT_SEC}s for ${HEALTH_URL}" >&2
elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT_SEC" ]; do
    if curl -sf -o /dev/null "$HEALTH_URL"; then
        echo "[entrypoint] server is healthy after ${elapsed}s" >&2
        break
    fi
    # Surface the case where the server crashed during boot — no
    # point waiting the full 30 s if the child already exited.
    if ! kill -0 "$server_pid" 2>/dev/null; then
        echo "[entrypoint] server exited before /health returned 200 — aborting" >&2
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

echo "[entrypoint] starting tape-web on :${WEB_PORT}" >&2
# Next 15 standalone output mirrors the cwd path under outputFileTracingRoot.
# In the container the tracing root resolves to / (web/next.config.ts uses
# `new URL('../../../', import.meta.url)` which climbs above /build/) so the
# standalone bundle nests as /app/web/build/web/server.js. Find it
# defensively in case future Next versions change the layout.
WEB_SERVER_JS=$(find /app/web -maxdepth 5 -name 'server.js' -type f | head -1)
if [ -z "$WEB_SERVER_JS" ]; then
    echo "[entrypoint] could not locate web server.js under /app/web — aborting" >&2
    exit 1
fi
WEB_DIR=$(dirname "$WEB_SERVER_JS")
echo "[entrypoint] web server.js at $WEB_SERVER_JS" >&2
cd "$WEB_DIR"
# The standalone server.js binds to PORT (Next reads it). HOSTNAME
# is set to 0.0.0.0 so Fly's proxy can reach it on the container's
# private interface. We exec into the foreground so the web process
# inherits PID-1 status: when it exits, the container exits, Fly
# restarts the machine per the configured restart policy.
PORT="$WEB_PORT" HOSTNAME="0.0.0.0" node server.js &
web_pid=$!

# Wait on either child. The first to exit takes the container down;
# the shutdown handler above cleans up the other.
wait -n 2>/dev/null || wait
exit_code=$?

echo "[entrypoint] a child process exited with code ${exit_code} — shutting down" >&2
shutdown
exit "$exit_code"
