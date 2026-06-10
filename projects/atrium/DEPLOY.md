# atrium — Production Deploy Runbook

One-page runbook for shipping `atrium` (the portfolio landing page /
lobby) to Fly.io. Owner-facing. Commands run from the repo root unless
noted (the build context is the project directory — see the deploy
command).

No emojis. English only.

---

## What this deploy is

atrium is **web-only** (ADR-001). There is **no backend, no database, no
migrations, and NO secrets**. The whole site is a static typed index of
the six showcases with a GSAP scroll-driven hero; there is ZERO network
at runtime. The deploy is one Fly Machine running one Next standalone
Node process.

It still needs the **Node runtime** (NOT a static export) because the app
uses a dynamically-generated `opengraph-image`, `sitemap.ts`,
`robots.ts`, and JSON-LD/metadata — `output: 'standalone'` serves all of
these; a static export cannot.

The artifacts in this directory are the entire deploy surface:

- `Dockerfile` — three-stage build (deps install → Next standalone build
  → slim runtime). SINGLE process: the Next.js standalone Node server.
  No entrypoint script, no migrations, no second service.
- `fly.toml` — app config (`atrium-demo`, region `fra`), env, a single
  HTTP service on :3000, an HTTP health check on `/`, VM size.
- `.dockerignore` — trims the build context (no `node_modules`, `.next`,
  `.env`, the `e2e/` tree, docs, dev surfaces).

### App name: `atrium-demo` (not `atrium`)

The bare `atrium` name was already taken on Fly, so the app is
`atrium-demo` and the canonical origin is `https://atrium-demo.fly.dev`.
That origin is baked into the image (`NEXT_PUBLIC_SITE_URL`) and mirrored
in `fly.toml [env]`. If you ever redeploy under a different name, change
BOTH places (the Dockerfile `ARG` default + the `fly.toml [env]` value)
plus the `--build-arg` below.

### No `public/` directory

Unlike apex/razors-edge, atrium has NO `web/public` dir — fonts are
self-hosted by `next/font` (emitted into `.next/static`) and the OG image
/ robots / sitemap are dynamic route handlers. The Dockerfile therefore
has NO `COPY web/public` step. If a `public/` dir is ever added (favicon,
the deferred Task 4.5 preview stills), add the matching `COPY` line back
(see the Dockerfile header note).

## Why the build runs in Docker (the Windows-EPERM resolution)

On the Windows host, `next build` emits `output: 'standalone'` but logs
`⚠ Failed to copy traced files … EPERM: operation not permitted, symlink
…` because the host lacks the symlink privilege (no admin / Developer
Mode). The standalone trace it produces is incomplete and unshippable.

The Dockerfile builds the standalone artifact inside the Linux
`node:22-bookworm-slim` build stage, **where symlink tracing works**, so
the EPERM never occurs and `web/.next/standalone/web/server.js` is
complete. The host's `.next` is excluded by `.dockerignore`, so the
broken Windows trace can never leak into the image. This is the
apex/razors-edge precedent.

## Prerequisites

1. **flyctl installed + logged in.** `flyctl auth login` once per machine.
2. **Docker** is optional — `--remote-only` (below) builds on Fly's
   builder, so Docker is not required to deploy.

## One-time setup

The app is already registered (`atrium-demo`). For reference, the
registration step was:

```sh
flyctl apps create atrium-demo --org personal
```

(The bare `atrium` was taken — hence `atrium-demo`.) Do NOT run
`flyctl launch` — it would scaffold a fresh `fly.toml` and overwrite the
committed config. **No secrets, no Postgres, no attach step.**

## Deploy

Run from **inside the project directory** so flyctl reads the local
`fly.toml` natively (the `app = 'atrium-demo'` line in it selects the
app):

```sh
cd projects/atrium
flyctl deploy --remote-only \
  --dockerfile Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://atrium-demo.fly.dev \
  .
```

The trailing `.` is the **build context** (`projects/atrium/`) — NOT the
repo root. The Dockerfile's `COPY` paths (`web/package.json`, `web/...`)
are relative to it.

`--remote-only` ships the build to Fly's builder rather than building
locally — bypasses the Docker Desktop requirement on Windows and means
the standalone is built on a Linux builder (the Windows-EPERM resolution)
even without local Docker.

First deploy takes ~3-5 minutes (the Next build dominates; there is no
server install or migration). Subsequent deploys with cached layers are
~1-2 minutes.

> **First-deploy gotcha (verified 2026-06-10, flyctl 0.4.57):** passing
> BOTH `--config <path>` AND `--app <name>` to the FIRST deploy of an app
> that has zero machines fails immediately at "Verifying app config" with
> `failed to grab app config from existing machines / No machines
configured for this app` — flyctl tries to reconstruct the config from
> (nonexistent) machines instead of using the file. The fix is the form
> above: `cd` into the project dir and let flyctl pick up the local
> `fly.toml` natively (no `--config` + `--app` pair). Once at least one
> machine exists, the repo-root `--config projects/atrium/fly.toml --app
atrium-demo` form works fine for subsequent deploys too. The Metrics
> token / "context canceled" warning printed by every flyctl command here
> is benign and unrelated.

### NEXT_PUBLIC_SITE_URL is baked at BUILD time

Next inlines `NEXT_PUBLIC_*` into the client bundle at build, so the
canonical origin is fixed when the image is built, not at runtime. The
Dockerfile defaults `ARG NEXT_PUBLIC_SITE_URL=https://atrium-demo.fly.dev`;
the `--build-arg` above is explicit belt-and-braces.

### Watch logs during the deploy

```sh
flyctl logs -a atrium-demo
```

Look for `▲ Next.js 15.5.x`, `✓ Starting...`, `✓ Ready in <N>ms`. That is
the whole boot — one process, no migration, no second service.

## Verify

### 1. Fly machine status

```sh
flyctl status -a atrium-demo
```

Expect: one machine in state `started`, the `/` health check passing.

### 2. Routes + the CSP header

```sh
curl -sI https://atrium-demo.fly.dev/             | grep -i 'HTTP\|content-security-policy'
curl -sI https://atrium-demo.fly.dev/robots.txt   | grep -i 'HTTP'
curl -sI https://atrium-demo.fly.dev/sitemap.xml  | grep -i 'HTTP'
curl -sI https://atrium-demo.fly.dev/opengraph-image | grep -i 'HTTP\|content-type'
```

Expect:

- `/` → `HTTP/2 200` with the `Content-Security-Policy` header. The
  served CSP (next.config.ts) must read exactly:
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  — note **no `'unsafe-eval'`** (GSAP core + ScrollTrigger never eval).
- `/robots.txt`, `/sitemap.xml` → `200`; both should reference
  `https://atrium-demo.fly.dev`.
- `/opengraph-image` → `200`, `content-type: image/png`.

### 3. Browser load (the wow moment)

Open `https://atrium-demo.fly.dev`. Expect: the hero descent through the
`ATRIUM` wordmark into the colonnade of light, the six pinned project
bays resolving their kinetic titles, the ruled directory. Theme toggle
persists with no FOUC. Reduced-motion lands on a clean composed frame.
ZERO CSP violations / console errors. The six per-project **repo**
affordances render as disabled "coming soon" controls (the repo is
private — see GITHUB_BASE below); the six **live demo** links navigate to
the sibling Fly demos.

## GITHUB_BASE — the repo-links flip (currently OFF, deliberately)

The six per-project repo links are derived from a single
`NEXT_PUBLIC_GITHUB_BASE` seam (`src/lib/site-config.ts`). It is **unset**
at build, so `REPO_LINKS_LIVE === false` and every repo affordance is a
disabled "coming soon" control (ADR-003 / U2) — it never navigates.

There IS now a git remote (`github.com/AntczakJ/portfolio`), but the repo
is **private** (unauthenticated requests 404) and `main` is not fully
pushed. Flipping the links live today would point every visitor at a 404. **Flip only once the repo is public AND the relevant commits are
pushed**, by adding to the deploy command:

```sh
  --build-arg NEXT_PUBLIC_GITHUB_BASE=https://github.com/AntczakJ/portfolio
```

(and mirror it in `fly.toml [env]`). The link shape is
`${GITHUB_BASE}/tree/main/projects/<slug>` — verify one resolves 200
before shipping the flip. No other change is needed; the bays/directory
read the single `REPO_LINKS_LIVE` boolean.

## Rollback

```sh
flyctl releases -a atrium-demo
flyctl releases revert <number> -a atrium-demo
```

## Cost

Single shared-cpu-1x / 512 MB Machine, one warm instance, EU: **~$3-5 /
month**. No database, no second service. Bandwidth ~$0 at demo traffic.
