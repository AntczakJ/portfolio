# tape-server

Elysia on Bun control plane for the **tape** real-time orderflow visualizer. Ingests Binance Futures aggTrade / depth / bookTicker streams, hands hot-path footprint aggregation to a Rust worker over a local IPC bridge, and fans the resulting cell updates out to subscribed browser clients over WebSocket. The Next.js client lives in `../web/`; the Rust hot-path worker lives in `../worker/` (introduced in Phase 1 Task 1.5).

Why Elysia on Bun: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-001**.
Why the Rust worker sits behind a UDS / named-pipe bridge instead of Bun FFI: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-002**.
Why supervision is in-Bun (`Bun.spawn`) rather than s6-overlay: see [`../DECISIONS.md`](../DECISIONS.md) **ADR-004**.

## Current state

**Phase 1 — Tasks 1.1, 1.2, 1.2a, 1.2b, 1.3, 1.4a, 1.4b, 1.5b, 1.6a, and 1.6b landed.** `GET /health` returns `{ status, commit, ts, db, worker, ws, binance }`. Drizzle ORM + Postgres are scaffolded with `sessions`, `ticks` (monthly-partitioned), and `footprint_cells`; the Binance Futures aggTrade ingest path is live (Task 1.3), the worker hot-path replaces the placeholder echo binary in Task 1.5. Tick archival is wired (Task 1.2b) — a `TickWriter` singleton at `src/lib/ingest/tick-writer.ts` owns a bounded 500-row ring buffer (`TICK_BATCH_RING_CAP`) flushed every 50 ms (`TICK_BATCH_WINDOW_MS`) via Postgres `COPY ticks (...) FROM STDIN`; a `RetentionScheduler` singleton at `src/lib/ingest/retention-scheduler.ts` runs a bootstrap sweep at server start and re-arms a daily 03:00 UTC sweep that calls `ensureRollingPartitions(2)` + `dropTickPartitionsOlderThan(30)`. The two counters this surfaces on `/health.db` — `partitionCreateLagDays` and `tickBatchFlushCount` — are read live off the singletons. Bridge serialization tooling (Task 1.4b) is in place — Rust worker crate at `../worker/` declares the bridge payload types (`TickFrame`, `CellSnapshot`, `ControlCommand`, ...), `ts-rs` emits the TypeScript mirrors under `src/lib/schemas/bridge/generated/`, and `msgpackr` is wired through `src/lib/bridge/codec.ts`. Bridge transport (Task 1.4a) is in place — `BridgeClient` over Bun's `unix` socket surface with length-prefixed framing and exponential backoff reconnect, `WorkerSupervisor` over `Bun.spawn` with the same backoff curve and a 10-crashes-in-60-s circuit breaker per ADR-004. The supervisor singleton is constructed at boot but **not started** — Task 1.5 owns the spawn wiring once the real worker binary exists. Binance ingestion (Task 1.3) is wired — a `BinanceFuturesClient` subscribes to `<symbol>@aggTrade` on Bun's native browser-spec `WebSocket` with the same 250 ms -> 5 s ±20% backoff curve as the bridge; a `BinanceIngestor` opens a `sessions` row, hands each validated event to `tickWriter.enqueue` for persistence AND to `registry.broadcast` as a `tick` frame AND to `snapshotCache.update` for the reconnect snapshot. The synthesizer stays in place for `BINANCE_WS_ENABLED=0` and is mutually exclusive with the real ingest at the boot layer.

## Local development

Prerequisites:

- **Bun >= 1.1** ([install](https://bun.sh/docs/installation)). The repo pins Node 22 for tooling, but this package runs under Bun.
- **pnpm >= 9** (already pinned at the monorepo root via `packageManager`).
- **Docker** for the local Postgres container.
- **Rust toolchain (stable, >= 1.80)** for the bridge schema codegen — see `../worker/Cargo.toml`. Install via [rustup](https://rustup.rs/). The `cargo` binary must be on `PATH` when `pnpm -F tape-server bridge:generate` runs.
- **Optional MessagePack inspector** for debugging captured bridge frames: either [`msgpack-cli`](https://github.com/msgpack/msgpack-cli) (Java) or [`msgpack2json`](https://github.com/ludocode/msgpack-tools) (Go binary, the path of least friction on Windows). The canonical debug command is `socat -v UNIX-CONNECT:./tape.sock - | msgpack2json` on Linux, equivalent named-pipe proxy on Windows.

Bring up the dev database (from repo root):

```sh
docker compose -f projects/tape/docker-compose.yml up -d
# Postgres listens on localhost:5435 with credentials tape / tape / tape
```

First-time setup — copy env, apply the schema, and generate the bridge schema:

```sh
pnpm install
cp projects/tape/server/.env.example projects/tape/server/.env
pnpm -F tape-server db:migrate
pnpm -F tape-server bridge:generate
```

`bridge:generate` runs `cargo test` in `../worker/` and writes the TypeScript counterparts under `src/lib/schemas/bridge/generated/` so the server compiles. The generated files **are** committed; running the script after a fresh clone should produce a no-op diff. See "Bridge schema workflow" below for the contract.

After `db:migrate` the `ticks` table is partitioned by month on `ts_ms`. The migration bootstraps partitions for the **current month and the next month** (ADR-005 + Task 1.2a). Subsequent months are pre-created by the daily 03:00 UTC sweep that Task 1.2b wires into the Elysia boot path — the sweep calls `ensureRollingPartitions(lookaheadMonths = 2)` from `src/db/partitions.ts` and is idempotent. **`footprint_cells` is intentionally not partitioned** per ADR-005; year-1 cell volume sits below the partition-management break-even at single-symbol scale.

Run the server:

```sh
pnpm -F tape dev
# or, equivalently, target the server package directly:
pnpm -F tape-server dev
```

**On boot, the server starts two ingest singletons (Task 1.2b):**

1. `RetentionScheduler` runs ONE sweep immediately — calls
   `ensureRollingPartitions(2)` so the current month plus the next two
   are partitioned, then `dropTickPartitionsOlderThan(30)` to drop any
   partition whose whole range is outside the 30-day retention horizon.
   The bootstrap sweep is awaited before `app.listen()`, so a fresh
   container is partitioned-and-pruned before any tick can be enqueued.
   The scheduler then arms a `setTimeout` for the next 03:00 UTC moment
   (the ADR-005 "calm hour" for BTC volume) and rolls forward daily.
2. `TickWriter` opens a 50 ms coalescing timer. The `Binance ingest path
   (Task 1.3, not yet implemented) will call `tickWriter.enqueue(row)`
   once per aggTrade; the writer flushes the entire ring in one
   `COPY ticks (...) FROM STDIN` per coalescing window. Ring capacity is
   500 rows (`TICK_BATCH_RING_CAP`); overflow drops the oldest row and
   increments an internal `dropTotal` counter.

**Both singletons fail fast on a missing `DATABASE_URL`.** This is the
runtime ingest path, not the observability path — partition management
must not silently no-op. `/health.db` stays tolerant (the dedicated
`pingDb()` accessor reports `{ connected: false, latencyMs: null }`
when the env var is unset); the writer and scheduler refuse to start.

Then probe the health endpoint:

```sh
curl http://localhost:3001/health
# {"status":"ok","commit":"<short-sha-or-dev>","ts":1717000000000,
#  "db":{"connected":true,"latencyMs":3,
#        "partitionCreateLagDays":0,"tickBatchFlushCount":0},
#  "worker":{"state":"idle","pid":null,"restartCount":0,
#            "lastExitCode":null},
#  "ws":{"connectedClients":0,"framesPerSecOut":0,
#        "droppedFrameCount":0,"overrunDisconnectCount":0,
#        "snapshotCacheHitRate":null}}
```

`partitionCreateLagDays` is `0` in the happy steady state, `1..2`
warning (scheduler missed a tick — self-heals next sweep), `> 2`
critical. `tickBatchFlushCount` is `0` until Task 1.3 starts feeding
ticks; under sustained ingest it grows by ~20/s (one flush per 50 ms
coalescing window while the ring is non-empty).

Interactive OpenAPI docs are mounted at `http://localhost:3001/swagger` via `@elysiajs/swagger`.

Tear down when done:

```sh
docker compose -f projects/tape/docker-compose.yml down
# add -v to wipe the data volume
```

## Scripts

| Script | Action |
| --- | --- |
| `dev` | `bun run --watch src/server.ts` — hot-reload dev server |
| `build` | `bun build src/server.ts --target=bun --outdir=dist` |
| `start` | `bun run src/server.ts` — production entry, no watch |
| `lint` | `eslint .` (extends root flat config) |
| `typecheck` | `tsc --noEmit` against the strict base config |
| `test` | `bun test` |
| `db:generate` | `drizzle-kit generate` — produce migration SQL from `src/db/schema/*` into `drizzle/` |
| `db:migrate` | `drizzle-kit migrate` — apply pending migrations against `DATABASE_URL` |
| `db:push` | `drizzle-kit push` — push schema directly (dev convenience, **never use against prod**) |
| `db:studio` | `drizzle-kit studio` — local schema browser at `https://local.drizzle.studio` |
| `bridge:generate` | Regenerate `src/lib/schemas/bridge/generated/*.ts` from the Rust source in `../worker/` (runs `cargo test`). |
| `bridge:check` | CI gate — runs `bridge:generate` then `git diff --exit-code` on the generated directory. Non-zero exit if a Rust struct changed without the TS mirror being committed. |
| `bridge:clean` | Delete every `.ts` file under `src/lib/schemas/bridge/generated/` (useful when the Rust side removes / renames a type and you want to clear orphan TS files before regenerating). |

All three of `dev` / `start` / `build` require Bun on PATH. The `db:*` scripts run under Node via pnpm and do not need Bun. The `bridge:*` scripts run under Node and require the Rust toolchain (`cargo`) on PATH.

## Conventions

- **No fallbacks for absent env vars on hot paths.** If `DATABASE_URL` or `BRIDGE_PATH` is missing when the corresponding subsystem boots, the server **fails fast** — never silently default to a wrong value. The fail-fast accessors live in `src/db/index.ts` as `getSql()` and `getDb()`; any call site that needs the database must use them.
- **`/health` is the one exception.** The endpoint must answer on a fresh checkout (before `.env` is created), so `pingDb()` tolerates a missing `DATABASE_URL` and reports `{ connected: false, latencyMs: null }`. Tolerance is scoped to this one observability path and is documented in code next to the env-var read.
- **Zod at the boundary.** Every response shape and every WebSocket frame is parsed through a Zod schema in `src/lib/schemas/` before it crosses the wire. The same schema files are imported by the Next.js client in `../web/` so the frontend and backend share a single contract per `docs/conventions.md` § 5.
- **No `eval`, no `new Function`, no raw query interpolation.** Anything dynamic flows through a validated schema or a parameterised query.
- **`.env` is never committed.** `.env.example` is the contract.

## Bridge schema workflow

The Rust ↔ Bun bridge carries MessagePack-encoded frames between the Elysia control plane (this package) and the Rust hot-path worker at `../worker/`. Per **ADR-003**, the Rust struct is the single source of truth; the TypeScript counterpart under `src/lib/schemas/bridge/generated/` is mechanically derived via [`ts-rs`](https://github.com/Aleph-Alpha/ts-rs).

**Stable import path.** Application code reaches for the barrel:

```ts
import type { TickFrame, CellSnapshot, ControlCommand } from '@/lib/schemas/bridge';
```

Do not import the per-file paths under `generated/` directly — they may move when ts-rs evolves.

**Adding a field to a bridge struct.**

1. Edit the Rust struct in `../worker/src/bridge/messages.rs`. New fields **must** be optional:
   ```rust
   #[serde(default, skip_serializing_if = "Option::is_none")]
   pub new_field: Option<i64>,
   ```
   This is the ADR-003 backward-compat rule. A worker built off `main` must still talk to an older Elysia during rolling restarts, and vice versa.
2. Run `pnpm -F tape-server bridge:generate`. ts-rs rewrites the `.ts` mirror.
3. Commit both sides in the same PR — Rust source under `../worker/src/bridge/messages.rs` and the regenerated TS under `src/lib/schemas/bridge/generated/`. CI runs `bridge:check` which fails the PR if either side is missing.

**Renaming or removing a field.** Forbidden in place. Add the replacement as a new optional field, dual-write for one release, switch readers to the new name, then remove the old one in a follow-up release. MessagePack maps are unordered on the wire — never introduce a manual `Serialize` impl that assumes field order.

**Type-mapping gotcha.** ts-rs maps Rust `i64` to TypeScript `bigint` because JS `number` cannot represent the full i64 range without precision loss. MessagePack encodes signed integers natively, and `msgpackr` on the Bun side decodes them as `bigint`. Callers do millisecond arithmetic with `BigInt(...)` literals or coerce at the boundary they own.

**msgpackr footgun.** The Bun-side codec at `src/lib/bridge/codec.ts` is constructed with `useRecords: false`. msgpackr's "records" optimisation (column-style key dedup) is non-standard MessagePack and the Rust `rmp-serde` decoder will not parse it. Do **not** flip that flag for the encode-speed win — it silently breaks the worker.

**Debugging captured frames.** Because MessagePack maps are self-describing (every key is on the wire), a captured frame stream can be decoded post-hoc without checking out a matching schema revision: `socat -v UNIX-CONNECT:./tape.sock - | msgpack2json` on Linux, equivalent named-pipe proxy on Windows. This is the load-bearing benefit ADR-003 picked MessagePack over Protobuf for — keep an inspector installed.

## Bridge conformance fixtures

The Rust ↔ Bun bridge contract is locked by a committed fixture set under `src/lib/schemas/bridge/fixtures/`. Each representative frame variant (one minimal tick, one typical tick, one minimal cell snapshot, one peak cell snapshot, one `Pause` control, one `Snapshot` control) ships **three** files:

- `<name>.json` — human-readable source-of-truth describing the logical value, the schema, and any documented field coercions (e.g. JSON-string-as-bigint for Rust `i64` fields). Edit this when the canonical value changes.
- `<name>.msgpack` — the canonical rmp-serde-authored byte oracle (what the Rust worker writes on the live bridge). Derived from the Rust struct literal in `worker/src/bin/gen-fixtures.rs`. **Never hand-edit.**
- `<name>.from-ts.msgpack` — the canonical msgpackr-authored byte oracle (what the Elysia control plane writes on the live bridge). Derived from the matching JS literal in this package's `conformance.test.ts`. **Never hand-edit.**

Both `.msgpack` flavours decode to the same logical value on both sides — that is the bidirectional contract the bridge depends on. The byte representations differ between rmp-serde and msgpackr because both encoders pick different spec-valid forms for the same logical value (msgpackr always emits `map16` and BigInt-as-int64; rmp-serde emits fixmap and the smallest int container that fits). Both shapes are MessagePack-spec-conformant and both decoders accept both.

### Schema-change workflow

When you edit a bridge struct in `worker/src/bridge/messages.rs`:

```sh
cd projects/tape/worker
cargo test                                # re-emit ts-rs TS bindings
cargo run --bin gen-fixtures              # re-emit .msgpack (Rust oracle)
cd ../server
BRIDGE_GEN_FROM_TS=1 bun test \
  src/lib/bridge/__tests__/conformance.test.ts   # re-emit .from-ts.msgpack
bun test src/lib/bridge/__tests__/conformance.test.ts  # green run
```

Commit all generated files in the same PR. CI runs only the verification (Rust `cargo test` for the integration conformance test + Bun `bun test` for the TS side, on both Ubuntu and Windows) — it never regenerates fixtures. If a regeneration produces different bytes for the same logical value, that is a schema or ordering bug to investigate — do **not** silently overwrite the fixtures.

The `_doc` field at the top of every `<name>.json` carries the binary-is-oracle convention inline so it survives a fresh-checkout reading without consulting this README.

## Live Binance ingestion (Task 1.3)

When `BINANCE_WS_ENABLED=1` (default), the server connects to the public Binance Futures `<symbol>@aggTrade` stream on boot and the in-process dev synthesizer stays OFF. The wiring lives at `src/lib/ingest/binance-{client,translator,ingestor}.ts`; `src/lib/ingest/ingest-session.ts` owns the `sessions` row lifecycle (insert on connect, `ended_at` stamp on `stop()`).

`/health.binance` exposes live counters:

```ts
{
  connected: boolean,         // upstream WS state === 'connected'
  lastTickTsMs: number | null,// Binance trade time of last parsed aggTrade
  parseErrors: number,        // cumulative JSON / Zod parse failures
  restartCount: number,       // cumulative automatic reconnect attempts
  sessionId: string | null    // active sessions.id (UUID)
}
```

When `BINANCE_WS_ENABLED=0`, the ingestor is not constructed and the sub-shape reads as `{ connected: false, lastTickTsMs: null, parseErrors: 0, restartCount: 0, sessionId: null }` — the schema contract is honest in both modes so Eden Treaty types stay stable for `tape-web`.

**Mutex policy.** Both `WS_SYNTHESIZE=1` and `BINANCE_WS_ENABLED=1` publish to the same registry under `ticks.btc`, so they are mutually exclusive at the boot layer. If both are set to `'1'`, BINANCE_WS_ENABLED wins (real feed beats dev convenience) and the boot path logs `[tape-server] WS_SYNTHESIZE=1 AND BINANCE_WS_ENABLED=1 — synthesizer disabled; real Binance ingest wins.`

**v1.0 limitation.** Without the Rust worker (Task 1.5), the Binance ingestor emits `tick` frames only — no `cell.delta` or `cell.close`. The Phase 3 chart must handle "tape strip only, no cells" gracefully. The aggregation path lands when Task 1.5 wires the worker, at which point `cell.*` frames begin flowing alongside the existing tick stream.

## Binance smoke

A one-shot operator-facing diagnostic that connects via `BinanceFuturesClient` against the configured public endpoint, prints the first 20 successfully parsed aggTrades, and exits 0. No DB writes, no broadcast — this script exercises the client + Zod schema layer only.

```sh
bun projects/tape/server/scripts/binance-smoke.ts
# override the endpoint with BINANCE_WS_URL=wss://... and / or BINANCE_SYMBOL=ethusdt
```

Exit 0 on success (reached 20 events within 30 s); exit 1 on timeout or connect failure. If the connection opens but no events arrive within the window, the most likely cause is a regional restriction on `fstream.binance.com` from the host network (Binance occasionally throttles or geo-blocks at the streaming-layer without rejecting the WS handshake). A successful smoke from another network is the workaround — the unit suite in `src/lib/ingest/__tests__/` exercises every code path against a fake WebSocket and is the canonical CI-gated correctness signal.

## WebSocket smoke

Manual end-to-end check of the Task 1.6b WS fan-out endpoint. Connects to `ws://localhost:3001/ws/stream`, decodes the initial snapshot, listens for 10 s, and prints a per-`kind` frame tally before exiting. The server must be running with the synthesizer enabled so a connected client sees a live frame stream.

Two terminals from the repo root.

Terminal 1 — start the server with the deterministic in-process synthesizer:

```sh
WS_SYNTHESIZE=1 pnpm -F tape-server dev
# synthesizer cadence: 5 ticks/s, one cell.delta every 500 ms, one cell.close every 60 s
# seed defaults to 1, override via WS_SYNTHESIZE_SEED=<integer>
```

Terminal 2 — run the smoke:

```sh
bun projects/tape/server/scripts/ws-smoke.ts
# override the URL with WS_URL=ws://host:port/ws/stream or --url=...
```

Expected output: the initial snapshot summary, then a per-kind tally (`tick: ~50`, `cell.delta: ~20`, `control.heartbeat: ~2`, possibly `cell.close: 1` if the run crosses a minute boundary). Exit 0 on any frames received, exit 1 if the connection produced nothing.

The synthesizer is in-process and dev-only — it gates on `WS_SYNTHESIZE=1` and is replaced by the Binance Futures ingest path in Task 1.3 and the Rust worker in Task 1.5.

## Bridge smoke test

A manual end-to-end check of the Task 1.4a transport against the placeholder Rust `echo` worker. This is **not** a CI test — the conformance suite that gates the contract lives in Task 1.5b. The smoke is a one-shot confirmation that `BridgeClient` + `FrameReader` + the msgpackr codec round-trip three representative frames (tick / cell snapshot / control) against the Rust side.

Two terminals from the repo root.

Terminal 1 — start the Rust echo worker (binds the bridge endpoint and echoes every framed payload):

```sh
cd projects/tape/worker
cargo build --bin echo
./target/debug/echo            # or target/debug/echo.exe on Windows
```

Terminal 2 — run the smoke script (connects, sends three frames, decodes the echoes, closes cleanly):

```sh
cd projects/tape/server
bun run scripts/bridge-smoke.ts
# expected last line: bridge smoke OK
```

Override the endpoint via `BRIDGE_PATH=/tmp/custom.sock` (Linux) or `BRIDGE_PATH=\\.\pipe\custom` (Windows) on both sides if the default `/tmp/tape-bridge.sock` / `\\.\pipe\tape-bridge` clashes with a parallel run.

Exit 0 with `bridge smoke OK` means the transport is healthy on this host. Any non-zero exit is a hard fail (assertion mismatch, framing desync, connect error, or the 5 s per-frame timeout).

## Database

- **Driver:** [`postgres`](https://github.com/porsager/postgres) (postgres-js) — first-class on Bun and Node, owns its own pool, no separate wiring.
- **ORM:** [Drizzle](https://orm.drizzle.team) with the `drizzle-orm/postgres-js` adapter.
- **Schema source of truth:** TypeScript files under `src/db/schema/`. One table per file. The barrel at `src/db/schema/index.ts` re-exports everything; `drizzle.config.ts` globs the directory.
- **Migrations:** Generated into `drizzle/` and committed. Never hand-edit a generated `.sql` file **except** when introducing Postgres features Drizzle's DSL cannot express (currently: native partitioning on `ticks`). The hand-edit policy and one-way migration rule are documented in the header of `drizzle/0001_*.sql`.
- **Partition helpers:** `src/db/partitions.ts` exposes `ensureTickPartitionFor`, `ensureRollingPartitions(lookaheadMonths = 2)`, and `dropTickPartitionsOlderThan(retentionDays)`. The lifecycle scheduler that calls them lands in Task 1.2b.
- **Connection string:** `postgres://tape:tape@localhost:5435/tape` in local dev. Port 5435 dodges the system default (5432) and Mila (5434). See `../docker-compose.yml`.

## Related

- **`../PLAN.md`** — full project plan, task list, success criteria.
- **`../DECISIONS.md`** — ADRs. ADR-001 (stack + backend), ADR-002 (bridge mechanism), ADR-003 (bridge serialization), ADR-004 (worker supervision), ADR-005 (persistence schema).
- **`../PROGRESS.md`** — current state, what is in progress, what is next.
- **`../AGENT_NOTES.md`** — cross-cutting concerns, gotchas, decisions to revisit.
- **`../web/`** — Next.js 15 client.
- **`../worker/`** — Rust hot-path worker crate. Owns the bridge payload schemas (`Cargo.toml`, `src/bridge/messages.rs`); the TypeScript mirrors under `src/lib/schemas/bridge/generated/` are derived from there.
