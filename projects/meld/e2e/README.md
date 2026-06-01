# meld-e2e

Playwright end-to-end harness for meld. Phase 5.1 deliverable — 9 v1
test cases covering the post-Phase-4.2 chrome surface, the Phase 3.2
drawing primitives, the Phase 3.3 presence cursors, and the Phase 3.4
/ ADR-009 offline-mode UX. Runs against any deployed URL via the
`BASE_URL` env var.

## The 9 test cases

| #   | Spec                                | Tag       | What it asserts                                                   |
| --- | ----------------------------------- | --------- | ----------------------------------------------------------------- |
| 1   | `tests/landing.spec.ts`             | `@smoke`  | Landing renders BrandMark + IdentityBadge + ApiStatusDot + CTA.   |
| 2   | `tests/board-creation.spec.ts`      | `@smoke`  | "New board" CTA mutates + redirects to `/board/<uuid>`.           |
| 3   | `tests/board-not-found.spec.ts`     | `@smoke`  | `/board/<garbage-uuid>` renders the BoardNotFound dialog.         |
| 4   | `tests/identity-cookie.spec.ts`     | `@smoke`  | `meld_session` cookie mint + roundtrip + clear-and-remint.       |
| 5   | `tests/drawing-primitives.spec.ts`  | —         | R / E / P keyboard + click-drag paints to the shape canvas.      |
| 6   | `tests/multi-user-presence.spec.ts` | —         | Two contexts on the same board see each other's cursor.          |
| 7   | `tests/connection-banner.spec.ts`   | `@smoke`  | Offline → banner visible + aria-live announces; online → restores. |
| 8   | `tests/offline-edit-merge.spec.ts`  | —         | A draws offline → reconnects → B receives the shape via Yjs.     |
| 9   | `tests/theme-toggle.spec.ts`        | —         | Toggle cycles light → dark → system; `data-theme` flips.          |

The `@smoke` tag carves out the 5 cases that have the lowest WS-flakiness
surface AND the highest deploy-regression yield, suitable for the
post-deploy gate against `meld-demo.fly.dev` per ADR-007.

## Running locally

### Prerequisites

- Node 22, pnpm 11 (root `pnpm install` brings in the e2e workspace).
- `pnpm -F meld-e2e exec playwright install --with-deps chromium` once.
- Postgres on `:5436` (`docker compose -f projects/meld/docker-compose.yml up -d`).
- `pnpm -F meld-server db:migrate` once.

### One-time bootstrap

```sh
# From the repo root.
pnpm install
pnpm -F meld-e2e exec playwright install --with-deps chromium
docker compose -f projects/meld/docker-compose.yml up -d
pnpm -F meld-server db:migrate
```

### Run against local dev

```sh
# In one terminal:
pnpm -F meld-server dev

# In another terminal:
pnpm -F meld-web dev

# In a third terminal (defaults to BASE_URL=http://localhost:3055):
pnpm -F meld-e2e test
```

### Run against the production demo URL

```sh
BASE_URL=https://meld-demo.fly.dev pnpm -F meld-e2e test --grep @smoke
```

The smoke subset (5 of 9) runs in ~2 min wall-clock and exercises the
deploy-regression-yield-heavy paths (landing, board creation, 404,
identity cookie, offline banner) without the WS-flakiness-prone
multi-context tests.

### Reports + traces

- HTML report: `pnpm -F meld-e2e exec playwright show-report` (opens
  the last run's report from `playwright-report/`).
- Trace replay: `pnpm -F meld-e2e exec playwright show-trace <path>`
  on any `trace.zip` from a failed test (path printed in the report).

## CI workflow — `.github/workflows/meld-e2e.yml`

Triggers:

- `workflow_dispatch` with an optional `target_url` input (defaults to
  `https://meld-demo.fly.dev`) — manual fire against any deployed URL.
- `push` to `main` with paths under `projects/meld/**` — gates the
  meld project on a passing E2E sweep against the local dev stack
  brought up inside the job.

The workflow brings up Postgres via the `services:` block, runs
migrations, starts `meld-server` + `meld-web` in the background, waits
for the health endpoints, then runs `pnpm -F meld-e2e test`. On
failure, uploads the `playwright-report/` artifact with 30-day
retention.

### Manual fire pattern

```sh
gh workflow run meld-e2e.yml --field target_url=https://meld-demo.fly.dev
gh workflow run meld-e2e.yml --field target_url=https://meld-staging.fly.dev
```

## Selectors

The harness prefers `data-testid` over class-based selectors. The
canonical testid set added in Phase 5.1:

- `brand-mark`
- `identity-badge` (+ `data-identity-name`, `data-identity-id`, `data-identity-state`)
- `api-status-dot` (+ `data-status`)
- `theme-toggle` (+ `data-current-theme`)
- `new-board-cta`
- `board-toolbar` (+ `data-active-tool`)
- `toolbar-slot-<kind>` for each kind ∈ {select, rectangle, ellipse, freehand, text}
- `shape-canvas` (+ `data-meld-layer="shapes"`)
- `cursor-canvas` (+ `data-meld-layer="cursors"`)
- `connection-banner`
- `offline-aria-live`
- `board-not-found-dialog`

If a future component renames a class, the testid does not change and
the harness stays green. If a future component is removed entirely,
the testid disappears with it and the relevant spec turns red — the
correct signal.

## Cross-browser

CI runs `chromium` only to keep the GHA budget at ~5 hours/mo per
ADR-007's napkin math. Local cross-browser:

```sh
pnpm -F meld-e2e test --project=firefox
```

WebKit is intentionally absent — Playwright's WebKit on Linux is not
Safari. If Phase 6 deploy validation reveals a Safari path, add a
WebKit project at that time.

## Troubleshooting

- **`BASE_URL` Zod parse fails at config load.** The URL must be a
  full origin (`http://localhost:3055`, not `localhost:3055`). The
  loader prints the failing key + message.
- **Multi-user-presence test flakes.** Two contexts hit the same WS
  room; if the backend is slow to assign distinct awareness slots the
  cursor canvas sample may miss B's frame. Re-run; if the flake
  reproduces, capture the trace and inspect the WS frames in the
  trace viewer.
- **Offline-edit-merge test hangs at "B paints something".** The Yjs
  sync handshake on A's reconnect must propagate to B. Verify A's
  banner unmounted before the assertion poll started — the unmount is
  the sync-fired signal.
