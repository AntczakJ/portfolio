# tape — Production Deploy Runbook

One-page runbook for shipping `tape` to Fly.io. Owner-facing; every
command runs from `projects/tape/` unless noted.

The artifacts in this directory are the entire deploy surface:

- `Dockerfile` — multi-stage build (Rust worker, Next standalone web,
  Bun server, slim runtime).
- `entrypoint.sh` — spawns Bun server, waits for `/health`, launches
  Next web in foreground; forwards SIGTERM to both children.
- `fly.toml` — app config (`tape-demo`, region `fra`), env, HTTP +
  WS services, health checks, VM size, deploy strategy.
- `.dockerignore` — trims the build context.

No emojis. English only.

## Prerequisites

1. **flyctl installed.**
   - Windows: `irm https://fly.io/install.ps1 | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. **flyctl logged in.** Once per machine: `flyctl auth login`.

## One-time setup

Run these in order. Each step is idempotent except `postgres create`
and `launch`.

### 1. Register the app

```sh
cd projects/tape
flyctl launch --name tape-demo --region fra --no-deploy
```

`--no-deploy` is critical — the first deploy needs `DATABASE_URL`
attached, which the next step provides. `--name tape-demo` matches
the app name in `fly.toml`; if Fly says the name is taken, pick an
alternative (e.g. `tape-demo-eu`) and update both `fly.toml`'s `app =`
line AND the `ALLOWED_ORIGINS` env there.

`flyctl launch` will print "An existing fly.toml file was found"
and ask whether to copy or overwrite — **answer no / keep existing**.
The committed `fly.toml` is the source of truth.

### 2. Create Postgres

```sh
flyctl postgres create --name tape-pg --region fra
```

Pick "Development" cluster size on the prompt — the demo's tick
archive at 30-day retention stays well under the standard 1 GB
volume. Fly will print the admin credentials once; save them somewhere
safe.

### 3. Attach Postgres to the app

```sh
flyctl postgres attach tape-pg --app tape-demo
```

This creates a database + role inside the cluster and writes the
connection string to `tape-demo`'s secrets as `DATABASE_URL`. Verify:

```sh
flyctl secrets list -a tape-demo
```

Expected: `DATABASE_URL` shows up with a digest, no value (Fly hides
secret values after attach).

### 4. (Optional) Wire any additional secrets

`ALLOWED_ORIGINS` is already set as a non-secret env in `fly.toml`. If
the demo URL ever needs to embed a third-party origin (Stripe, an
auth provider in v2), add it as a secret:

```sh
flyctl secrets set ALLOWED_ORIGINS="https://tape-demo.fly.dev,https://other-origin.example.com" -a tape-demo
```

Setting a secret with the same name as a `[env]` value in `fly.toml`
overrides the env value at runtime — useful for environments where
the allowlist contains something you do not want committed.

## Deploy

From `projects/tape/`:

```sh
flyctl deploy --app tape-demo
```

First deploy takes ~5-8 minutes (Rust cold cache, Next build, both
node_modules installs). Subsequent deploys with cached layers are
~1-2 minutes.

### Watch logs during the deploy

In a separate terminal:

```sh
flyctl logs -a tape-demo
```

What to look for:

- `tape-server listening on http://localhost:3001`
- `[tape-server] CORS allowlist (env): https://tape-demo.fly.dev`
- `[tape-server] WS per-IP cap: 5 concurrent connections`
- `[worker-pipeline] WORKER_PIPELINE_ENABLED=1 — Rust worker spawned and bridge connected`
- `[binance-ingest] BINANCE_WS_ENABLED=1 — connected to Binance Futures aggTrade stream (sessionId=...)`
- `[entrypoint] starting tape-web on :3000`

If any of those are missing — see "Troubleshooting" below.

## Verify

### 1. Fly machine status

```sh
flyctl status -a tape-demo
```

Expect: one machine in state `started`, health checks passing.

### 2. /health probe

```sh
curl https://tape-demo.fly.dev/health
```

Expect a JSON body with `status: "ok"`, `db.connected: true`,
`worker.state: "connected"`, `binance.connected: true`,
`ws.connectedClients: 0`.

If `binance.connected` is `false`, the Binance feed is not reaching
the Fly machine — this is unlikely from EU infra but possible if Fly
or Binance has temporary issues. Wait 30 s and re-probe; if still
false, check `flyctl logs` for `[binance-ingest]` reconnect lines.

### 3. Browser load

Open `https://tape-demo.fly.dev` in a browser. Expect:

- Page renders with the layout shell (top bar, side rail, status
  bar, chart area).
- After ~1-2 seconds the WS connects (status bar "WS" pip flips to
  the connected color, "Ticks" counter starts climbing).
- The Canvas2D footprint chart begins drawing cells as bars close
  (1 minute granularity in v1 — give it a minute on a quiet market
  to see the first cells).

## Rollback

List recent releases:

```sh
flyctl releases -a tape-demo
```

The output shows release version + image digest. To roll back:

```sh
flyctl deploy --image registry.fly.io/tape-demo:deployment-XXX -a tape-demo
```

where `XXX` is the version digest from the `flyctl releases` output.
Rollback is a normal deploy under the hood, so it goes through the
same rolling-strategy health-check window.

## Troubleshooting

### Logs show `DATABASE_URL is required to boot`

You ran `flyctl deploy` before `flyctl postgres attach`. Run the
attach step and redeploy.

### Logs show `CORS allowlist is EMPTY in production`

The `ALLOWED_ORIGINS` env in `fly.toml` was removed or never set, and
no secret is overriding it. Same-origin requests still work (the demo
URL → its own server) but any external embed will be blocked. Set it:

```sh
flyctl secrets set ALLOWED_ORIGINS="https://tape-demo.fly.dev" -a tape-demo
```

This triggers a redeploy automatically.

### /health returns `binance.connected: false` for more than 5 minutes

Either Binance is having a regional issue (rare) or Fly's egress IP
got temporarily flagged. Check the latest `[binance-ingest]` log
lines — if `parseErrors` is climbing, the feed shape changed and a
code fix is needed; if `restartCount` is climbing without
`parseErrors`, it is purely a network-layer issue and the
ingestor's exponential backoff will recover.

### `flyctl deploy` build OOMs

Rust LTO + the Next build can spike memory during compile. Fly's
default build machine has 8 GB which is fine, but if you ever see
the build fail with an OOM kill, pin a larger builder explicitly:

```sh
flyctl deploy --build-secret BUILDER_SIZE=performance-2x --app tape-demo
```

### Postgres connection refused after a long quiet period

Fly Managed Postgres has its own scale-to-zero behaviour on the
Development tier. The first connection after idle can time out; the
tick writer's `getDb()` has no retry on the initial pool open. If
this shows up in practice, the fix is to bump the Postgres cluster
to the smallest paid tier (~$2/mo). Track under "Decisions to
revisit" if it actually bites; not a v1 concern.

## Cost expectations

- App machine (shared-cpu-1x, 512 MB, scale-to-zero, EU): ~$0–3 / mo
  for demo traffic.
- Postgres Development cluster (shared-cpu-1x, 1 GB volume): free
  tier first, ~$2–4 / mo if it escapes the free allowance.
- Bandwidth: ~$0 / mo for demo traffic; ~$0.02 / GB egress beyond
  the free tier.

Expected total: under $10 / mo for a low-traffic demo. If the
commercial-seed thesis validates and traffic climbs, the obvious
next step is bumping the machine to `shared-cpu-2x` + 1 GB.
