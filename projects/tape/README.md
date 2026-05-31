# Tape

> Production-grade real-time orderflow visualizer for crypto perpetual futures.

Live BTC-PERP tick stream from Binance Futures, footprint cell aggregation on a Rust hot-path worker, 60 fps Canvas2D rendering in the browser. Two processes, one local IPC bridge, MessagePack on the wire end-to-end.

## Demo

`TBD — deploy pending`. The README will link the live URL once the deploy lands; capture instructions for the placeholder screenshots below live in [`docs/CAPTURE.md`](./docs/CAPTURE.md).

## Screenshots

Three placeholders are committed under [`docs/screenshots/`](./docs/screenshots/) so the owner can drop the real PNGs in without touching this file. Until then, the markdown image references are commented out so the README does not render broken links.

<!-- ![Tape — dark, canonical chart view](./docs/screenshots/home-dark.png) -->
<!-- ![Tape — light theme](./docs/screenshots/home-light.png) -->
<!-- ![Tape — 320 px mobile tape-only fallback](./docs/screenshots/mobile-tape.png) -->

To capture: run the dev stack per the [Run locally](#run-locally) section, then follow [`docs/CAPTURE.md`](./docs/CAPTURE.md) for the exact viewport, theme, and naming conventions. Files expected at:

- `docs/screenshots/home-dark.png` — canonical chart view, dark theme, 1440 x 900.
- `docs/screenshots/home-light.png` — same view, light theme.
- `docs/screenshots/mobile-tape.png` — 360 px mobile, tape-only fallback below the 768 px breakpoint.

## What it is

- **Live data.** Binance Futures `<symbol>@aggTrade` stream, currently single-symbol BTC-PERP. Every cell and every tape row on screen represents a trade that just executed.
- **60 fps under load.** Hand-rolled Canvas2D footprint renderer driven by a single `requestAnimationFrame` loop, dirty-flag-gated, sustained against ~200 trades/sec on a 2020-era laptop.
- **Full Rust + TypeScript architecture under the hood.** Two-process design with an in-Bun supervisor; the data path, the persistence path, and the frontend all read from a single typed schema generated from the Rust source.

## Architecture

Two processes share one host:

- **Rust hot-path worker** (`worker/`, crate `tape-worker`) owns footprint cell aggregation and CVD rollups. Single binary, no shared address space with the control plane.
- **Elysia (Bun) control plane** (`server/`, package `tape-server`) ingests the Binance feed, persists ticks, supervises the worker, and fans out frames to browsers.

They talk over a **local IPC bridge**: a Unix domain socket on Linux, a named pipe on Windows. Length-prefixed binary framing (`u32` LE length + payload). Payloads are **MessagePack** via `rmp-serde` on the Rust side and `msgpackr` on the Bun side, configured with `useRecords: false` so the wire stays spec-compatible. Frames are self-describing — a captured stream pipes straight into `msgpack2json` without a schema file. ADR-002 and ADR-003 own the trade-off (UDS over Bun FFI, MessagePack over Protobuf and Cap'n Proto).

**Schema source of truth.** Rust structs in `worker/src/bridge/messages.rs` are annotated `#[derive(Serialize, Deserialize, TS)]`. `ts-rs` emits TypeScript counterparts into `server/src/lib/schemas/bridge/generated/`. The generated files are committed; CI runs `pnpm -F tape-server bridge:check` which regenerates and `git diff --exit-code`s the directory, so a Rust struct change without the TS mirror fails the PR. No hand-maintained parallel schema.

**Persistence.** Vanilla PostgreSQL 17 via Drizzle. Two tables: `ticks` is partitioned with native declarative `PARTITION BY RANGE (ts_ms)` on a monthly cadence, retention horizon 30 days, partition lifecycle managed by an in-process scheduler that runs at boot and re-arms daily at 03:00 UTC. `footprint_cells` is a plain table — year-1 row count sits below the partition-management break-even at single-symbol scale (ADR-005). Tick ingest writes through Elysia direct via batched `COPY ticks FROM STDIN` on a 50 ms coalescing window — decoupled from the worker so a worker crash-loop does not block tick archival. Cells are written by the Rust worker on bar-close, one transaction per minute.

**WebSocket fan-out.** Single endpoint `/ws/stream`, topic-multiplexed envelope (`{ topic, kind, payload }`), `topic ∈ { 'ticks.btc', 'cells.btc', 'control' }`. Discriminated union over `kind: 'tick' | 'cell.delta' | 'cell.close' | 'snapshot' | 'control.overrun' | 'control.heartbeat'` so the schema mechanically enforces ADR-005's mid-bar-deltas-vs-bar-close-totals invariant. Backpressure: drop-oldest tick frames + server-side cell-delta coalescing keyed by `(symbol, bucket_ts, price_bucket)` as the primary policy; a 256 KB / 2 s per-client circuit breaker emits `control.overrun` and closes with `CloseEvent.code = 4290` as second-line defence (ADR-006).

**Frontend.** Next.js 15 App Router + React 19 + Tailwind v4 in CSS-first mode (`@theme` block, no `tailwind.config.js`). TanStack Query for HTTP, Zustand for ephemeral live state, `useSyncExternalStore`-backed theme-token bridge so the Canvas2D layer reads CSS variables without re-rendering React. WebSocket frames decode via `msgpackr` and validate via Zod schemas re-exported from `tape-server` over a types-only Eden Treaty surface. The chart is hand-rolled Canvas2D, subscribe-once contract, dirty-flag-gated rAF. Motion handles only chrome (rail collapse, replay bar height) — the chart, the tape ticker, and the CVD pane never touch React reconciliation per frame.

**Supervision.** The worker is a `Bun.spawn` child of Elysia. Reconnect backoff is the project-wide curve: 250 ms initial, capped at 5 s, ±20 % symmetric jitter, reset after 60 s of healthy uptime. A 10-crashes-in-60-s circuit breaker stops the respawn loop on a poisonous binary; the public WS continues to serve the tick stream and emits a `worker_unavailable` control frame so the browser can render a partial-data state instead of going dark (ADR-004).

**What is NOT shipped in v1.0.**

- Historic replay engine (Task 1.7) — the UI scrubber renders but is not wired to data.
- User accounts and saved layouts (`better-auth` scaffolding is committed but inactive — v2 reactivation path).
- Per-IP rate limit on the public WebSocket (reviewer-flagged, to land at deploy time alongside the CSP headers).
- Intra-cell bid/ask histogram + per-bar delta print + CVD sub-pane — designer-critic CRITIQUE-2026-05-31 flagged these as the headline wow-moment gap. Tracked for v1.1 (see [CHANGELOG.md](./CHANGELOG.md)).

## Stack

**Frontend** (`web/`)
- Next.js 15.5 (App Router) · React 19.2 · TypeScript strict
- Tailwind CSS v4.3 (CSS-first, OKLCH palette, no `tailwind.config.js`)
- next-themes 0.4 · TanStack Query 5 · Zustand 5 · react-hook-form · Zod 4
- Motion 12 (chrome only) · lucide-react · shadcn/ui (button, tooltip, separator)
- msgpackr 2 (binary WS frame decoding)

**Backend** (`server/`)
- Elysia 1.1 on Bun 1.3 · Eden Treaty (types-only contract surface)
- Drizzle 0.45 + drizzle-zod · postgres-js 3.4 (driver, not `node-postgres`)
- Zod 3 · msgpackr 2 (same codec as the frontend, single wire-format vocabulary)
- @elysiajs/cors · @elysiajs/swagger

**Worker** (`worker/`)
- Rust 2024 edition (toolchain >= 1.80, verified on 1.96)
- tokio 1 (`rt-multi-thread`, `net`, `io-util`, `signal`, `time`)
- interprocess 2 (cross-platform UDS / named-pipe abstraction with the tokio feature)
- rmp-serde 1 · serde 1 · ts-rs 10 (Rust struct -> TypeScript codegen)
- anyhow 1

**Tooling**
- pnpm 11 (workspace) · Node 22 LTS
- ESLint 9 (flat config) · Prettier 3 · Husky + lint-staged + commitlint
- Vitest (web) · `bun test` (server) · Playwright (planned for E2E)
- PostgreSQL 17 (Docker image `postgres:17-alpine`)

## Run locally

Prereqs:

- **Bun >= 1.3** ([install](https://bun.sh))
- **Rust >= 1.80** ([rustup.rs](https://rustup.rs)), `cargo` on `PATH`
- **Docker** for the Postgres dev container
- **pnpm >= 11** and **Node 22 LTS** (the repo pins both via `packageManager` and `.nvmrc`)

```sh
# 1. Bring up Postgres on port 5435 (dodges system 5432 and Mila on 5434).
docker compose -f projects/tape/docker-compose.yml up -d

# 2. Install JS deps across the workspace.
pnpm install

# 3. Build the Rust worker binaries (echo + worker + gen-fixtures).
cd projects/tape/worker
cargo build --bin echo --bin worker --bin gen-fixtures
cd ../../..

# 4. Provision the database schema (creates ticks partitions for the current month + next).
pnpm -F tape-server db:migrate

# 5. Configure environment.
cp projects/tape/server/.env.example projects/tape/server/.env
# Edit if needed. The default values cover the local dev stack as-is.

# 6. Start backend + frontend in two terminals.
pnpm -F tape-server dev    # Elysia on http://localhost:3001 (Bun --watch)
pnpm -F tape-web dev       # Next on  http://localhost:3000 (falls back to 3002 if 3000/3001 are occupied)
```

Open the URL the Next dev server prints — on the owner's machine that is typically `http://localhost:3002` because ports 3000 and 3001 are usually in use. Wait ~2 minutes for the chart to populate (synth produces ~5 ticks/s and one `cell.delta` per 500 ms — bars close once per minute).

**Three-way data-source mutex** (the env knobs that decide which producer feeds the WebSocket — same precedence is documented in `server/.env.example`):

1. `BINANCE_WS_ENABLED=1` + `WORKER_PIPELINE_ENABLED=1` — full real pipeline (Binance feed -> bridge -> Rust worker -> cells).
2. `BINANCE_WS_ENABLED=1` + `WORKER_PIPELINE_ENABLED=0` — tape strip only (Binance ticks reach the browser; no cell aggregation).
3. `BINANCE_WS_ENABLED=0` + `WS_SYNTHESIZE=1` — deterministic in-process synthesizer (UI screenshots, CI, offline dev). Worker is not in the loop.

If `BINANCE_WS_ENABLED=1` and `WS_SYNTHESIZE=1` are both set, the real feed wins and the synth is silently disabled (boot logs a `WARN`). The Binance public WebSocket is geo-blocked or throttled from some networks — if the smoke at `bun projects/tape/server/scripts/binance-smoke.ts` connects but no frames arrive within 30 s, flip to the synth path for local dev and rely on CI for the real-feed verification (`server/AGENT_NOTES` documents this in detail).

## License

[MIT](../../LICENSE).

## Author

[Jan Antczak](mailto:janek.antczak@gmail.com). Portfolio root: [`../../README.md`](../../README.md).
