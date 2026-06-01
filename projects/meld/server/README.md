# meld-server

Hono 4.x on Node 22 LTS control plane for the **meld** local-first collaborative whiteboard. Owns HTTP control routes (`/health`, future `POST /api/boards`, future `/health.db` + `/health.ws` observability surfaces) and — once Phase 1 Task 1.4 lands — hosts the Hocuspocus WebSocket framework at `/ws/board/:boardId` on the same Node `http.Server`. The Next.js client lives in `../web/`.

Why Hono on Node 22 for v1: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-001**.
Why Hocuspocus rather than raw `@hono/node-ws` + `setupWSConnection`: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-002**.
Why hybrid ops-log + debounced snapshot persistence: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-003**.

## Current state

**Phase 1 Task 1.1 landed.** `GET /health` returns `{ status: 'ok', commit, ts }` validated at the boundary against the Zod response schema in `src/lib/schemas/health.ts`. The schema and the route handler are the integration contract per `../../../docs/conventions.md` § 5. Drizzle + Postgres (Task 1.2), the Hocuspocus Storage adapter (Task 1.3), the Hocuspocus server bootstrap (Task 1.4), the snapshot-chain compaction sweep + nightly retention (Task 1.5), `POST /api/boards` (Task 1.6), and the better-auth-wired-but-inactive scaffold (Task 1.7) are subsequent tasks owned by `backend-engineer` and explicitly NOT pre-implemented here.

## Local development

Prerequisites:

- **Node 22 LTS** (the repo root pins this via `.nvmrc`).
- **pnpm >= 9** (the repo root pins via `packageManager`).
- Docker for the local Postgres container (relevant from Task 1.2 onwards — not needed for Task 1.1).

From the repo root:

```sh
pnpm install
cp projects/meld/server/.env.example projects/meld/server/.env
pnpm -F meld-server dev
```

The dev script uses [`tsx`](https://github.com/privatenumber/tsx) in `watch` mode — file edits restart the Hono listener within ~100 ms. Smoke test the health surface:

```sh
curl http://localhost:3002/health
# {"status":"ok","commit":"<sha-or-dev>","ts":1717238400000}
```

## Env-var policy

`.env.example` lists every variable the Phase 1 boot path will eventually consume. Task 1.1 itself only reads `PORT`. The principle (per the per-project `AGENT_NOTES.md` "no fallbacks for absent env vars on hot paths") is that subsequent tasks fail fast at startup if a required variable is missing rather than silently defaulting to something wrong in production:

- `DATABASE_URL` — required by Task 1.2 onwards. No default.
- `MELD_ALLOWED_ORIGINS` — required in production by Task 1.4 onwards. Empty in production fails the boot; empty in development falls open to `http://localhost:3000` only, never to `*`.
- `WS_DEBOUNCE_MS` / `WS_MAX_DEBOUNCE_MS` / `WS_OPS_FLUSH_THRESHOLD` — Hocuspocus persistence knobs (ADR-003 defaults: 5_000 / 30_000 / 100). Wired in Task 1.3.
- `BOARD_RETENTION_DAYS` — nightly retention sweep horizon (ADR-003 default: 30). Wired in Task 1.5.

See the inline comments in `.env.example` for the per-variable intent.

## Scripts

| Script | What it does |
|---|---|
| `pnpm -F meld-server dev` | `tsx watch src/server.ts` — Hono listener on `:3002`, restarts on save. |
| `pnpm -F meld-server build` | `tsc --noEmit` — type-check only. Hono runs the TS entry directly under `tsx` in dev and `node --import tsx` in prod (Task 1.1 baseline); a real bundle target is deferred to the Phase 6 deploy-prep task. |
| `pnpm -F meld-server start` | `node --import tsx src/server.ts` — production-style boot path for smoke tests. |
| `pnpm -F meld-server lint` | ESLint flat config re-exported from the monorepo root. |
| `pnpm -F meld-server typecheck` | `tsc --noEmit`. |
| `pnpm -F meld-server test` | `node --test --import tsx 'src/**/*.test.ts'`. No test files in Task 1.1 — added per task by `test-engineer` in Phase 5. |
| `pnpm -F meld-server db:*` | Drizzle Kit (generate / migrate / push / studio). Wired in Task 1.2. |

## Background jobs

Two long-lived schedulers run inside the Hono / Hocuspocus process. Both are constructed at boot (after `meldWs.attach(httpServer)`) and stopped during graceful shutdown alongside `meldWs.close()`.

### Retention scheduler — `src/lib/ingest/retention-scheduler.ts`

ADR-003 nightly inactive-board retention sweep.

- **Cadence.** Daily at **03:00 UTC**, anchored on the wall clock via `setTimeout`-rescheduling (mirrors `tape-server/src/lib/ingest/retention-scheduler.ts`). On `start()` the scheduler runs **one sweep immediately** to catch up since the last process boot, then arms the next 03:00 UTC fire. Each fire runs the sweep then re-arms — drift past the slot by milliseconds still anchors the next fire on the next 03:00 UTC, not on `now + 24 h`.
- **Sweep body (one transaction).** `SELECT id FROM boards WHERE last_active_at < NOW() - INTERVAL '${BOARD_RETENTION_DAYS} days'` → for every id, if a live Hocuspocus room exists, emit a `control.board-deleted` TEXT frame (`reason: 'retention-expired'`) to each connection and close with code `4404` → `DELETE FROM boards WHERE id IN (...)` (FK cascade removes `board_ops` in the same transaction).
- **Per-connection failure.** A broadcast error to ONE connection does NOT abort the sweep — the failure is recorded on `wsMetrics.controlFramesDropped` and the sweep continues with the remaining ids before the DELETE. ADR-003 retention correctness takes precedence over a stuck send.
- **Observability.** `/health.db.retention.{retentionDeletedCount, retentionEmittedCount, retentionLastRunMs}`. Distinct from `wsMetrics.controlFramesOut` so an operator can attribute control-frame sends to the welcome path vs the retention sweep.

### Compaction sweep — `src/lib/ingest/compaction-sweep.ts`

ADR-003 backstop snapshot-chain compaction trigger.

- **Cadence.** Every **6 hours** via `setInterval`. Rolling cadence (no wall-clock anchor) — missing one fire by seconds is acceptable. The first fire happens after one interval; `start()` does NOT bootstrap a sweep.
- **Threshold.** **100 un-flushed ops per room** (`MAX(op_seq) - last_compacted_op_seq`). Configurable via `WS_COMPACTION_OPS_THRESHOLD`. The in-adapter early-flush (Task 1.3, `WS_OPS_FLUSH_THRESHOLD`) catches most rooms before they reach the sweep — this is the backstop for rooms outside the framework's 5 s / 30 s debounce window.
- **Trigger.** For each room above threshold, calls `instance.storeDocumentHooks(document, payload, true)` — the documented Hocuspocus 4.1 early-flush switch that Task 1.3's Storage adapter wires into the snapshot UPSERT + ops DELETE path. The sweep does NOT await the flush; the framework's per-document `saveMutex` serialises against the debounce-driven flush.
- **Observability.** `/health.db.storage.{compactionSweepRuns, roomsCompactedThisSweep}`. `compactionSweepRuns` is a process-lifetime total; `roomsCompactedThisSweep` is overwritten per sweep so a reader sees the LAST sweep's room count.

### Configuration

| Env var | Default | Owner |
|---|---|---|
| `BOARD_RETENTION_DAYS` | `30` | retention scheduler |
| `WS_COMPACTION_OPS_THRESHOLD` | `100` | compaction sweep |

Both fall back to the default on absent / non-numeric values with a warn-level log.

## Structure

```
server/
├── src/
│   ├── server.ts            # Hono app + Node http.Server + boot/shutdown wiring
│   └── lib/
│       ├── commit.ts        # Git short SHA resolution (env → git → 'dev')
│       ├── ingest/
│       │   ├── retention-scheduler.ts   # Task 1.5 — daily 03:00 UTC retention sweep
│       │   ├── compaction-sweep.ts      # Task 1.5 — 6 h compaction backstop
│       │   ├── retention-metrics.ts     # Process-lifetime retention counters
│       │   └── __tests__/               # node:test specs (no live Postgres)
│       ├── schemas/
│       │   ├── health.ts                # /health + /health.ws response contracts
│       │   └── ws/                      # ADR-004 control-frame Zod schemas
│       ├── session/                     # ADR-005 anonymous-session cookie pieces
│       └── ws/                          # Hocuspocus bootstrap + Storage extension
├── .env.example             # Phase 1 env-var placeholders with per-var intent
├── eslint.config.mjs        # Re-exports the monorepo root flat config
├── tsconfig.json            # Extends ../tsconfig.base.json with Node-only lib
├── package.json             # meld-server workspace member
└── README.md                # This file
```
