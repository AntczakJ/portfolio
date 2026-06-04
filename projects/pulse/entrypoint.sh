#!/usr/bin/env sh
# pulse-api — production container entrypoint (ADR-006).
#
# ONE image, TWO roles selected by PROCESS_ROLE (`web` | `worker`). On Fly the
# [processes] block sets the start command directly per process, which BYPASSES
# this entrypoint — but Fly still runs the image's ENTRYPOINT and appends the
# process command as args, so this script honours an explicit command if given
# (`exec "$@"`) and otherwise launches the role from PROCESS_ROLE. That keeps a
# bare `docker run` (entrypoint default) and the Fly [processes] form both
# working.
#
# Pipeline:
#
#   web role:
#     1. Run drizzle migrations (gated on RUN_MIGRATIONS=1; default ON).
#     2. Run the idempotent demo seed (gated on RUN_SEED=1; default ON) so the
#        deployed demo is rich + the public status page works (ADR-006 seed-once,
#        idempotent). Targets the app's OWN public host so the SSRF guard allows
#        the demo arc to complete (DEMO_FLAKY_URL / PUBLIC_API_ORIGIN).
#     3. exec the NestJS web server (HTTP + SSE + better-auth) on :PORT.
#
#   worker role:
#     1. Wait for Postgres to be reachable + migrated (the web role owns
#        migrations; the worker only needs the schema present). It polls a
#        trivial query via the same DATABASE_URL.
#     2. exec the BullMQ worker (probe + rollup + GC). No HTTP, no /health.
#
# SIGTERM is the orchestrator shutdown signal (Fly rolling deploys / restarts /
# scale). We `exec` the Node process so it becomes PID 1 of the role and Node's
# own signal handling drains the Nest shutdown hooks (pool drain, BullMQ queue
# drain on OnModuleDestroy). No backgrounding/supervision is needed because each
# Fly process is a single Node process (unlike meld's single-machine fan-out).
#
# POSIX /bin/sh (dash on the slim base image) — stay portable.

set -eu

PROCESS_ROLE="${PROCESS_ROLE:-web}"
SERVER_PORT="${PORT:-3080}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"
RUN_SEED="${RUN_SEED:-1}"
DB_WAIT_TIMEOUT_SEC="${DB_WAIT_TIMEOUT_SEC:-60}"

# Fly's [processes] block passes the process command as args to this ENTRYPOINT.
# We accept a single ROLE TOKEN (`web` | `worker`) as that command — see
# fly.toml [processes]. This keeps the migrate/seed/wait-for-db wrappers ALWAYS
# applied regardless of which process Fly launches (the start command never
# bypasses this entrypoint). A bare `docker run` with no args falls back to
# PROCESS_ROLE (default web).
if [ "$#" -gt 0 ]; then
    case "$1" in
        web|worker) PROCESS_ROLE="$1" ;;
        *)
            # An explicit full command (e.g. an ops one-off) — honour it verbatim.
            echo "[entrypoint] explicit command supplied — exec: $*" >&2
            exec "$@"
            ;;
    esac
fi

run_migrations() {
    if [ "$RUN_MIGRATIONS" = "1" ]; then
        echo "[entrypoint] running drizzle migrations" >&2
        cd /app/server
        # Invoke drizzle-kit's CJS entry directly to bypass corepack (which would
        # otherwise try to honour a `packageManager` field up the tree and
        # network-download pnpm on every boot — the meld lesson). drizzle-kit
        # reads DATABASE_URL from the env Fly injected via `postgres attach`.
        # Idempotent — a no-op migration set is a fast NOOP.
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
    cd /app/server

    # The demo monitor must target the app's OWN PUBLIC host so the SSRF guard
    # ALLOWS it (a public host, inside the allowlist) AND the full incident arc
    # (open -> recover -> close) completes on the deployed demo. DEMO_FLAKY_URL
    # takes precedence; else derive it from PUBLIC_API_ORIGIN (the clean public
    # host — NOT an ngrok hostname, NOT loopback). If neither is set we still
    # seed (the monitor will record ssrf_blocked locally) but log loudly.
    if [ -z "${DEMO_FLAKY_URL:-}" ] && [ -n "${PUBLIC_API_ORIGIN:-}" ]; then
        DEMO_FLAKY_URL="${PUBLIC_API_ORIGIN%/}/demo/flaky"
        export DEMO_FLAKY_URL
    fi
    echo "[entrypoint] seeding demo data (idempotent). DEMO_FLAKY_URL=${DEMO_FLAKY_URL:-<unset>}" >&2

    # All three seeds are idempotent (upsert on stable keys / wipe-and-rewrite
    # the seeded historical window). Safe to re-run on every deploy. They run
    # via tsx (the same loader the server uses). A seed failure is NON-FATAL —
    # a deploy must not be blocked by a seed hiccup (the live board + auth still
    # work), so we log and continue rather than abort.
    seed_one() {
        echo "[entrypoint] seed: $1" >&2
        if ! node --import tsx "scripts/$1"; then
            echo "[entrypoint] WARNING: seed $1 failed — continuing (non-fatal)" >&2
        fi
    }
    # Order matters: the monitor first (creates the target + schedule), then its
    # believable 30d history + closed incidents, then the public page join.
    seed_one "seed-demo-monitor.ts"
    seed_one "seed-demo-history.ts"
    seed_one "seed-public-page.ts"
}

wait_for_db() {
    # The worker needs the schema present (the web role owns migrations). Poll a
    # trivial connection via a tiny inline tsx probe using the server's own
    # postgres client, so we do not need psql in the image.
    echo "[entrypoint] worker: waiting up to ${DB_WAIT_TIMEOUT_SEC}s for Postgres" >&2
    cd /app/server
    elapsed=0
    while [ "$elapsed" -lt "$DB_WAIT_TIMEOUT_SEC" ]; do
        if node --import tsx -e "import postgres from 'postgres'; const s=postgres(process.env.DATABASE_URL,{max:1}); s\`select 1\`.then(()=>s.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));" 2>/dev/null; then
            echo "[entrypoint] worker: Postgres reachable after ${elapsed}s" >&2
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    echo "[entrypoint] worker: Postgres not reachable within ${DB_WAIT_TIMEOUT_SEC}s — starting anyway (boot reconcile will retry)" >&2
}

case "$PROCESS_ROLE" in
    worker)
        echo "[entrypoint] role=worker" >&2
        wait_for_db
        echo "[entrypoint] starting pulse worker (BullMQ probe + rollup + GC)" >&2
        cd /app/server
        exec node --import tsx src/worker.ts
        ;;
    web|*)
        echo "[entrypoint] role=web" >&2
        run_migrations
        run_seed
        echo "[entrypoint] starting pulse web (HTTP + SSE + auth) on :${SERVER_PORT}" >&2
        cd /app/server
        exec env PORT="$SERVER_PORT" HOSTNAME="0.0.0.0" node --import tsx src/main.ts
        ;;
esac
