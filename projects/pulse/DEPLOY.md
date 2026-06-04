# pulse — Production Deploy Runbook

The runbook for shipping `pulse` to Fly.io per **ADR-006** — the most complex
deploy in the portfolio: a NestJS API with **two processes** (web + worker),
**Upstash Redis**, **Fly Postgres**, plus the **Next** frontend as a separate
app. Owner-facing; every command runs from `projects/pulse/` unless noted.

English only. No emojis.

## Topology at a glance (ADR-006)

```
                          ┌─────────────────────────────────────────┐
   browser ──HTTPS──▶ pulse-web (Fly app, Next 15 standalone)        │
   (single origin)      │  rewrites /api/* /public/* /demo/*         │
                        │  /monitors* /incidents* /alert-channels*   │
                        │  /health  ──▶ pulse-api.internal:3080      │
                        └───────────────┬─────────────────────────────┘
                                        │ Fly private 6PN network
                        ┌───────────────▼─────────────────────────────┐
                        │ pulse-api (Fly app, ONE image, TWO processes)│
                        │   web    : NestJS HTTP + 2x @Sse() + auth    │
                        │            + public read + /demo  (port 3080)│
                        │   worker : BullMQ probe + rollup + GC (no HTTP)
                        └──────┬──────────────────────┬────────────────┘
                               │                      │
                       Fly Postgres (fra)     Upstash Redis (fra)
                       Drizzle (2 pools)      BullMQ + pulse:events Pub/Sub
```

- **`pulse-api`** — one Docker image (`Dockerfile`), two Fly `[processes]`:
  `web` (the only one with a public `[http_service]` + `/health` check) and
  `worker` (no public service). Both `min_machines_running = 1` /
  `auto_stop_machines = 'off'` so the live board + scheduler never cold-start
  (the wow can't cold-start — tape precedent).
- **`pulse-web`** — separate Fly app (`Dockerfile.web` + `fly.web.toml`), the
  Next 15 standalone frontend that reverse-proxies the API paths to `pulse-api`
  over Fly's private network so the browser is **single-origin** (the SSE
  `EventSource` cookie-auth works first-party — ADR-003/ADR-007, the meld
  Next-proxies-API precedent).
- **Redis = Upstash** (managed), **Postgres = Fly Postgres**, region **`fra`**.

## The deploy surface (this directory)

- `Dockerfile` — pulse-api: two-stage (`pnpm deploy` server-builder → slim
  runtime). Runs TS via `tsx` (no compile, like meld); carries drizzle-kit +
  the seed scripts so the entrypoint migrates + seeds on boot. **Ships
  `tsconfig.base.json` to `/app/` so tsx honours `experimentalDecorators`** (the
  NestJS-on-tsx gotcha — see Troubleshooting).
- `Dockerfile.web` — pulse-web: Next 15 standalone (the razors-edge/meld
  one-hop-trace-root shape). Bakes `NEXT_PUBLIC_*` at the pulse-web origin
  (single-origin) and the `API_PROXY_TARGET` rewrite destination.
- `entrypoint.sh` — role-aware (`web` | `worker`). web: migrate → idempotent
  demo seed → exec `main.ts`. worker: wait-for-db → exec `worker.ts`.
- `fly.toml` — pulse-api (2 processes, web-only `/health` check, per-process VM
  sizing).
- `fly.web.toml` — pulse-web.
- `.dockerignore` — trims the context for both images.

## Prerequisites

1. **flyctl installed** and logged in (`flyctl auth login`, once per machine).
   - Windows PowerShell: `irm https://fly.io/install.ps1 | iex`
2. **Docker** (optional, for local image smoke — see the bottom section).
3. **An Upstash account is NOT separately required** — Fly provisions Upstash
   Redis through `flyctl redis create`.

## One-time setup

Run in order from `projects/pulse/`. Idempotent except `apps create`,
`postgres create`, and `redis create`.

### 1. Register both apps

```sh
cd projects/pulse
flyctl apps create pulse-api --org personal
flyctl apps create pulse-web --org personal
```

If a name is taken, pick alternatives and update BOTH the `app =` lines (in
`fly.toml` / `fly.web.toml`) AND every origin reference (`PUBLIC_API_ORIGIN`,
`CORS_ORIGINS`, `NEXT_PUBLIC_*`, `API_PROXY_TARGET`) to match. Do NOT run
`flyctl launch` — it would overwrite the committed configs. `apps create`
registers the name only.

### 2. Create + attach Fly Postgres

```sh
flyctl postgres create --name pulse-db --region fra
flyctl postgres attach pulse-db --app pulse-api
```

Pick the **Development** cluster at the prompt (single shared-cpu-1x, 1 GB
volume) — pulse's 35-day raw-result retention + hourly rollups (ADR-005) keep
growth bounded well inside 1 GB at demo scale. `attach` writes the connection
string to `pulse-api`'s secrets as `DATABASE_URL`. Verify:

```sh
flyctl secrets list -a pulse-api    # expect DATABASE_URL with a digest
```

> The **worker** process needs `DATABASE_URL` too. Because both processes are
> the same `pulse-api` app, the attach covers both — no separate attach.

### 3. Create Upstash Redis → set REDIS_URL

```sh
flyctl redis create --name pulse-redis --region fra
```

Pick the free/small plan and **eviction = no eviction** (BullMQ jobs must never
be evicted — a dropped repeatable stops a monitor probing; mirrors the local
`docker-compose` `--maxmemory-policy noeviction`). `redis create` prints the
connection URL **once** (a `rediss://` TLS URL). Set it as a secret on
`pulse-api`:

```sh
flyctl secrets set REDIS_URL="rediss://default:<token>@<host>.upstash.io:6379" -a pulse-api
```

(If you lose it: `flyctl redis status pulse-redis` shows the host; reset the
token from the Upstash dashboard via `flyctl redis dashboard pulse-redis`.)

### 4. Set the remaining pulse-api secrets

```sh
# better-auth session signing secret (>=32 bytes random).
flyctl secrets set BETTER_AUTH_SECRET="$(openssl rand -base64 32)" -a pulse-api

# better-auth canonical base URL = the origin the BROWSER uses for /api/auth/*.
# In the single-origin proxy posture the browser hits pulse-web, which proxies
# /api/auth/* to pulse-api — so BETTER_AUTH_URL is the PUBLIC WEB origin, NOT
# the api host. This is load-bearing: better-auth validates the cookie/origin
# against baseURL, and the cookie must be first-party on the web origin.
flyctl secrets set BETTER_AUTH_URL="https://pulse-web.fly.dev" -a pulse-api

# HMAC key for outbound webhook signing (ADR-005). >=16 bytes random.
flyctl secrets set WEBHOOK_SIGNING_KEY="$(openssl rand -base64 24)" -a pulse-api
```

Non-secret env already lives in `fly.toml [env]` (no need to set as secrets):
`NODE_ENV`, `PORT`, `RUN_MIGRATIONS`, `RUN_SEED`, `DEMO_TRIGGER_ENABLED`,
`PUBLIC_API_ORIGIN`, `CORS_ORIGINS`. Adjust `CORS_ORIGINS` /
`PUBLIC_API_ORIGIN` in `fly.toml` if your app names differ from the defaults.

> **The demo `/demo/flaky` target (ADR-006).** The seed points the demo monitor
> (`Checkout API`) at `PUBLIC_API_ORIGIN + /demo/flaky` =
> `https://pulse-api.fly.dev/demo/flaky` by default — the API's OWN clean PUBLIC
> host, which the SSRF guard ALLOWS, so the full open→recover→close incident arc
> completes on the deployed demo (locally on loopback it can only open via
> `ssrf_blocked`). It is the clean public host, NOT an ngrok hostname. To route
> the demo through the web proxy instead, set
> `DEMO_FLAKY_URL=https://pulse-web.fly.dev/demo/flaky` on `pulse-api`.

### 5. pulse-web secrets

pulse-web needs **no secrets** — its public config (`NEXT_PUBLIC_*`) is baked at
build time in `Dockerfile.web` and mirrored in `fly.web.toml [env]`. If your app
names differ from `pulse-web.fly.dev` / `pulse-api`, rebuild with the matching
build args (see Deploy step B).

### 6. (Optional) deploy-workflow tokens

```sh
flyctl tokens create deploy -a pulse-api   # add as GH secret FLY_API_TOKEN_API
flyctl tokens create deploy -a pulse-web   # add as GH secret FLY_API_TOKEN_WEB
```

## Deploy

**Order matters:** deploy **pulse-api first** (it runs migrations + the seed and
must be reachable on the private network before the web app proxies to it), then
**pulse-web**.

> **Run from `projects/pulse/`.** The build context is the project dir (the
> Dockerfiles' COPY paths expect it), and deploying from the project dir avoids
> the flyctl first-deploy "No machines configured" quirk (the meld lesson).

### A. Deploy pulse-api

```sh
cd projects/pulse
flyctl deploy --remote-only --app pulse-api --config fly.toml --dockerfile Dockerfile .
```

`--remote-only` builds on Fly's builder (no local Docker needed). First deploy
~5–8 min (full layer cache miss); subsequent ~1–2 min. Fly creates one machine
per process (`web` + `worker`) from the `[processes]` block.

Watch the boot in another terminal:

```sh
flyctl logs -a pulse-api
```

Look for (web machine):

- `[entrypoint] role=web`
- `[entrypoint] running drizzle migrations` → `migrations applied successfully`
- `[entrypoint] seed: seed-demo-monitor.ts` → `seed-demo-history.ts` →
  `seed-public-page.ts`
- `[Bootstrap] pulse-server (commit ...) listening on http://0.0.0.0:3080`

and (worker machine):

- `[entrypoint] role=worker` → `Postgres reachable`
- `[ProbeSchedulerService] probe schedule reconciled: N active, 0 orphan(s) swept`
- `[RetentionSchedulerService] retention schedules registered: rollup every 300s, gc every 3600s`
- `[WorkerBootstrap] pulse-worker ... No HTTP server (worker process)`

### B. Deploy pulse-web

```sh
flyctl deploy --remote-only --app pulse-web --config fly.web.toml --dockerfile Dockerfile.web .
```

If your api app is not named `pulse-api`, pass the matching proxy target:

```sh
flyctl deploy --remote-only --app pulse-web --config fly.web.toml \
  --dockerfile Dockerfile.web \
  --build-arg API_PROXY_TARGET=http://<your-api-name>.internal:3080 \
  --build-arg NEXT_PUBLIC_SITE_URL=https://<your-web-name>.fly.dev \
  --build-arg NEXT_PUBLIC_API_URL=https://<your-web-name>.fly.dev \
  --build-arg NEXT_PUBLIC_SSE_URL=https://<your-web-name>.fly.dev .
```

> **Why build args, not just `[env]`:** Next bakes `NEXT_PUBLIC_*` AND the
> `rewrites()` destination (`API_PROXY_TARGET`) into the build at BUILD time. The
> `fly.web.toml [env]` mirrors are documentation/defence-in-depth; they do NOT
> re-point an already-baked rewrite. The defaults match `pulse-web.fly.dev` +
> `pulse-api.internal`, so for the default names no build args are needed.

## Verify

### 1. Machine status

```sh
flyctl status -a pulse-api    # expect TWO machines: web (checks passing) + worker
flyctl status -a pulse-web    # expect ONE machine, check passing
```

### 2. /health (through the proxy and direct)

```sh
curl https://pulse-web.fly.dev/health     # proxied to pulse-api
curl https://pulse-api.fly.dev/health     # direct
```

Expect `{"status":"ok","commit":"<sha>","ts":"...","db":{"connected":true,...},
"redis":{"connected":true,...}}`. `status:"degraded"` means Postgres or Redis is
unreachable (check `DATABASE_URL` / `REDIS_URL`).

### 3. The board + the live SSE channel

Open `https://pulse-web.fly.dev/dashboard`. The seeded board renders rich
immediately (the demo monitor `Checkout API` + the seeded history). In DevTools →
Network, confirm **exactly ONE** `text/event-stream` connection on `/api/stream`
(single-origin, no polling loop) — the proof the real-time channel is genuine.

### 4. The demo incident arc (the wow, end-to-end)

On the dashboard click **"Trigger demo incident"**. Within ~30 s the demo card
flips down, the live incident strip materialises, the alert toast fires, and on
recovery (~45 s) the incident auto-closes. On the deployed host this is the FULL
arc (open→recover→close) because the demo target is the app's own public host
inside the SSRF allowlist. Or via curl:

```sh
curl -X POST https://pulse-web.fly.dev/demo/trigger
curl -s https://pulse-web.fly.dev/incidents | head
```

### 5. The public status page

```sh
curl https://pulse-web.fly.dev/status/demo            # SSR, redacted
curl -s https://pulse-web.fly.dev/public/demo | grep -i targeturl   # MUST be empty
```

Confirm the page shows `Checkout API` with a high uptime % and the seeded
incident history, and that the raw API payload carries NO `targetUrl` /
`responseTimeMs` / `secret` / `userId` (redaction). Lighthouse ≥ 95 in all four
categories is asserted by `lighthouserc.json` against this page.

### 6. Auth

Sign up on the dashboard → you get your OWN empty private workspace (the demo's
monitors are not yours). Sign out → back to the shared demo. An unauthenticated
`POST /monitors` returns `401 authentication_required` (the demo stays viewable,
mutations are gated — ADR-007).

## Re-deploy

```sh
cd projects/pulse
flyctl deploy --remote-only --app pulse-api --config fly.toml --dockerfile Dockerfile .
flyctl deploy --remote-only --app pulse-web --config fly.web.toml --dockerfile Dockerfile.web .
```

Migrations + the demo seed re-run on every pulse-api boot (both idempotent —
migrations no-op when applied, the seed upserts on stable keys + rewrites only
the seeded historical window, never the live forward-from-now probe data).

## Migrations

`entrypoint.sh` runs `drizzle-kit migrate` on every **web** boot
(`RUN_MIGRATIONS=1`, default ON). The worker does not migrate — it waits for the
schema, then boots. To deploy without touching the schema:

```sh
flyctl secrets set RUN_MIGRATIONS=0 -a pulse-api    # then deploy
# apply manually:
flyctl ssh console -a pulse-api -C "sh -c 'cd /app/server && node ./node_modules/drizzle-kit/bin.cjs migrate'"
flyctl secrets unset RUN_MIGRATIONS -a pulse-api    # restore default (1)
```

The seed has the same gate: `RUN_SEED=0` skips it (e.g. to deploy without
touching demo data).

## Rollback

```sh
flyctl releases -a pulse-api
flyctl releases revert <number> -a pulse-api
# (same for pulse-web)
```

A revert is a normal deploy under the hood — it goes through the rolling
health-check window. Roll back **pulse-web first** if a bad web build broke the
proxy, then pulse-api if needed.

## Cost

Demo-traffic profile (one demo URL, occasional recruiter clicks):

- **pulse-api web** (shared-cpu-1x, 512 MB, always-on): ~$4–5/mo.
- **pulse-api worker** (shared-cpu-1x, 512 MB, always-on): ~$4–5/mo.
- **pulse-web** (shared-cpu-1x, 512 MB, always-on): ~$4–5/mo.
- **Fly Postgres** (Development, shared-cpu-1x, 1 GB): free tier first,
  ~$2–4/mo beyond it.
- **Upstash Redis** (free/small tier): ~$0 at demo command volume.
- **Bandwidth:** ~$0 at demo traffic.

**Expected total: ~$10–15/mo.** This is the portfolio's most expensive deploy by
design (three always-on machines + Postgres + Upstash) — the warm floors are
the price of the wow moment never cold-starting (ADR-006). Cost-cut path: merge
web+worker into one process (ADR-006 option A2, the documented fallback) and/or
let pulse-web `auto_stop` — neither is taken in v1.

## Secrets inventory

Set on **pulse-api** (the worker + web share the app's secrets):

| Secret                | Source                                                | Used by                                |
| --------------------- | ----------------------------------------------------- | -------------------------------------- |
| `DATABASE_URL`        | `flyctl postgres attach pulse-db`                     | web + worker (Drizzle)                 |
| `REDIS_URL`           | `flyctl redis create` (Upstash `rediss://`)           | web + worker (BullMQ + `pulse:events`) |
| `BETTER_AUTH_SECRET`  | `openssl rand -base64 32`                             | web (session signing)                  |
| `BETTER_AUTH_URL`     | the **public web origin** `https://pulse-web.fly.dev` | web (cookie/origin)                    |
| `WEBHOOK_SIGNING_KEY` | `openssl rand -base64 24`                             | worker (HMAC webhook)                  |

Non-secret env in `fly.toml [env]`: `NODE_ENV`, `PORT`, `RUN_MIGRATIONS`,
`RUN_SEED`, `DEMO_TRIGGER_ENABLED`, `PUBLIC_API_ORIGIN`, `CORS_ORIGINS`.
`pulse-web` needs **no secrets** (its `NEXT_PUBLIC_*` are baked at build).

`.env.example` is committed (server + web); `.env` is never committed (root
`.gitignore` covers `.env` + `.env.*`, `!.env.example`).

## Troubleshooting

### Web boot crashes: "Parameter decorators only work when experimental decorators are enabled"

tsx/esbuild could not read `tsconfig.base.json` (NestJS uses parameter
decorators). The runtime image must ship `tsconfig.base.json` to `/app/` so the
server's `tsconfig.json` `extends "../tsconfig.base.json"` resolves — the
`Dockerfile` does this. If you change the COPY layout, keep that file present
one hop above `/app/server`.

### `/health` shows `db.connected:false`

Migrations did not run or Postgres is unreachable. Confirm `DATABASE_URL` is set
(`flyctl secrets list -a pulse-api`) and the migration log line appeared. The
worker's `wait-for-db` retries; the web aborts on a failed migration so Fly's
restart policy does not cycle on a broken schema.

### The board is frozen / no live updates

The worker machine is not running, or `REDIS_URL` is wrong (the worker→SSE
bridge rides Redis Pub/Sub `pulse:events`). Check `flyctl status -a pulse-api`
shows the worker `started`, and that `REDIS_URL` is the Upstash `rediss://` URL
on both processes (same app secret, so it is).

### The proxy returns 502 / ENOTFOUND pulse-api.internal

pulse-web's baked `API_PROXY_TARGET` does not match the api app name, or
pulse-api is not deployed yet. Deploy pulse-api FIRST; if the api name differs,
rebuild pulse-web with `--build-arg API_PROXY_TARGET=http://<name>.internal:3080`.

### The demo arc opens but never recovers

The demo monitor is targeting loopback or a blocked host (records
`ssrf_blocked`). Confirm `PUBLIC_API_ORIGIN` (or `DEMO_FLAKY_URL`) is the app's
clean PUBLIC host so the SSRF guard allows it and `/demo/flaky` actually returns
200 between arms.

## Local Docker smoke (proven before handoff)

From `projects/pulse/`, with the local Postgres + Redis up
(`docker compose -f docker-compose.yml up -d`):

```sh
# Build both images.
docker build -t pulse-api:smoke -f Dockerfile .
docker build -t pulse-web:smoke -f Dockerfile.web .

# Run the API web process (migrates + seeds on boot).
docker run -d --name pulse-api-web -p 3099:3080 \
  -e DATABASE_URL="postgres://pulse:pulse@host.docker.internal:5437/pulse" \
  -e REDIS_URL="redis://host.docker.internal:6381" \
  -e BETTER_AUTH_SECRET="local-smoke-secret-at-least-32-bytes-xxxxx" \
  -e BETTER_AUTH_URL="http://localhost:3099" \
  -e WEBHOOK_SIGNING_KEY="local-webhook-key" \
  -e PUBLIC_API_ORIGIN="http://localhost:3099" \
  -e NODE_ENV=production \
  pulse-api:smoke web
curl http://localhost:3099/health      # -> {"status":"ok","db":{connected:true},"redis":{connected:true}}

# Run the worker process (same image, "worker" role).
docker run -d --name pulse-api-worker \
  -e DATABASE_URL="postgres://pulse:pulse@host.docker.internal:5437/pulse" \
  -e REDIS_URL="redis://host.docker.internal:6381" \
  -e WEBHOOK_SIGNING_KEY="local-webhook-key" -e NODE_ENV=production \
  pulse-api:smoke worker
docker logs pulse-api-worker           # -> probe schedules reconciled, rollup/gc registered

# Run the web (proxy target = the api container via the host). API_PROXY_TARGET
# is a BUILD arg, so build a local-targeted web image for a full proxy smoke:
docker build -t pulse-web:smoke-local \
  --build-arg API_PROXY_TARGET="http://host.docker.internal:3099" -f Dockerfile.web .
docker run -d --name pulse-web -p 3098:3000 pulse-web:smoke-local
curl http://localhost:3098/             # -> 200 (landing)
curl http://localhost:3098/health       # -> proxied to pulse-api, same JSON
```

On Windows / macOS `host.docker.internal` resolves to the host; on Linux add
`--add-host host.docker.internal:host-gateway`. The full open→recover demo arc
needs the demo target to be a PUBLIC host inside the SSRF allowlist, so the
recovery beat is a DEPLOY-only verification (locally the loopback target records
`ssrf_blocked` and the arc only opens).
