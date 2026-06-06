#!/usr/bin/env sh
# atlas-server — production container entrypoint (ADR-007).
#
# ONE process, ONE machine, kept warm: the Fastify server that runs the
# in-process simulation engine + the @fastify/websocket telemetry gateway + the
# small REST surface. There is NO worker, NO broker, NO Redis (ADR-002/ADR-007)
# — so this entrypoint is a straight-line migrate -> seed -> exec, not a
# role-aware fan-out (contrast pulse, which had web/worker roles).
#
# Pipeline:
#   1. Run drizzle migrations (gated on RUN_MIGRATIONS=1; default ON). Idempotent
#      — an already-migrated DB is a fast no-op.
#   2. Run the idempotent demo seed (gated on RUN_SEED=1; default ON) so the
#      deployed map has its hand-authored Porto definitions (routes/stops/zones/
#      fleet) + a tick-0 telemetry snapshot for the SSR floor + reconnect
#      reconcile (ADR-005). The seed is `faker.seed(n)`-deterministic + every
#      write is an upsert, so re-running on every deploy is safe.
#   3. exec the Fastify server (HTTP + WS + the live engine) on :PORT.
#
# CREDIBILITY NOTE (ADR-005): the engine is the LIVE source of truth and boots
# from the FROZEN Porto baseline DIRECTLY (porto-fixture.ts), NOT from the DB.
# The persistence sink catches + logs every DB failure off the tick hot path and
# never propagates it into the loop (AGENT_NOTES Phase 4.1 "DB-LESS RESILIENCE").
# So the fleet MOVES and the live WS channel WORKS even if migrate/seed is
# skipped or the DB is briefly unavailable — but on Fly the DB is attached, so
# we migrate + seed so the feed/snapshot reads have a populated floor. A seed
# failure is therefore NON-FATAL: a deploy must not be blocked by a seed hiccup
# (the moving fleet + the live WS still work), so we log and continue.
#
# Fly's [deploy] runs this image's ENTRYPOINT; the start command (if any) is
# appended as args. We accept an explicit full command (an ops one-off) verbatim
# via `exec "$@"`, otherwise run the migrate -> seed -> server pipeline. A bare
# `docker run` (no args) takes the pipeline path too.
#
# SIGTERM is the orchestrator shutdown signal (Fly rolling deploys / restarts).
# We `exec` the Node process so it becomes PID 1 and Node's own signal handling
# drains the graceful shutdown in main.ts (engine.stop() flushes the sink, then
# app.close() drains live sockets, then the postgres pool ends).
#
# POSIX /bin/sh (dash on the slim base image) — stay portable.

set -eu

SERVER_PORT="${PORT:-3092}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"
RUN_SEED="${RUN_SEED:-1}"

# Honour an explicit full command if Fly / an operator supplies one.
if [ "$#" -gt 0 ]; then
    echo "[entrypoint] explicit command supplied — exec: $*" >&2
    exec "$@"
fi

run_migrations() {
    if [ "$RUN_MIGRATIONS" = "1" ]; then
        echo "[entrypoint] running drizzle migrations" >&2
        cd /app/server
        # Invoke drizzle-kit's CJS entry directly to bypass corepack (which would
        # otherwise try to honour a `packageManager` field up the tree and
        # network-download pnpm on every boot — the meld lesson). drizzle-kit
        # reads DATABASE_URL from the env Fly injected via `postgres attach`.
        # Idempotent — an already-migrated DB is a fast NO-OP.
        if ! node ./node_modules/drizzle-kit/bin.cjs migrate; then
            echo "[entrypoint] drizzle migration failed — aborting" >&2
            exit 1
        fi
    else
        echo "[entrypoint] RUN_MIGRATIONS=$RUN_MIGRATIONS — skipping migrations" >&2
    fi
}

run_seed() {
    if [ "$RUN_SEED" != "1" ]; then
        echo "[entrypoint] RUN_SEED=$RUN_SEED — skipping demo seed" >&2
        return 0
    fi
    echo "[entrypoint] seeding demo city (idempotent — Porto routes/zones/fleet + tick-0 snapshot)" >&2
    cd /app/server
    # The seed is deterministic (`faker.seed(n)`) + every write is an upsert, so
    # re-running on every deploy converges to the same rows. It runs via tsx (the
    # same loader the server uses). A seed failure is NON-FATAL — the moving
    # fleet + the live WS channel do not depend on the DB (engine is the source
    # of truth, ADR-005), so we log and continue rather than abort the deploy.
    if ! node --import tsx scripts/seed.ts; then
        echo "[entrypoint] WARNING: demo seed failed — continuing (non-fatal; the live engine + WS do not depend on the DB)" >&2
    fi
}

run_migrations
run_seed

echo "[entrypoint] starting atlas-server (Fastify + engine + WS) on :${SERVER_PORT}" >&2
cd /app/server
exec env PORT="$SERVER_PORT" HOSTNAME="0.0.0.0" node --import tsx src/main.ts
