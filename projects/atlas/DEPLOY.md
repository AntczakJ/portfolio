# atlas — Production Deploy Runbook

The runbook for shipping `atlas` to Fly.io per **ADR-007** — a live geospatial
fleet-tracking product: a Fastify server running an in-process simulation engine

- a WebSocket telemetry gateway (one warm machine, the single source of truth),
  **Fly Postgres** for the route/zone/stop definitions + a bounded telemetry/events
  window, and the **Next** frontend as a separate app that reverse-proxies the
  WebSocket same-origin. Owner-facing; every command runs from `projects/atlas/`
  unless noted.

English only. No emojis.

## Topology at a glance (ADR-007)

```
                       ┌──────────────────────────────────────────────┐
   browser ──HTTPS──▶  atlas-ops (Fly app, Next 15 standalone)         │
   (single origin)     │  serves the control-room UI + the keyless map │
                       │  rewrites  /ws   (WebSocket upgrade)           │
                       │            /health  ──▶ atlas-fleet.internal:3092
                       └───────────────┬──────────────────────────────-┘
                                       │ Fly private 6PN network
                       ┌───────────────▼──────────────────────────────┐
                       │ atlas-fleet (Fly app, ONE process, ONE warm   │
                       │ machine — the SINGLE SOURCE OF TRUTH)         │
                       │   Fastify + @fastify/websocket gateway (/ws)  │
                       │   + the in-process simulation engine (1 Hz)   │
                       │   + REST /health        (internal port 3092)  │
                       └───────────────┬───────────────────────────────┘
                                       │
                               Fly Postgres (fra)
                               Drizzle (postgres-js, one small pool)
                               route/zone/stop defs + bounded telemetry/events
```

- **`atlas-fleet`** — one Docker image (`Dockerfile`), ONE Fly process, ONE
  machine kept WARM (`auto_stop_machines = 'off'` + `min_machines_running = 1`).
  It runs the Fastify server, the in-process pure-reducer simulation engine
  (ADR-002), and the `@fastify/websocket` telemetry gateway (ADR-003). It is the
  **single source of truth** — every browser connects to the one engine,
  tick -> broadcast is an in-memory emitter, **NO broker, NO Redis** (ADR-002 G1
  / ADR-007). Single-instance because a second machine would be a second,
  divergent world.
- **`atlas-ops`** — separate Fly app (`Dockerfile.web` + `fly.web.toml`), the
  Next 15 standalone frontend that reverse-proxies the live telemetry WebSocket
  (`/ws`) + `/health` to `atlas-fleet` over Fly's private network so the browser
  is **single-origin** (the WebSocket stays `wss://<web-host>/ws`, so the strict
  CSP `connect-src 'self'` holds — ADR-006). It is also kept warm so the fleet is
  already moving before the recruiter's five-second wow window.
- **Postgres = Fly Postgres** (plain, no PostGIS — ADR-005), region **`fra`**.
- **NO Redis** (no queue, no broker — the in-process engine is the whole spine).

> **App names are PLACEHOLDERS.** `atlas-fleet` (server) and `atlas-ops` (web)
> are chosen here. If either is taken on Fly, pick alternatives (e.g.
> `atlas-fleet-eu`, `atlas-fleet-demo` / `atlas-ops-eu`) and update the matching
> `app =` line + the cross-references called out at each step.

## The deploy surface (this directory)

- `Dockerfile` — atlas-fleet: two-stage (`pnpm deploy` server-builder -> slim
  runtime). Runs TS via `tsx` (no compile, like pulse/meld); carries drizzle-kit
  - the seed script so the entrypoint migrates + seeds on boot. **The
    three-package lesson:** the build context includes the root `package.json`
    (= the `atlas-shared` manifest), `tsconfig.base.json`, AND `src/`
    (atlas-shared's TypeScript source), and `pnpm deploy --legacy` materialises
    `atlas-shared` into the runtime tree so tsx resolves its Zod-runtime + geo
    impl at runtime (the apex "inline what the context must resolve" lesson).
- `Dockerfile.web` — atlas-ops: Next 15 standalone (the apex/razors-edge
  one-hop-trace-root shape, built on Linux to dodge the Windows EPERM symlink
  artifact). Bakes `NEXT_PUBLIC_SITE_URL` + the `API_PROXY_TARGET` rewrite
  destination. Keeps NO tile key, so the keyless CSP holds.
- `entrypoint.sh` — straight-line `migrate -> seed (idempotent) -> exec
server`. No worker role (atlas is single-process). The seed is non-fatal (the
  live engine + WS do not depend on the DB).
- `fly.toml` — atlas-fleet (one process, `/health` check, warm floor, port 3092).
- `fly.web.toml` — atlas-ops (Next standalone, `/` check, warm floor, port 3000).
- `.dockerignore` — trims the context for both images (KEEPS `src/`, the root
  manifest, and `tsconfig.base.json`; excludes `.env`, `node_modules`, the
  `.pmtiles` binary, tests, docs).
- `lighthouserc.json` — audits the SEO-bearing `/about` surface (the live map at
  `/` is documented-exempt).

## Prerequisites

1. **flyctl installed.**
   - Windows PowerShell: `irm https://fly.io/install.ps1 | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. **flyctl logged in.** Once per machine: `flyctl auth login`. _(OWNER-GATED —
   requires the owner's Fly credentials; nothing below this line was executed
   during deploy-config authoring.)_
3. **Docker** — optional. `--remote-only` (below) builds on Fly's builder, so
   Docker is not required to deploy. (It also means both images build on a Linux
   builder, which dodges the Windows standalone-trace EPERM artifact.)

## One-time setup

### 1. Register the two apps

```sh
flyctl apps create atlas-fleet --org personal
flyctl apps create atlas-ops   --org personal
```

If `personal` is not your default org, replace it with a value from
`flyctl orgs list`. If a name is taken, pick an alternative and update the
matching `app =` line in `fly.toml` / `fly.web.toml` (and, for a renamed
`atlas-fleet`, the `API_PROXY_TARGET` build-arg in step "Deploy atlas-ops").

Do NOT run `flyctl launch` — it scaffolds a fresh config and overwrites the
committed `fly.toml`. `apps create` registers the name only.

### 2. Create + attach Fly Postgres

```sh
flyctl postgres create --name atlas-db --region fra --vm-size shared-cpu-1x --volume-size 1
flyctl postgres attach atlas-db --app atlas-fleet
```

`postgres attach` provisions a database + role and injects a `DATABASE_URL`
**secret** into `atlas-fleet` (sslmode=require). The server reads it at boot
(env validation, `src/config/env.schema.ts`) and drizzle-kit reads it in the
entrypoint's migrate step. atlas-ops needs **no** database.

### 3. Secrets

| Secret             | App           | Source                                 | Required?                          |
| ------------------ | ------------- | -------------------------------------- | ---------------------------------- |
| `DATABASE_URL`     | `atlas-fleet` | set automatically by `postgres attach` | **Yes** (the only required secret) |
| `ATLAS_COMMIT_SHA` | `atlas-fleet` | optional provenance for `/health`      | No                                 |

There is **no auth secret, no API key, no Redis URL** — atlas has no user-auth
surface and no external dependency (AGENT_NOTES "Security posture"; the input
surface is the Zod-validated + rate-limited WS control channel). The OPTIONAL map
tile key is a BUILD-TIME arg for atlas-ops, not a runtime secret (see "Optional
richer basemap").

To set the optional commit SHA:

```sh
flyctl secrets set ATLAS_COMMIT_SHA="$(git rev-parse --short HEAD)" --app atlas-fleet
```

## Deploy

**Order matters: server first, then web.** The web app's rewrite proxies `/ws`
to `atlas-fleet.internal:3092`, so atlas-fleet should exist first (Fly's private
DNS resolves the name once the app is created; the machine being up is what makes
the WS proxy actually connect).

### 1. Deploy atlas-fleet (server + engine + WS)

```sh
flyctl deploy --remote-only \
  --app atlas-fleet \
  --config fly.toml \
  --dockerfile Dockerfile \
  .
```

The trailing `.` is the **build context** — `projects/atlas/` (run from here),
NOT the repo root. The Dockerfile's `COPY` paths (`package.json`, `src/`,
`server/...`, `tsconfig.base.json`) are relative to this directory.

On boot the entrypoint runs, in order: **drizzle migrations** (idempotent), the
**idempotent demo seed** (the hand-authored Porto routes/zones/fleet + a tick-0
telemetry snapshot — non-fatal if it hiccups), then **exec the Fastify server**.
The engine starts ticking the moment the server binds (it boots from the frozen
Porto baseline, NOT the DB — ADR-005), so the fleet is moving immediately.

### 2. Deploy atlas-ops (the Next frontend)

```sh
flyctl deploy --remote-only \
  --app atlas-ops \
  --config fly.web.toml \
  --dockerfile Dockerfile.web \
  .
```

The default `API_PROXY_TARGET` baked in `Dockerfile.web`
(`http://atlas-fleet.internal:3092`) is correct for this topology — no override
needed. **If you renamed atlas-fleet**, rebuild with:

```sh
flyctl deploy --remote-only --app atlas-ops \
  --config fly.web.toml --dockerfile Dockerfile.web \
  --build-arg API_PROXY_TARGET=http://<new-fleet-name>.internal:3092 \
  --build-arg NEXT_PUBLIC_SITE_URL=https://<new-ops-name>.fly.dev \
  .
```

`NEXT_PUBLIC_SITE_URL` is baked at build (Next inlines `NEXT_PUBLIC_*`), so a
renamed web app needs the matching `--build-arg` + the `[env]` mirror in
`fly.web.toml` updated.

### Watch logs during a deploy

In a separate terminal:

```sh
flyctl logs -a atlas-fleet      # migrate -> seed -> "atlas-server ... listening ... engine running, ws at /ws"
flyctl logs -a atlas-ops        # "▲ Next.js 15.5.x" ... "✓ Ready in <N>ms"
```

On atlas-fleet, look for the entrypoint lines:
`[entrypoint] running drizzle migrations`, `[entrypoint] seeding demo city ...`,
then `atlas-server (commit ...) listening on http://0.0.0.0:3092 ... engine
running, ws at /ws`.

## Migrate + seed

Both run automatically in the atlas-fleet entrypoint on every boot
(`RUN_MIGRATIONS=1` / `RUN_SEED=1` in `fly.toml [env]`). Both are idempotent —
the seed is `faker.seed(n)`-deterministic and every write is an upsert.

To run them manually (or re-seed) against the deployed DB:

```sh
flyctl ssh console -a atlas-fleet -C "/app/entrypoint.sh"   # not typical — the boot does this
# or target the steps directly:
flyctl ssh console -a atlas-fleet
#   cd /app/server
#   node ./node_modules/drizzle-kit/bin.cjs migrate
#   node --import tsx scripts/seed.ts
```

To stop re-seeding on every redeploy once the definitions exist, set
`RUN_SEED=0` (`flyctl secrets set RUN_SEED=0 -a atlas-fleet`, or edit
`fly.toml [env]`). Leaving it ON is also safe (idempotent).

## Verify

### 1. Fly machine status (the warm-floor confirmation)

```sh
flyctl status -a atlas-fleet
flyctl status -a atlas-ops
```

Expect for EACH: **exactly one** machine in state `started`, the health check
passing. This is the **warm-floor confirmation** — `min_machines_running = 1` +
`auto_stop_machines = 'off'` means neither app scales to zero, so the moving
fleet never cold-starts in front of a recruiter (ADR-007). If atlas-fleet shows
more than one machine, that is a misconfiguration (the engine must be
single-instance — the single source of truth); scale back with
`flyctl scale count 1 -a atlas-fleet`.

### 2. Health + the WS proxy

```sh
curl -sI https://atlas-fleet.fly.dev/health | grep -i 'HTTP'
curl -s  https://atlas-fleet.fly.dev/health                       # { "status":"ok", "commit":"...", "ts":... }
curl -sI https://atlas-ops.fly.dev/        | grep -i 'HTTP\|content-security-policy'
curl -sI https://atlas-ops.fly.dev/health  | grep -i 'HTTP'       # proxied -> atlas-fleet's /health
```

Expect:

- atlas-fleet `/health` -> `200` with the JSON body.
- atlas-ops `/` -> `200` with the `Content-Security-Policy` header. The served
  CSP must read exactly (note **NO `unsafe-eval`** and `connect-src 'self'`):
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- atlas-ops `/health` -> `200` (proves the same-origin rewrite proxy to
  atlas-fleet works over the private network).

### 3. The live map (the wow + the DevTools proof)

Open `https://atlas-ops.fly.dev` in a browser. Expect:

- The control-room dashboard renders; the **fleet is already moving** smoothly
  over the keyless basemap (1 Hz authoritative data, 60 fps interpolated motion).
- DevTools -> Network -> WS: **exactly ONE WebSocket** at `wss://atlas-ops.fly.dev/ws`
  carrying telemetry frames (`snapshot`, then `tick` ~once/sec, `event`,
  `heartbeat` every 20 s). **No polling XHR loop** drives the fleet — this is the
  senior signal viewer 1 confirms.
- DevTools -> Console: **ZERO `securitypolicyviolation`** events with the live
  WebGL map rendered. **No third-party network requests** (the keyless basemap is
  same-origin).
- A **geofence beat plays**: focus a vehicle approaching a zone (or use the demo
  control / seek); an `enter` event fires in the feed + the zone pulses as the
  vehicle crosses — exactly once per crossing (the hysteresis no-flap invariant).
- Theme toggle (dark <-> light) swaps the basemap style with no FOUC; the fleet
  never vanishes across the flip.
- The first-class **non-map fleet table** (the keyboard / screen-reader path +
  no-WebGL fallback) carries the same live data.

### 4. The keyless map renders with NO committed secret

```sh
curl -sI https://atlas-ops.fly.dev/map/porto.pmtiles | grep -i 'HTTP\|content-type\|accept-ranges'
```

- If the `.pmtiles` extract was placed in the image (see "The keyless basemap"
  below), this returns `200` with `accept-ranges: bytes` (HTTP range support —
  the `pmtiles` plugin reads it via range requests) and the immutable cache
  header. The richer vector basemap renders.
- If the extract was NOT included, this returns `404` and the map STILL renders
  keyless — the committed **graticule fallback** (painted background + the
  coordinate grid) under the fleet/routes/zones. This is the **hard gate**: a
  fresh deploy with NO `.pmtiles` and NO tile key is a working, CSP-clean,
  populated keyless map. The extract is an OPTIONAL enhancement, not a blocker.

### 5. Lighthouse on the SEO surface

```sh
pnpm -F atlas-web build && pnpm -F atlas-web start   # serves :3093 locally
npx lhci autorun --config=projects/atlas/lighthouserc.json   # audits /about
```

`/about` is the SEO-bearing public surface (>= 95 all four categories, static
SSR, no live-data dependency). The live map at `/` is documented-exempt (an app
surface with a client-only live-data first paint; its budget is the 60 fps frame
budget, not Lighthouse-SEO). On the deployed Fly real-CPU machine the mobile
profile is the authoritative perf measurement.

## The keyless basemap — the Porto `.pmtiles` extract (OPTIONAL enhancement)

**The committed default renders keyless WITHOUT this.** The map's `style.load`
path tolerates a missing source: with no `.pmtiles` it falls back to a painted
background + a coordinate graticule, and the fleet / routes / zones render on top
(the fleet is the wow, keyless either way — verified under a prod build in the
Phase-2 close-out). The extract is a richer vector basemap, NOT a deploy gate.

### Why it is not committed

The `.pmtiles` extract is a multi-MB binary. The repo never commits large
binaries (`web/public/map/*.pmtiles` is gitignored and `.dockerignore`'d). It is
generated at deploy time and dropped into `web/public/map/porto.pmtiles` BEFORE
the atlas-ops image build, so it ships inside that image and serves same-origin.

### Producing the extract

The extract covers the demo-city bbox `DEMO_CITY_BBOX` (Porto downtown core,
`web/src/lib/fleet/demo-city.ts`): `minLng,minLat,maxLng,maxLat =
-8.645,41.135,-8.585,41.165`. Use the Protomaps `pmtiles` CLI to extract that
bbox from a Protomaps global basemap build (`pmtiles` is available via
`go install github.com/protomaps/go-pmtiles@latest`, or download a release
binary):

```sh
# Extract the Porto bbox from a global Protomaps basemap into a small local file.
# The source can be a Protomaps-hosted build URL or a downloaded global .pmtiles.
pmtiles extract \
  https://build.protomaps.com/20240101.pmtiles \
  projects/atlas/web/public/map/porto.pmtiles \
  --bbox=-8.645,41.135,-8.585,41.165 \
  --maxzoom=15
```

(Use the latest dated build from `build.protomaps.com`; a small downtown bbox at
maxzoom 15 is typically a few MB — small enough to ship in the image, NOT large
enough to commit.) Then deploy atlas-ops as usual — the file is picked up by the
`COPY web/public` step. Verify with the `curl` in Verify step 4 (expect `200` +
`accept-ranges: bytes`).

If `pmtiles extract` is unavailable or the extract is too large for comfort,
**skip it** — the graticule fallback is the committed, working keyless default.

### Optional richer KEYED style (still no committed secret)

If the owner supplies a tile/style key from a provider (e.g. a free MapTiler /
Stadia tier), build atlas-ops with the key + its host so the CSP allows it:

```sh
flyctl deploy --remote-only --app atlas-ops \
  --config fly.web.toml --dockerfile Dockerfile.web \
  --build-arg NEXT_PUBLIC_MAP_TILE_KEY=<the-key> \
  --build-arg NEXT_PUBLIC_MAP_TILE_HOST=https://tiles.example.com \
  .
```

`next.config.ts` appends the host to `connect-src`/`img-src` ONLY when
`NEXT_PUBLIC_MAP_TILE_HOST` is set; with no key the policy stays same-origin.
This is purely additive — the keyless self-hosted basemap is the committed
default and the hard gate. NEVER commit the key; it is a build-arg only.

## Rollback

```sh
flyctl releases -a atlas-fleet            # list releases
flyctl releases revert <number> -a atlas-fleet
# same for atlas-ops
```

Rollback is a normal deploy under the hood (rolling, health-check-gated). Note
atlas-fleet is single-instance, so a rolling redeploy briefly drops the live WS
connections; clients reconnect (the ws-client's ~45 s missed-heartbeat reconnect

- snapshot-resume handles it — AGENT_NOTES Phase 4.1).

## Trade-offs

### Single warm machine on atlas-fleet

The engine is the single source of truth — a second machine would be a second,
divergent world. So atlas-fleet runs ONE machine, kept warm
(`min_machines_running = 1`, `auto_stop_machines = 'off'`). This means: (a) no
horizontal scale (accepted — a single live view; horizontal scale would need a
broker, rejected for v1 per ADR-002 G2), and (b) ~$3-5/mo for an always-on
shared-cpu-1x / 512 MB machine — cheap insurance against the fleet cold-starting
in front of a recruiter. atlas-ops is also kept warm (same reasoning: a cold
front door stalls both the page AND the proxied WS).

### Memory: 512 MB each

The Fastify engine is light + I/O-bound (1 Hz over ~18 vehicles); 512 MB is
headroom over the resting footprint for a burst of WS connections. atlas-ops at
512 MB serves the next/image AVIF + OG render + the WS proxy cleanly (the
razors-edge 256 MB OOM lesson). Bump to 1024 MB (no ADR) if a burst pressures
either.

## Cost

Expected at demo traffic (one demo URL, occasional recruiter clicks):

- atlas-fleet (shared-cpu-1x, 512 MB, one warm machine, EU): **~$3-5 / month**.
- atlas-ops (shared-cpu-1x, 512 MB, one warm machine, EU): **~$3-5 / month**.
- Fly Postgres (shared-cpu-1x, 1 GB volume): **~$2-4 / month** (or the free
  allowance).
- No Redis, no second server process.

Expected total: **~$8-14 / month** for the demo profile.

## What is OWNER-GATED (not done during deploy-config authoring)

Everything in this runbook below "flyctl auth login" requires the owner's Fly
credentials and was NOT executed. To go live, the owner must:

1. `flyctl auth login` (their Fly account).
2. Create the two apps (`atlas-fleet`, `atlas-ops`) + Fly Postgres (`atlas-db`)
   and `postgres attach` it to atlas-fleet.
3. (Optional) Generate the Porto `.pmtiles` extract into
   `web/public/map/porto.pmtiles` before the atlas-ops build for the richer
   basemap; otherwise the keyless graticule fallback ships.
4. Deploy atlas-fleet, then atlas-ops (the commands above).
5. Confirm the migrate + seed ran (logs) — or re-run via `flyctl ssh console`.
6. Verify (the warm fleet moves, the single DevTools WebSocket, a geofence beat,
   `/about` Lighthouse, the keyless map with no committed secret).
7. Set the live demo URL (`https://atlas-ops.fly.dev`) in the project README +
   the root PROGRESS tracker.
