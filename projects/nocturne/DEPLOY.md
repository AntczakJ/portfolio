# nocturne — Production Deploy Runbook

One-page runbook for shipping nocturne (slot 8) to Fly.io. Owner-facing. No
emojis, English only.

## What this deploy is

nocturne is **web-only** (ADR-001): one Fly Machine running one Next standalone
Node process. The GPU particle field + Web Audio reactivity run CLIENT-SIDE in
the visitor's browser on their GPU — the Fly Machine only serves the bundle and
the dynamic OG image / robots / sitemap. No backend, no database, no secrets.
(A CPU-only Fly Machine is fine: it never runs the WebGL.)

Surface: `Dockerfile` (three-stage, standalone built inside the Linux image to
dodge the Windows symlink-EPERM; NO `web/public` copy — nocturne has none),
`fly.toml` (`nocturne-demo`, region `fra`, single HTTP service :3000, health
check `/`, shared-cpu-1x / 512 MB, scale-to-zero), `.dockerignore`.

## App name: `nocturne-demo`

The bare `nocturne` may be taken on Fly (as `atrium` was), so the app is
`nocturne-demo`; the canonical origin `https://nocturne-demo.fly.dev` is baked
into the image (`NEXT_PUBLIC_SITE_URL`) and mirrored in `fly.toml [env]`.

## One-time setup

```sh
flyctl apps create nocturne-demo --org personal
```

(If `nocturne` is free, use it and update `app =` + both NEXT_PUBLIC_SITE_URL
spots.) Do NOT run `flyctl launch` — it would overwrite the committed config.
No secrets, no Postgres, no attach.

## Deploy

Run from INSIDE the project dir so flyctl reads the local `fly.toml` natively
(the `app = 'nocturne-demo'` line selects the app) — this avoids the flyctl
0.4.57 first-deploy gotcha where `--config <path>` + `--app <name>` on a
zero-machine app fails at "Verifying app config" (the atrium-verified workaround):

```sh
cd projects/nocturne
flyctl deploy --remote-only \
  --dockerfile Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://nocturne-demo.fly.dev \
  .
```

The trailing `.` is the build context (`projects/nocturne/`), NOT the repo root.
`--remote-only` builds on Fly's Linux builder (the Windows-EPERM resolution).
First deploy ~3-5 min.

## Verify

```sh
flyctl status -a nocturne-demo
curl -sI https://nocturne-demo.fly.dev/             | grep -i 'HTTP\|content-security-policy'
curl -sI https://nocturne-demo.fly.dev/about        | grep -i 'HTTP'
curl -s  https://nocturne-demo.fly.dev/robots.txt   | head -3
curl -sI https://nocturne-demo.fly.dev/opengraph-image | grep -i 'HTTP\|content-type'
```

Expect: `/` -> 200 with the exact eval-free CSP (no `unsafe-eval`;
`media-src 'self' blob:`; `worker-src 'self' blob:`); `/about` -> 200;
robots/sitemap reference the canonical origin; `/opengraph-image` -> 200 png.
In a browser on a real GPU: the intro gate -> sound-on -> the field surges and
breathes; presets morph; reduced-motion/no-WebGL fall back to the poster.

## Cost

Single shared-cpu-1x / 512 MB, `min_machines_running = 0` (scale to zero): ~$0
at idle, pay only for the seconds it serves + a one-time cold start (~3-4 s)
after idle. No DB, no second service. Bump `min_machines_running` to 1 if the
cold start ever matters more than the bill.

## Rollback

```sh
flyctl releases -a nocturne-demo
flyctl releases revert <n> -a nocturne-demo
```
