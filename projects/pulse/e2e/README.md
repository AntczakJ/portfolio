# pulse-e2e

Playwright end-to-end harness for pulse. Phase 8.2 deliverable — critical-path
coverage on the user-facing surfaces of the live uptime monitor. Runs against
the built + served full stack locally, or against any deployed URL via
`BASE_URL`.

## The test cases

| #   | Spec                                    | Tag      | What it asserts                                                                                                                       |
| --- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tests/landing.spec.ts`                 | `@smoke` | `/` loads, hero + board preview render, CTA routes to the dashboard, ZERO CSP/console errors.                                         |
| 2   | `tests/board-connect.spec.ts`           | `@smoke` | Seeded monitors render, the indicator reaches "Live", exactly ONE `/api/stream` (not polling), a real `check.result` updates a card.  |
| 3   | `tests/demo-incident-arc.spec.ts`       | —        | "Trigger demo incident" → the SYNCHRONIZED down beat (card + summary + strip + toast agree, the C-1 fix), then recovery.              |
| 4   | `tests/auth-gating.spec.ts`             | `@smoke` | Demo stays OPEN (board + demo button anonymous) but "New monitor" → sign-in; sign-up → OWN empty workspace → create; sign-out → demo. |
| 5   | `tests/incidents.spec.ts`               | —        | The incidents list renders the seeded history (varied causes, "Checkout API", never "wow-moment target"); open/resolved filter.       |
| 6   | `tests/public-status.spec.ts`           | `@smoke` | `/status/<slug>` SSR floor + redaction (no raw response times / private monitors / internal labels); the banner never lies.           |
| 7   | `tests/keyboard-reduced-motion.spec.ts` | —        | The create-monitor dialog is keyboard-operable; reduced-motion does not break the board.                                              |

The `@smoke` subset (landing + board-connect + auth-gating + public-page) is the
fast deploy-verification slice: `pnpm -F pulse-e2e test:smoke`.

## Robustness against real-probe timing

The live board reacts to REAL probes (intentionally non-deterministic) and the
demo-incident arc runs through the genuine pipeline (~30-45 s open). The suite
waits on REAL STATE — the incident open/close API, a card's `data-status`
attribute, the "last checked" ticker — never a fixed sleep, and runs serially
(one worker) so the shared seeded demo workspace is not raced.

## Local caveat — the demo-arc recovery is a DEPLOY beat

Locally the demo monitor (`Checkout API`) targets `localhost:3080/demo/flaky`,
which resolves to LOOPBACK, so the SSRF execution-time guard records it
`ssrf_blocked = down`. That STILL opens the incident arc (so the down-beat
synchronization is fully testable locally), but the monitor cannot recover on
loopback. The arc test asserts the down beat rigorously and degrades the
recovery assertion gracefully (it records an annotation) — full open→recover is
a deploy beat against the public flaky endpoint. (Documented: ADR-006 / pulse
AGENT_NOTES.)

## Running locally

Bring up the full BUILT + SERVED stack (the strict CSP forbids `unsafe-eval`, so
the prod build is the authoritative surface — NOT `next dev`):

```bash
# 1. Postgres :5437 + Redis :6381
docker compose -f projects/pulse/docker-compose.yml up -d

# 2. migrate + seed the demo workspace
pnpm -F pulse-server db:migrate
pnpm -F pulse-server exec tsx scripts/seed-demo-monitor.ts
pnpm -F pulse-server exec tsx scripts/seed-demo-history.ts
pnpm -F pulse-server exec tsx scripts/seed-public-page.ts

# 3. the NestJS web (:3080) AND worker (separate processes, ADR-006)
pnpm -F pulse-server start:web      # in one shell
pnpm -F pulse-server start:worker   # in another

# 4. the Next web (prod) on :3081, pointed at the API on :3080
NEXT_PUBLIC_API_URL=http://localhost:3080 \
NEXT_PUBLIC_SSE_URL=http://localhost:3080 \
NEXT_PUBLIC_DEMO_STATUS_SLUG=demo \
  pnpm -F pulse-web build && pnpm -F pulse-web start

# 5. run the suite
pnpm -F pulse-e2e test            # full suite (chromium)
pnpm -F pulse-e2e test:smoke      # the @smoke deploy subset
```

## Against a deployed URL

```bash
BASE_URL=https://<pulse-web-host> \
API_BASE_URL=https://<pulse-web-host> \
  pnpm -F pulse-e2e test
```

(In the deployed single-origin proxy topology the API is under the web origin,
so `API_BASE_URL` collapses to `BASE_URL`.)

## CI

`.github/workflows/pulse-e2e.yml` brings the full stack up in-job (Postgres +
Redis service containers, the NestJS web + worker, the seeds, the built Next
web) and runs the suite, or targets a deployed `target_url` via
`workflow_dispatch`. `.github/workflows/pulse-lighthouse.yml` runs Lighthouse CI
(>= 95 all four categories) against `/` and `/status/demo`.
