# tape-e2e

Playwright end-to-end harness for **tape**. Phase 5.3 (critical-path E2E)

- Phase 5.5 (client-side frame-budget load test).

## Design — deterministic, no backend in CI

The CI-gated specs do **not** need the Elysia server, Postgres, or the
Rust worker. They drive the Canvas2D chart through two deterministic
seams:

1. **`window.__tapeStore`** — the dev-only snapshot-injection hook
   (`web/src/lib/stores/stream-store.ts`, gated on
   `NODE_ENV === 'development'`, dead-code-eliminated in prod). A spec
   seeds a fixed footprint snapshot (`fixtures/footprint-snapshot.ts`)
   and the chart engine repaints it.
2. **`page.routeWebSocket('**/ws/stream')`** — a mock socket that accepts
and stays open, so the connection state reaches `connected`
   deterministically without a real backend.

The config **auto-starts `tape-web` in dev mode** (the `__tapeStore`
global only exists in a dev build) on port `3210`, with
`NEXT_PUBLIC_WS_URL` pointed at a dead port so the live provider sits
quietly in backoff instead of erroring.

The single **`@live`** spec hits a REAL `/ws/stream` and is **skipped
unless `TAPE_E2E_LIVE=1`** — it requires the offline synth→worker
pipeline to be up.

## The specs

| Spec                            | Critical path (PLAN 5.3)                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `live-footprint.spec.ts`        | Live mode loads; injected snapshot paints footprint cells + tape; status → connected.   |
| `replay-control.spec.ts`        | Replay rail opens the control bar; scrub seeks; play ⇄ pause; mode announcement.        |
| `theme-toggle.spec.ts`          | Theme cycle flips `data-theme`; chart re-derives palette in both themes, no crash.      |
| `keyboard-a11y.spec.ts`         | Tab reaches rail/theme/replay; Space toggles mode; focus ring; key ARIA in both themes. |
| `load-frame-budget.spec.ts`     | **Task 5.5** — 200 ticks/sec, per-tick render cost (see below).                         |
| `live-pipeline.spec.ts` `@live` | Real `/ws/stream` connects, frames accrue, footprint paints (opt-in).                   |

## Running

### Default — auto-started dev server (zero env)

```sh
# From the repo root. Brings up tape-web on :3210 automatically.
pnpm -F tape-e2e exec playwright install chromium   # once
pnpm -F tape-e2e test
```

### Against an already-running dev server

```sh
# Terminal 1 — start tape-web yourself on 3210 with a dead WS URL:
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:39999 \
  pnpm -F tape-web exec next dev -p 3210

# Terminal 2 — point the harness at it (skips the auto webServer):
TAPE_E2E_WEB_SERVER=0 BASE_URL=http://localhost:3210 pnpm -F tape-e2e test
```

### Against the deployed demo (after Phase 6 deploy)

```sh
BASE_URL=https://tape-demo.fly.dev pnpm -F tape-e2e test
```

Note: against a PRODUCTION build the `__tapeStore` hook is DCE'd, so the
injected specs cannot seed data — only the chrome/keyboard/theme specs
and (with `TAPE_E2E_LIVE=1`) the live spec are meaningful there.

### The `@live` spec (real pipeline)

```sh
# 1. Bring up the offline synth→worker pipeline (see ../AGENT_NOTES.md):
docker compose -f ../docker-compose.yml up -d
pnpm -F tape-server db:migrate
( cd ../worker && cargo build --bin worker )
WORKER_PIPELINE_ENABLED=1 WS_SYNTHESIZE=1 BINANCE_WS_ENABLED=0 \
  DATABASE_URL=postgres://tape:tape@localhost:5435/tape PORT=3011 \
  bun ../server/src/server.ts &

# 2. Start tape-web pointed at the pipeline:
NEXT_PUBLIC_API_URL=http://localhost:3011 NEXT_PUBLIC_WS_URL=ws://localhost:3011 \
  pnpm -F tape-web exec next dev -p 3210 &

# 3. Run the live spec:
TAPE_E2E_WEB_SERVER=0 BASE_URL=http://localhost:3210 TAPE_E2E_LIVE=1 \
  pnpm -F tape-e2e test --grep @live

# 4. ALWAYS leave the stack STOPPED afterwards:
docker compose -f ../docker-compose.yml down
# + kill the bun server (takes the worker with it) and the dev server.
```

## Task 5.5 — load test methodology + numbers

The load spec drives **200 synthetic `tick` frames/sec** through the
store via `__tapeStore` for a 6 s window, then measures the render cost.

**Driver:** a `MessageChannel` micro-pump, **not** `requestAnimationFrame`
or `setInterval`. This is load-bearing: headless Chrome under Playwright
throttles BOTH rAF (to ~3–15 fps when the page is offscreen/unfocused)
and background timers, so an rAF- or interval-paced driver silently
under-emits (measured ~99/sec instead of 200). The MessageChannel pump
is unthrottled and genuinely sustains ~200/sec.

**What is measured and gated:**

- **Per-tick `ingestFrame` cost (µs/tick)** — the store reducer +
  ring-buffer cost the main thread pays per trade. This is the part of
  the frame budget the data path owns and the part that is faithfully
  measurable in headless. Gated `< 500 µs/tick`.

**What is measured but only REPORTED (not gated):**

- **rAF inter-frame deltas (p50/p99)** — under headless Playwright the
  page's rAF is throttled, so this reflects the harness environment, NOT
  the chart's on-device paint budget. Gating on it would assert a
  headless artefact, so it is logged for transparency only.

**Measured numbers (local, fresh warm dev server, headless Chromium):**

```
injected ticks: ~1205–1246 (effective 201–208/sec)   ← genuinely 200/sec
per-tick ingest cost: ~56–160 µs/tick                 ← data path is cheap
   → at 200/sec that is ~11–32 ms main-thread/sec (~1–3% of one core)
rAF inter-frame (reported only): p99 ~133–866 ms      ← headless throttle
```

**Honest conclusion on the PLAN ≤ 16.6 ms p99 frame-budget criterion:**
that gate is an **on-device** measurement (Chrome DevTools Performance
panel, real 60 Hz display) and **cannot be faithfully reproduced in
headless Chrome** (rAF is not vsync-locked there). This automated test is
the **regression guard** on the measurable part — the per-tick
main-thread cost the renderer pays under 200/sec — and the ≤ 16.6 ms
on-device gate stays a **manual DevTools step** (overlaps Task 5.4).
The data path is comfortably cheap: the store reducer would have to
regress by ~10× (e.g. an accidental O(n) full-array clone over the
~900-cell ring per tick) to threaten the budget, and that would fail the
per-tick ceiling here.

## Task 5.4 — Lighthouse CI (DEFERRED to after deploy)

`lighthouserc.example.json` is a STUB. Lighthouse ≥ 95 across categories
must run against the **deployed demo URL**, which does not exist yet
(see `../PROGRESS.md` "Demo URL: not yet deployed"). Once deployed:

```sh
npx @lhci/cli autorun --collect.url=https://tape-demo.fly.dev
```

Wire it into a `tape-lighthouse.yml` GitHub Actions workflow mirroring
the meld pattern, asserting `categories:* >= 0.95` (PLAN success
criterion). Do NOT run it against a localhost dev build — dev bundles are
unminified and will not represent the production score.

## Selectors

This harness prefers **semantic role/label queries** over `data-testid`
(per the test-engineer mandate). The footprint chart is an imperative
Canvas2D surface with no per-cell DOM, so chart assertions use **pixel
sampling** (`TapeApp.canvasPaintedFraction`) to assert "the canvas is not
blank" — the honest E2E-level signal that the renderer painted the data.
