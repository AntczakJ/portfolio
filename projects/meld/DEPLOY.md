# meld — Production Deploy Runbook

One-page runbook for shipping `meld` to Fly.io. Owner-facing; every
command runs from `projects/meld/` unless noted.

The artifacts in this directory are the entire deploy surface:

- `Dockerfile` — three-stage build (Next standalone web-builder,
  pnpm-deployed server-builder, slim runtime).
- `entrypoint.sh` — runs drizzle migrations, spawns `meld-server`
  on :3001 in the background, waits for `/health` 200, spawns Next
  standalone on :3000 in the background, supervises both via
  `wait -n`. Forwards SIGTERM to both children.
- `fly.toml` — app config (`meld-demo`, region `fra`), env, single
  HTTP service on :3001, health checks, VM size, deploy strategy.
- `.dockerignore` — trims the build context (no `node_modules`,
  `.next`, `.env`, test surfaces, docs).
- `.github/workflows/meld-deploy.yml` — `workflow_dispatch` deploy
  workflow that runs `flyctl deploy --remote-only`, verifies
  `/health`, and optionally fires the `@smoke` E2E sweep against
  the live URL.

No emojis. English only.

## Prerequisites

1. **flyctl installed.**
   - Windows PowerShell: `irm https://fly.io/install.ps1 | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. **flyctl logged in.** Once per machine: `flyctl auth login`.
3. **Docker** (optional, for local image smoke). Docker Desktop on
   Windows / macOS or `docker` CLI on Linux.

## One-time setup

Run these in order from `projects/meld/`. Each step is idempotent
except `apps create` and `postgres create`.

### 1. Register the app

```sh
cd projects/meld
flyctl apps create meld-demo --org personal
```

If `personal` isn't your default org, replace with the value from
`flyctl orgs list`. If Fly says the name is taken, pick an
alternative (e.g. `meld-demo-eu`) and update BOTH `fly.toml`'s
`app =` line AND the `MELD_ALLOWED_ORIGINS` env value to match.

Do NOT run `flyctl launch` — it would attempt to scaffold a fresh
`fly.toml` and overwrite the committed config. `apps create`
registers the name only.

### 2. Create Postgres

```sh
flyctl postgres create --name meld-db --region fra
```

Pick "Development" cluster size at the prompt — meld's snapshot
column + per-edit `board_ops` rows stay well inside the standard
1 GB volume at v1 demo scale (200 shapes per board, 30-day retention
sweep caps total growth). Fly will print the admin credentials
once; save them somewhere safe.

### 3. Attach Postgres to the app

```sh
flyctl postgres attach meld-db --app meld-demo
```

This creates a database + role inside the cluster and writes the
connection string to `meld-demo`'s secrets as `DATABASE_URL`. Verify:

```sh
flyctl secrets list -a meld-demo
```

Expected: `DATABASE_URL` shows up with a digest, no value (Fly hides
secret values after attach).

### 4. (Optional) Override `MELD_ALLOWED_ORIGINS`

`MELD_ALLOWED_ORIGINS` is set as a non-secret env in `fly.toml` to
the canonical `https://meld-demo.fly.dev`. If the demo URL ever
needs to embed a third-party origin (e.g., a Stripe checkout in a
v2 paid tier), add it as a secret:

```sh
flyctl secrets set MELD_ALLOWED_ORIGINS="https://meld-demo.fly.dev,https://other.example.com" -a meld-demo
```

Setting a secret with the same name as a `[env]` value in `fly.toml`
overrides the env value at runtime. ADR-002 fails CLOSED on an
empty allowlist in production — the server will refuse to boot
rather than accept every origin.

### 5. (Optional) Wire the deploy workflow secret

Add `FLY_API_TOKEN` to the GitHub repo's Actions secrets so the
`meld-deploy` workflow can run `flyctl deploy`:

```sh
flyctl tokens create deploy -a meld-demo
```

Copy the token output and add it under GitHub Settings → Secrets
and variables → Actions → New repository secret, name
`FLY_API_TOKEN`. The token is scoped to deploy operations on
`meld-demo` only.

## Deploy

### Option A: from your shell

From `projects/meld/`:

```sh
flyctl deploy --remote-only --app meld-demo
```

`--remote-only` ships the build to Fly's builder rather than
building locally — bypasses Docker Desktop requirement on Windows
and keeps the build cache server-side.

First deploy takes ~5–8 minutes (Next build, server `pnpm install`,
full layer cache miss). Subsequent deploys with cached layers are
~1–2 minutes.

### Option B: via the GitHub workflow

Go to Actions → meld-deploy → Run workflow → pick `env=prod` and
optionally `smoke=true` for an E2E sweep after the deploy.

The workflow runs `flyctl deploy --remote-only --app meld-demo
--config projects/meld/fly.toml --dockerfile projects/meld/Dockerfile
projects/meld`. The build context is the project directory, NOT
the repo root — matching what the Dockerfile's COPY paths expect.

### Watch logs during the deploy

In a separate terminal:

```sh
flyctl logs -a meld-demo
```

What to look for:

- `[entrypoint] running drizzle migrations`
- `[meld-ws] origin allowlist: https://meld-demo.fly.dev`
- `[meld-server] http + ws listening on http://0.0.0.0:3001`
- `[entrypoint] meld-server is healthy after Ns`
- `[entrypoint] starting meld-web on :3000`

If any of those are missing — see "Troubleshooting" below.

## Verify

### 1. Fly machine status

```sh
flyctl status -a meld-demo
```

Expect: one machine in state `started`, health checks passing.

### 2. /health probe

```sh
curl https://meld-demo.fly.dev/health
```

Expect a JSON body shaped like (the exact schema lives in
`server/src/lib/schemas/health.ts` — keep this snippet in sync):

```json
{
  "status": "ok",
  "commit": "<short-sha>",
  "ts": 1780227281052,
  "db": {
    "connected": true,
    "latencyMs": 12,
    "storage": { "compactionSweepRuns": 0, "roomsCompactedThisSweep": 0 },
    "retention": {
      "retentionDeletedCount": 0,
      "retentionEmittedCount": 0,
      "retentionLastRunMs": null
    }
  },
  "ws": {
    "connectedClients": 0,
    "roomCount": 0,
    "controlFramesOut": 0,
    "controlFramesDropped": 0,
    "rateLimitedCount": 0,
    "overrunDisconnectCount": 0
  },
  "boards": { "count": 0 },
  "session": { "mintCount": 0, "loadCount": 0 }
}
```

`db.connected: false` means the migrations did not run or Postgres
is unreachable. `ws.connectedClients > 0` after a browser tab loads
means the WS upgrade succeeded.

### 3. WebSocket smoke via wscat

```sh
npx wscat -c wss://meld-demo.fly.dev/ws/board/00000000-0000-4000-8000-000000000001 -H "Origin: https://meld-demo.fly.dev"
```

Expect a JSON welcome frame within the first second (`kind: 'welcome'`,
`protocolVersion: 1`, `session.id` = a UUID v4, `board.id` = the
sentinel test UUID). The `-H Origin:` header is REQUIRED — ADR-002
fails closed on missing Origin in production.

### 4. Browser load

Open `https://meld-demo.fly.dev` in a browser. Expect:

- The landing page renders ("Meld" wordmark, pitch, "Open a board"
  CTA, three capability cards).
- Click "Open a board" — navigates to `/board/<uuid>` with a fresh
  identity badge in the top-right (emoji + per-session OKLCH color).
- Open a second tab to the same `/board/<uuid>` URL — both tabs
  show each other's cursor as a floating dot in distinct color.

## Re-deploy

Via the GitHub workflow (recommended):

Actions → meld-deploy → Run workflow → `env=prod`.

Or from your shell:

```sh
cd projects/meld
flyctl deploy --remote-only --app meld-demo
```

## Rollback

List recent releases:

```sh
flyctl releases -a meld-demo
```

The output shows release version + image digest. To roll back to a
specific release:

```sh
flyctl releases revert <number> -a meld-demo
```

Or pin an explicit image:

```sh
flyctl deploy --image registry.fly.io/meld-demo:deployment-XXX -a meld-demo
```

where `XXX` is the version digest from the `flyctl releases` output.
Rollback is a normal deploy under the hood, so it goes through the
same rolling-strategy health-check window.

## Migrations

`entrypoint.sh` runs `pnpm exec drizzle-kit migrate` on every boot,
gated on `RUN_MIGRATIONS=1` (default ON via `fly.toml [env]`).
Migrations are idempotent — re-applying a no-op set is a fast NOOP.

### Disable migration on boot

If you need to deploy the image without touching the schema (e.g.,
backfilling a snapshot column manually first):

```sh
flyctl secrets set RUN_MIGRATIONS=0 -a meld-demo
flyctl deploy --remote-only --app meld-demo
```

After the manual backfill, flip the gate back:

```sh
flyctl secrets unset RUN_MIGRATIONS -a meld-demo
```

(or `flyctl secrets set RUN_MIGRATIONS=1` — both are equivalent
because the entrypoint's `${RUN_MIGRATIONS:-1}` defaults the unset
case to `1`.)

### Apply migrations manually

```sh
flyctl ssh console -a meld-demo
cd /app/server
pnpm exec drizzle-kit migrate
```

This runs the same migrator the entrypoint runs, against the same
`DATABASE_URL` Fly injected. Useful when iterating on a migration
that the runtime container is configured not to apply.

## Trade-offs

### Single Machine vs split processes

v1 ships a single Fly Machine running both `meld-server` (Hono +
Hocuspocus) and `meld-web` (Next standalone) via the entrypoint
fan-out. Trade-off:

- **Pro**: one health check covers everything, simpler logs,
  shared filesystem, no internal network hop for any future
  catch-all proxy, single TLS terminator.
- **Con**: cannot scale web vs server independently; a Next OOM
  kills the WS server too.

The v2 split-process path is a `[processes]` block in `fly.toml`:

```toml
[processes]
  server = "node --import tsx /app/server/src/server.ts"
  web    = "node /app/web/web/server.js"
```

With separate VMs the server stays as the canonical TLS entry on
:3001 and the web Machine joins via Fly's private network. ADR-002
is the binding ADR on the WS adapter shape — see also the
"Production topology" pin in `AGENT_NOTES.md`.

### Single image vs split images

Same single-image vs split-image trade-off the tape Dockerfile
records. v1 picks single; v2 candidate is one image per process
(reduces blast radius of a dep upgrade) — recorded as a deferred
ADR in the v2 backlog.

### CF Workers Durable Objects (v2)

ADR-001 + ADR-002 name CF Workers Durable Objects as the v2
horizontal-scale-out target: one DO per board = global edge,
sub-50 ms p99 presence latency. The Hocuspocus extension-hook
shape is preserved — the migration is "swap the transport
adapter, keep the application code". Not shipped in v1.

## Cost

Expected at demo traffic profile (single demo URL, occasional
recruiter clicks, no sustained user load):

- App machine (shared-cpu-1x, 512 MB, `auto_stop_machines=off`,
  EU): ~$5 / month (1 vCPU-month flat because we never scale to
  zero — the WS server has to stay warm).
- Postgres Development cluster (shared-cpu-1x, 1 GB volume): free
  tier first, ~$2–4 / month if egress escapes the free allowance.
- Bandwidth: ~$0 / month at demo traffic; $0.02 / GB egress beyond
  the free tier.

Expected total: ~$5–10 / month for the demo URL profile. If the
v2 thesis validates and traffic climbs, the obvious next step is
bumping the Machine to `shared-cpu-2x` + 1 GB memory; no ADR
needed for that bump.

## Observability

The `/health` JSON shape (verbatim from
`server/src/lib/schemas/health.ts`) is the canonical observability
surface for v1. The fields above all carry intent:

- `db.connected` — Postgres reachable AND the schema migrated.
- `db.storage.compactionSweepRuns` — Task 1.5 6 h sweep cadence.
- `db.retention.retentionLastRunMs` — last daily 03:00 UTC sweep.
- `ws.connectedClients` — live HocuspocusProvider connection count.
- `ws.roomCount` — distinct boards with at least one client.
- `ws.controlFramesOut` — ADR-004 control frame emission counter.
- `ws.rateLimitedCount` — ADR-002 token-bucket trips.
- `ws.overrunDisconnectCount` — 4290 close-code emissions.
- `boards.count` — total board rows (subject to retention sweep).
- `session.mintCount` / `session.loadCount` — ADR-005 cookie
  middleware activity.

`flyctl logs -a meld-demo` is the canonical log stream. Every
boot-relevant event uses a bracketed prefix (`[meld-server]`,
`[meld-ws]`, `[entrypoint]`) — grep on those when triaging.

## Secrets

Required:

- `DATABASE_URL` — set by `flyctl postgres attach meld-db --app meld-demo`.
- `FLY_API_TOKEN` (GitHub repo secret) — required for the
  `meld-deploy` workflow only. Generate via
  `flyctl tokens create deploy -a meld-demo`.

Optional:

- `MELD_ALLOWED_ORIGINS` — set if you need to override the
  `fly.toml [env]` baseline (e.g., to add a non-canonical origin
  to the allowlist).

No other secrets are required for v1. better-auth scaffolding is
wired-but-inactive per ADR-001 / PLAN.md Task 1.7 — its
`BETTER_AUTH_SECRET` will land in v2.

## Troubleshooting

### Logs show `MELD_ALLOWED_ORIGINS must be set ... in production`

The env var was unset or empty. The Hono WS server fails closed
per ADR-002. Set it:

```sh
flyctl secrets set MELD_ALLOWED_ORIGINS="https://meld-demo.fly.dev" -a meld-demo
```

This triggers a redeploy automatically.

### Logs show `DATABASE_URL is required to boot`

You ran `flyctl deploy` before `flyctl postgres attach`. Run the
attach step from "One-time setup" and redeploy.

### `flyctl deploy` build OOMs

The Next build can spike memory during compile. Fly's default
build machine has 8 GB which is fine; if you ever see an OOM kill,
pin a larger builder explicitly:

```sh
flyctl deploy --remote-only --build-arg BUILDER_SIZE=performance-2x --app meld-demo
```

### `wss://meld-demo.fly.dev/ws/board/<id>` returns 403

ADR-002 origin allowlist refused the upgrade. Check that the
client sent the `Origin: https://meld-demo.fly.dev` header (browsers
always do; `wscat` requires `-H "Origin: ..."`).

### Two-tab cursor demo shows only one cursor

Inspect DevTools → Network → WS frames in BOTH tabs. The welcome
frame's `session.id` must differ across tabs (ADR-005 multi-tab
rule: each connection is its own awareness identity). If the IDs
are identical, the cookie middleware ran but Hocuspocus's
`awarenessId` is being collapsed somewhere — file under "review
ADR-005 multi-tab path".

### Local Docker build for smoke

From `projects/meld/`:

```sh
cd projects/meld
docker build -t meld-demo:test .
docker run --rm -p 3001:3001 -p 3000:3000 \
    -e DATABASE_URL=postgres://meld:meld@host.docker.internal:5436/meld \
    -e MELD_ALLOWED_ORIGINS=http://localhost:3000 \
    -e NODE_ENV=production \
    meld-demo:test
```

Then `curl http://localhost:3001/health` should return the same
JSON shape as production. Requires the local Postgres from
`docker-compose.yml` already running on :5436. On Windows / macOS
`host.docker.internal` resolves to the host; on Linux use
`--add-host host.docker.internal:host-gateway` or point at the
host LAN IP.
