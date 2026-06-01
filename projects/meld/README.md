# meld

Local-first collaborative whiteboard with **Yjs CRDTs** and a **Hono on Node 22** backend. Slot 2 of the portfolio monorepo; pure showcase, optimised to demonstrate the local-first / CRDT story to a senior backend / fullstack recruiter clicking through in under ten seconds.

> Brand display: **Meld**. Repo dir: `meld`.

## Pitch

Two browser tabs open the same shared board URL. Tab A draws a rectangle; tab B mirrors it conflict-free with sub-100 ms perceptible latency. Disconnect tab A in DevTools, keep drawing offline, reconnect — Yjs auto-merges with no popup, no loss. That is the demo, and the architecture is built to make it inevitable rather than impressive.

## Structure

```
projects/meld/
├── server/             # Hono 4.x on Node 22 — HTTP control plane + Hocuspocus WS at /ws/board/:boardId
├── web/                # Next.js 15 + React 19 + Tailwind v4 + shadcn/ui (frontend-engineer ships in Phase 2)
├── docs/               # Reserved for project-specific docs (deploy notes, architecture diagrams)
├── PLAN.md             # Full spec, success criteria, phased task list
├── DECISIONS.md        # ADRs — stack lock-in (001), Hocuspocus integration (002), hybrid persistence (003)
├── PROGRESS.md         # State tracker — read on start, write on end
├── AGENT_NOTES.md      # Cross-agent context, gotchas, references
├── tsconfig.base.json  # Shared TS strict base — both server/ and web/ extend this
└── package.json        # Umbrella; delegates `pnpm -F meld <script>` to server + web
```

The server and web packages are independent pnpm workspace members picked up by the root workspace via the existing `projects/*/server` + `projects/*/web` globs in `../../pnpm-workspace.yaml`.

## Stack at a glance

- **Backend:** Hono 4.x on Node 22 LTS (ADR-001). Hocuspocus WebSocket framework mounted on the same `http.Server` (ADR-002). Drizzle ORM + Postgres for the hybrid ops-log + snapshot persistence (ADR-003). better-auth scaffolded but inactive in v1.
- **CRDT:** Yjs 13.x + `y-websocket` protocol + `y-protocols/awareness` for ephemeral presence state.
- **Frontend:** Next.js 15 + React 19 + Tailwind v4 + shadcn/ui. Raw Canvas2D drawing surface driven by Yjs observers; Motion drives only the React-shell chrome (presence cursors, avatar stack, selection chrome, theme toggle).
- **Sovereign OKLCH palette** — no token reuse from tape per `../../docs/conventions.md` § 14.

## Run

Each half has its own scripts; the umbrella delegates.

```sh
pnpm install                       # from repo root, installs server + web together
pnpm -F meld dev                   # alias for meld-web dev (frontend dominant during interactive work)
pnpm -F meld dev:server            # backend only (Hono health surface on :3002 by default)
pnpm -F meld build                 # build server then web
pnpm -F meld lint                  # lint both
pnpm -F meld typecheck             # typecheck both
```

Per-half details live in `server/README.md` and `web/README.md`.

## Key decisions

- **ADR-001 — Hono on Node 22, Yjs as the CRDT.** Two distinct cutting-edge 2026 backends across the portfolio's api-heavy slots (tape: Elysia on Bun; meld: Hono multi-runtime).
- **ADR-002 — Hocuspocus on the same `http.Server` as Hono.** Framework owns `/ws/board/:boardId`, Hono owns HTTP control routes. Backpressure adopted in v1 via Hocuspocus `maxRate` / `maxMessageSize` / `timeout` config (close code `4290`).
- **ADR-003 — Hybrid persistence.** Per-edit `board_ops` durability + debounced denormalised `boards.snapshot_state`, 30-day retention, single-transaction compaction.

Full ADR set in [`DECISIONS.md`](./DECISIONS.md). Phase / task list in [`PLAN.md`](./PLAN.md). Current state in [`PROGRESS.md`](./PROGRESS.md).
