# apex — Production Deploy Runbook

One-page runbook for shipping `apex` to Fly.io. Owner-facing. Commands
run from the repo root unless noted (the build context is the project
directory — see the deploy command).

No emojis. English only.

---

## Public-deploy preconditions — ALL CLEARED (v1 is live)

> **P0-1 (model licensing) is RESOLVED.** The whole fleet — the
> configurator flagship and every fleet card — now runs on the
> royalty-clear **CC0 [Kenney Car Kit](https://kenney.nl/assets/car-kit)**
> (unbadged, public domain). The branded Maybach placeholder is gone from
> the repo and the image. Dropping the meshopt WASM decoder along with it
> also let us tighten the CSP to `script-src 'self' 'unsafe-inline'` (no
> `unsafe-eval`, no `wasm-unsafe-eval`). There is no longer any licensing
> precondition on a public deploy.
>
> **v1 is deployed and public: https://apex-rentals.fly.dev** (Fly.io,
> region `fra`, 2026-06-05). To swap in different unbadged models later,
> drop the GLB(s) under `web/public/models/`, re-run
> `pnpm -F apex-web model:optimize` + `pnpm -F apex-web renders:scene`,
> re-verify CSP, and update `CREDITS.md`.

The other deploy-gate items from review-6.3 are also resolved:

- **P1-1 (OG image)** — done (`public/og/opengraph.png`, wired in
  `layout.tsx`).
- **P1-3 (Windows standalone EPERM)** — **resolved by this deploy.** The
  standalone artifact is built INSIDE the Linux Docker image (where
  symlink tracing works), never from the Windows host. See "Why the
  build runs in Docker" below.

---

## What this deploy is

apex is **web-only** (ADR-001). There is **no backend, no database, no
migrations, and NO secrets**. The reservation flow is fully mocked
in-memory against seeded faker data baked to a static file (ADR-003),
the 3D configurator is client-side WebGL (R3F + drei, ADR-002), and
there is no network at runtime. The deploy is one Fly Machine running one
Next standalone Node process.

It still needs the **Node runtime** (NOT a static export) because the app
uses a server action (`app/reserve/actions.ts` — the mocked submit), a
generated OG image, JSON-LD/metadata, and on-demand `next/image` AVIF
optimization of the renders — `output: 'standalone'` serves all of
these; a static export cannot.

The artifacts in this directory are the entire deploy surface:

- `Dockerfile` — three-stage build (deps install → Next standalone build
  → slim runtime). SINGLE process: the Next.js standalone Node server.
  No entrypoint script, no migrations, no second service.
- `fly.toml` — app config (`apex-rentals` — a placeholder name, region
  `fra`), env, a single HTTP service on :3000, an HTTP health check on
  `/`, VM size.
- `.dockerignore` — trims the build context (no `node_modules`, `.next`,
  `.env`, test/review surfaces, docs, the raw source GLB, dev scripts).

## Why the build runs in Docker (the P1-3 resolution)

On the Windows host, `next build` emits `output: 'standalone'` but logs
`⚠ Failed to copy traced files … EPERM: operation not permitted, symlink
…` because the host lacks the symlink privilege (no admin / Developer
Mode). The standalone trace it produces is incomplete and unshippable.

The Dockerfile builds the standalone artifact inside the Linux
`node:22-bookworm-slim` build stage, **where symlink tracing works**, so
the EPERM never occurs and `web/.next/standalone/web/server.js` is
complete. The host's `.next` is excluded by `.dockerignore`, so the
broken Windows trace can never leak into the image. This is why we deploy
via Docker and never ship a host-built artifact.

## Prerequisites

1. **flyctl installed.**
   - Windows PowerShell: `irm https://fly.io/install.ps1 | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. **flyctl logged in.** Once per machine: `flyctl auth login`.
3. **Docker** (optional, for a local image smoke). Docker Desktop on
   Windows / macOS or the `docker` CLI on Linux. `--remote-only` (below)
   builds on Fly's builder, so Docker is not strictly required to deploy.
4. **P0-1 cleared** before a PUBLIC deploy (see the STOP block above).

## One-time setup

### Register the app

```sh
flyctl apps create apex-rentals --org personal
```

If `personal` isn't your default org, replace with the value from
`flyctl orgs list`. If Fly says the name is taken, pick an alternative
(e.g. `apex-rentals-eu`, `apex-demo`) and update BOTH `fly.toml`'s
`app =` line AND the baked `NEXT_PUBLIC_SITE_URL` (the Dockerfile `ARG`
default + the `fly.toml [env]` value) to match — every absolute URL
(canonical, OG, JSON-LD) is built from it.

Do NOT run `flyctl launch` — it would scaffold a fresh `fly.toml` and
overwrite the committed config. `apps create` registers the name only.

**No secrets, no Postgres, no attach step.** That is the entire one-time
setup.

## Deploy

From the repo root:

```sh
flyctl deploy --remote-only \
  --app apex-rentals \
  --config projects/apex/fly.toml \
  --dockerfile projects/apex/Dockerfile \
  projects/apex
```

The trailing `projects/apex` is the **build context** — NOT the repo
root. The Dockerfile's `COPY` paths (`web/package.json`, `web/...`) are
relative to that directory.

`--remote-only` ships the build to Fly's builder rather than building
locally — bypasses the Docker Desktop requirement on Windows and keeps
the build cache server-side. (It also means the standalone is built on a
Linux builder, the P1-3 resolution, even without local Docker.)

First deploy takes ~3-5 minutes (the Next build dominates; there is no
server install or migration). Subsequent deploys with cached layers are
~1-2 minutes.

### NEXT_PUBLIC_SITE_URL is baked at BUILD time

Next inlines `NEXT_PUBLIC_*` into the client bundle at build, so the
canonical origin is fixed when the image is built, not at runtime. The
Dockerfile sets `ARG NEXT_PUBLIC_SITE_URL=https://apex-rentals.fly.dev`
as the default. If you deploy under a different app name, override it:

```sh
flyctl deploy --remote-only \
  --app apex-rentals-eu \
  --config projects/apex/fly.toml \
  --dockerfile projects/apex/Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://apex-rentals-eu.fly.dev \
  projects/apex
```

(and update the `[env] NEXT_PUBLIC_SITE_URL` mirror in `fly.toml`).

### Watch logs during the deploy

In a separate terminal:

```sh
flyctl logs -a apex-rentals
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
flyctl status -a apex-rentals
```

Expect: one machine in state `started`, the `/` health check passing.

### 2. Routes + the CSP header

```sh
curl -sI https://apex-rentals.fly.dev/        | grep -i 'HTTP\|content-security-policy'
curl -sI https://apex-rentals.fly.dev/reserve | grep -i 'HTTP'
curl -sI https://apex-rentals.fly.dev/models/apex-suv.glb | grep -i 'HTTP\|content-type'
```

Expect:

- `/` → `HTTP/2 200` with the `Content-Security-Policy` header. The
  served CSP (ADR-002 §5) must read exactly:
  `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  — note `'wasm-unsafe-eval'` (required by the self-hosted meshopt
  decoder) and the intact `'unsafe-eval'` BAN.
- `/reserve` → `HTTP/2 200`.
- `/models/apex-suv.glb` → `200` (the optimized 1.9 MB GLB ships in the
  image and serves same-origin).

### 3. Browser load (the wow moment + the reservation flow)

Open `https://apex-rentals.fly.dev` in a browser. Expect:

- The light-canonical premium hero renders; the static product render is
  the LCP. Scrolling into the configurator arms the live R3F scene
  (Tier-1 desktop) — paint + wheel swaps are instant. Mid-tier mobile /
  no-WebGL gets the pre-baked AVIF stills (Tier-3); reduced-motion gets
  the crossfade; no-JS gets the static floor. No broken images.
- Theme toggle (light ↔ dark "night drive") persists and has no FOUC.
- Click a **Reserve** CTA → `/reserve`. Walk the 5-step wizard (vehicle →
  dates/locations → extras/insurance → driver → confirmation). The
  date-range picker is keyboard-operable; the confirmation shows a
  deterministic reference (`APX-XXXX-XXXX`) and offers an `.ics`
  download. It is honestly labelled a demo — nothing is actually booked.

### 4. CSP smoke (no violations)

In the browser devtools Console, load `/` and scroll into the
configurator; then walk `/reserve` through to a confirmation + the
`.ics` download. Expect ZERO CSP violations and zero console errors — the
same result the local `verify-reserve.mjs` / `verify-csp.mjs` checks
produce against the production build.

## Rollback

List recent releases:

```sh
flyctl releases -a apex-rentals
```

Roll back to a specific release:

```sh
flyctl releases revert <number> -a apex-rentals
```

Or pin an explicit image:

```sh
flyctl deploy --image registry.fly.io/apex-rentals:deployment-XXX -a apex-rentals
```

Rollback is a normal deploy under the hood, so it goes through the same
rolling-strategy health-check window.

## Local Docker smoke (optional, before a deploy)

From the repo root:

```sh
docker build -f projects/apex/Dockerfile -t apex:test projects/apex
docker run --rm -p 3099:3000 apex:test
```

No `--env` is needed — the image bakes `NODE_ENV=production`,
`PORT=3000`, `HOSTNAME=0.0.0.0`, and the canonical `NEXT_PUBLIC_SITE_URL`.
Then:

```sh
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3099/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3099/models/apex-suv.glb
curl -sI http://localhost:3099/ | grep -i content-security-policy
```

The first two should return 200; the CSP header should match the string
in Verify step 2.

## Trade-offs

### Single Machine, `auto_stop` + `min_machines_running = 1`

The app is stateless — it persists nothing server-side (the wizard draft
lives in the browser's `localStorage`; ADR-003). It could safely scale to
zero. We keep **one Machine warm** (`min_machines_running = 1`) anyway
because this is a **portfolio showcase**: a recruiter clicking the demo
URL must not hit a 5-10 s cold start before the scroll-hero-into-3D-
configurator wow moment — the "five-second wow" window is the whole
point. `auto_stop` is left on so Fly reaps any extra Machines a burst
spun up, but the floor is one. The cost of one always-on shared-cpu-1x /
512 MB Machine in EU is ~$3-5/mo — cheap insurance against cold-start
jank.

If you would rather pay nothing at idle and accept the cold start, set
`min_machines_running = 0` and remove the warm floor. Not recommended for
the demo profile.

### Memory: 512 MB

The Next server itself is light — the heavy three.js + the 1.9 MB GLB run
in the BROWSER, never on the server. The server-side memory pressure is
the on-demand `next/image` AVIF optimization of the hero + gallery
renders (sharp), which is exactly what OOM-killed razors-edge at 256 MB.
We start at 512 MB. If a burst pressures it, bump `[[vm]] memory_mb` to
1024 — no ADR needed.

### No secrets

There is nothing to set. No `DATABASE_URL`, no auth secret, no API key.
The only configuration is the build-time `NEXT_PUBLIC_SITE_URL`, baked in
the image.

### Authoritative mobile-perf measurement

The Lighthouse mobile sub-95 perf score is a documented artifact of the
synthetic 4× CPU throttle (LCP render-delay on an already-downloaded
hero image — at real-device CPU the mobile run scores 100 / LCP 1000ms;
see PROGRESS.md / ADR-002 §3). **The deployed Fly real-CPU run is the
authoritative mobile-perf measurement.** After the first deploy, confirm
the live mobile profile on real hardware rather than trusting the
synthetic-CPU LHCI number.

## Cost

Expected at demo traffic (single demo URL, occasional recruiter clicks,
no sustained load):

- App Machine (shared-cpu-1x, 512 MB, one warm instance, EU): **~$3-5 /
  month**.
- No database, no second service → no additional compute or storage.
- Bandwidth: ~$0 / month at demo traffic; $0.02 / GB egress beyond the
  free tier (the GLB + the AVIF renders are the bulk of the payload,
  served same-origin).

Expected total: **~$3-7 / month** for the demo URL profile.
