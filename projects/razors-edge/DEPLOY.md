# razors-edge — Production Deploy Runbook

One-page runbook for shipping `razors-edge` to Fly.io. Owner-facing.
Commands run from the repo root unless noted (the build context is the
project directory — see the deploy command).

The artifacts in this directory are the entire deploy surface:

- `Dockerfile` — three-stage build (deps install, Next standalone
  build, slim runtime). SINGLE process: the Next.js standalone Node
  server. No entrypoint script, no migrations, no second service.
- `fly.toml` — app config (`razors-edge-demo`, region `fra`), env, a
  single HTTP service on :3000, an HTTP health check on `/`, VM size.
- `.dockerignore` — trims the build context (no `node_modules`,
  `.next`, `.env`, test/review surfaces, docs, raw photo originals,
  dev scripts).

No emojis. English only.

## What makes this different from meld / tape

razors-edge is **web-only** (ADR-001). There is **no backend, no
database, no migrations, and NO secrets**. The booking flow is fully
mocked in-memory against seeded faker data (ADR-003), and there is no
network at runtime. The deploy is therefore the simplest in the
portfolio: one Fly Machine running one Next standalone Node process.

It still needs the **Node runtime** (NOT a static export) because the
app uses server actions (`app/book/actions.ts`), a dynamically
generated `opengraph-image`, `sitemap.ts` / `robots.ts`, and
JSON-LD/metadata — `output: 'standalone'` serves all of these; a static
export cannot.

## Prerequisites

1. **flyctl installed.**
   - Windows PowerShell: `irm https://fly.io/install.ps1 | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. **flyctl logged in.** Once per machine: `flyctl auth login`.
3. **Docker** (optional, for a local image smoke). Docker Desktop on
   Windows / macOS or the `docker` CLI on Linux.

## One-time setup

### Register the app

```sh
flyctl apps create razors-edge-demo --org personal
```

If `personal` isn't your default org, replace with the value from
`flyctl orgs list`. If Fly says the name is taken, pick an alternative
(e.g. `razors-edge-eu`) and update BOTH `fly.toml`'s `app =` line AND
the baked `NEXT_PUBLIC_SITE_URL` (the Dockerfile `ARG` default + the
`fly.toml [env]` value) to match — every absolute URL (canonical, OG,
sitemap, robots, JSON-LD) is built from it.

Do NOT run `flyctl launch` — it would scaffold a fresh `fly.toml` and
overwrite the committed config. `apps create` registers the name only.

**No secrets, no Postgres, no attach step.** That is the entire
one-time setup.

## Deploy

From the repo root:

```sh
flyctl deploy --remote-only \
  --app razors-edge-demo \
  --config projects/razors-edge/fly.toml \
  --dockerfile projects/razors-edge/Dockerfile \
  projects/razors-edge
```

The trailing `projects/razors-edge` is the **build context** — NOT the
repo root. The Dockerfile's `COPY` paths (`web/package.json`,
`web/...`) are relative to that directory.

`--remote-only` ships the build to Fly's builder rather than building
locally — bypasses the Docker Desktop requirement on Windows and keeps
the build cache server-side.

First deploy takes ~3-5 minutes (the Next build dominates; there is no
server install or migration). Subsequent deploys with cached layers are
~1-2 minutes.

### NEXT_PUBLIC_SITE_URL is baked at BUILD time

Next inlines `NEXT_PUBLIC_*` into the client bundle at build, so the
canonical origin is fixed when the image is built, not at runtime. The
Dockerfile sets `ARG NEXT_PUBLIC_SITE_URL=https://razors-edge-demo.fly.dev`
as the default. If you deploy under a different app name, override it:

```sh
flyctl deploy --remote-only \
  --app razors-edge-eu \
  --config projects/razors-edge/fly.toml \
  --dockerfile projects/razors-edge/Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://razors-edge-eu.fly.dev \
  projects/razors-edge
```

(and update the `[env] NEXT_PUBLIC_SITE_URL` mirror in `fly.toml`).

### Watch logs during the deploy

In a separate terminal:

```sh
flyctl logs -a razors-edge-demo
```

What to look for:

- `▲ Next.js 15.5.x`
- `✓ Starting...`
- `✓ Ready in <N>ms`

That is the whole boot — one process, no migration step, no second
service to wait on.

## Verify

### 1. Fly machine status

```sh
flyctl status -a razors-edge-demo
```

Expect: one machine in state `started`, the `/` health check passing.

### 2. Routes

```sh
curl -sI https://razors-edge-demo.fly.dev/            | grep -i 'HTTP\|content-security-policy'
curl -sI https://razors-edge-demo.fly.dev/book        | grep -i 'HTTP'
curl -s  https://razors-edge-demo.fly.dev/sitemap.xml | head -8
curl -s  https://razors-edge-demo.fly.dev/robots.txt
curl -sI https://razors-edge-demo.fly.dev/opengraph-image | grep -i 'HTTP\|content-type'
```

Expect:

- `/` → `HTTP/2 200` with the `Content-Security-Policy` header
  (`default-src 'self'; script-src 'self' 'unsafe-inline'; ...` —
  ADR-002 posture).
- `/book` → `HTTP/2 200`.
- `/sitemap.xml` → XML whose `<loc>` values are
  `https://razors-edge-demo.fly.dev/...` (the baked
  `NEXT_PUBLIC_SITE_URL` proves through).
- `/robots.txt` → `Allow: /` + `Sitemap:` / `Host:` on the Fly origin.
- `/opengraph-image` → `200` `image/png`.

### 3. Browser load (the wow moment + the booking flow)

Open `https://razors-edge-demo.fly.dev` in a browser. Expect:

- The cinematic dark-luxe hero renders; scrolling drives the
  **blade-sweep** scrub (the wow moment) — the wordmark splits and the
  portrait reveals through the gap. Reduced-motion users get the static
  composed frame, not a pin.
- The graded photography loads (hero portrait, gallery strip, barber
  headshots) — no broken images.
- Click **Book a chair** → `/book`. Walk the 5-step wizard (service →
  barber → date/time → details → confirmation). The availability grid
  is keyboard-operable; the confirmation shows a deterministic
  reference (`RE-XXXXXX`) and offers an `.ics` download. It is honestly
  labelled a demo — nothing is actually scheduled.

## Rollback

List recent releases:

```sh
flyctl releases -a razors-edge-demo
```

Roll back to a specific release:

```sh
flyctl releases revert <number> -a razors-edge-demo
```

Or pin an explicit image:

```sh
flyctl deploy --image registry.fly.io/razors-edge-demo:deployment-XXX -a razors-edge-demo
```

Rollback is a normal deploy under the hood, so it goes through the same
rolling-strategy health-check window.

## Local Docker smoke (optional, before a deploy)

From the repo root:

```sh
docker build -f projects/razors-edge/Dockerfile -t razors-edge:test projects/razors-edge
docker run --rm -p 3099:3000 razors-edge:test
```

No `--env` is needed — the image bakes `NODE_ENV=production`,
`PORT=3000`, `HOSTNAME=0.0.0.0`, and the canonical
`NEXT_PUBLIC_SITE_URL`. Then:

```sh
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3099/
curl -s http://localhost:3099/robots.txt
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3099/images/graded/hero-desktop.jpg
```

All three should return 200; the sitemap/robots URLs should point at
`razors-edge-demo.fly.dev` (the baked origin).

## Trade-offs

### Single Machine, `auto_stop` + `min_machines_running = 1`

The app is stateless — it persists nothing server-side (the wizard
draft lives in the browser's `localStorage`; ADR-003). It could safely
scale to zero. We keep **one Machine warm** (`min_machines_running = 1`)
anyway because this is a **portfolio showcase**: a recruiter clicking
the demo URL must not hit a 5-10 s cold start before the blade-sweep
hero — the "five-second wow" window is the whole point. `auto_stop` is
left on so Fly reaps any extra Machines a traffic burst spun up, but the
floor is one. The cost of one always-on shared-cpu-1x / 256 MB Machine
in EU is ~$2-3/mo — cheap insurance against cold-start jank.

If you would rather pay nothing at idle and accept the cold start, set
`auto_stop_machines = 'stop'` with `min_machines_running = 0` and remove
the warm floor. Not recommended for the demo profile.

### Memory: 256 MB

Web-only Next standalone is light at idle. 256 MB comfortably serves the
static-ish pages, the in-memory mock, and the `opengraph-image` satori
render. If the OG render or a traffic burst pressures memory, bump
`[[vm]] memory_mb` to 512 — no ADR needed for the bump.

### No secrets

There is nothing to set. No `DATABASE_URL`, no auth secret, no API key.
The only configuration is the build-time `NEXT_PUBLIC_SITE_URL`, baked
in the image. `.env.example` documents that it is optional and
web-only.

## Cost

Expected at demo traffic (single demo URL, occasional recruiter clicks,
no sustained load):

- App Machine (shared-cpu-1x, 256 MB, one warm instance, EU): **~$2-3 /
  month** (a fraction of a vCPU-month flat because the floor is one
  Machine and it is small).
- No database, no second service → no additional compute or storage.
- Bandwidth: ~$0 / month at demo traffic; $0.02 / GB egress beyond the
  free tier (the graded photography is the bulk of the payload, served
  as optimized AVIF/WebP via `next/image`).

Expected total: **~$2-5 / month** for the demo URL profile — the
cheapest deploy in the portfolio because there is no backend to run.
