# Changelog

All notable changes to **tape** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- README rewritten for the shipped, deployed v1: live demo link, the architecture as headline (Rust worker + MessagePack bridge + supervisor + single-image multi-process deploy), a Mermaid data-flow diagram, accurate run instructions (offline pipeline recipe, dev ports, `cargo build`), the screenshot set, the ADR-001..009 summary, and an honest testing / Lighthouse story.
- `docs/screenshots/` — full footprint board (dark / light), a fresh live-deploy capture from `tape-demo.fly.dev`, replay mode, and the mobile tape-only fallback embedded in the README.
- `e2e/capture-live.mjs` — Playwright script that captures a fresh screenshot from the live deploy headlessly.

## [0.1.0] — 2026-06-05

The wow-moment feature set landed, the review defects were cleared, the test suites filled out across all three runtimes, and the project deployed to [https://tape-demo.fly.dev](https://tape-demo.fly.dev). Three more ADRs ratified (ADR-007 bucketing, ADR-008 CVD placement, ADR-009 the Lighthouse trade-off). The footprint chart now renders the intra-cell bid/ask histogram, the CVD sub-pane, the live tape ticker, and a wired replay mode — the gaps the v0.0.1 designer-critic pass flagged.

### Added

**Architecture (ADR-007 to ADR-009).**

- **ADR-007** — Footprint bucketing grid: 1-minute time buckets + $5 BTC-PERP price buckets. Single source of truth via a documented "these files must match" conformance assertion (Rust `bucketing.rs` canonical, TS `bucketing.ts` mirror) rather than codegen — the constants are two scalars that do not change in v1. Synthesizer + ingestor stop hard-coding `60_000` / `5` inline. The v2 per-symbol path swaps a flat constant for a per-symbol lookup with no schema or protocol bump.
- **ADR-008** — CVD lives in the pure aggregator on **both** sides: ported to the Rust worker as a `1.5` follow-on (it emitted `Delta` / `Close` only before), and covered by the Rust <-> TS conformance suite. CVD stays **off** the WS wire in v1 — the live CVD line derives client-side by folding `askVolume − bidVolume` per `cell.close` (data the browser already parses) into a running per-symbol CVD. The Rust/server CVD is the conformance reference, the replay source of truth, and a reserved additive v2 wire promotion.
- **ADR-009** — Accept Lighthouse Performance < 95 on tape's live orderflow route as a deliberate, scoped trade-off. A continuously rendering real-time chart cannot satisfy Lighthouse's idle-page Total Blocking Time model without gating the chart behind a click or throttling below 60 fps — both of which destroy the wow moment. CLS, Accessibility, Best Practices, and SEO stay hard-gated at >= 95 (and are met: CLS 0 / A11y 96 / BP 96 / SEO 100); Performance lands at 77.

**Frontend — the wow moment (Phase 3).**

- Task 3.2c — Intra-cell bid/ask histogram + per-bar delta print (closing the D-03 designer-critic gap); the literal footprint signal is no longer collapsed to a heatmap.
- Task 3.2c — CVD line sub-pane on a second canvas driven by the same engine rAF pass and X-scale as the footprint (axes locked), with a baseline-zero line and a numeric value label as the non-colour channel. A bounded per-bar CVD time-series ring backs it.
- Task 3.3 — Live tape ticker: transform-positioned virtualized rows (last ~100 trades), bid/ask colour coding, per-tick arrival motion.
- Task 3.4 — `WSStreamClient` + `useStreamStore` (ring-bounded recent ticks + closed cells) + client-side CVD derivation; reconnect-from-snapshot proven by bouncing the server mid-stream.
- Task 3.5 — Cursor crosshair + per-cell readout (aggregated bid / ask / delta / imbalance%), mirrored to an `aria-live="polite"` region throttled to one announcement per cell change; the visual tooltip is `aria-hidden` so screen readers get a single channel.
- Task 3.6 — Replay mode: switches the data source from the live WebSocket to the `GET /api/replay/:symbol/:date` NDJSON endpoint and drives the rAF loop from a virtual clock at 1x / 5x / 30x, proven against a seeded historic day.
- Worker-offline indicator: the store derives worker availability from `control.worker_unavailable` / `control.worker_ready` and renders a calm "cells paused — worker restarting" state (warning tone, never danger red).
- Fonts: Inter + JetBrains Mono loaded and self-hosted via `next/font` (`display: 'optional'`, no swap reflow), with a canvas re-paint on `document.fonts.ready` so the chart numerics resolve to JetBrains Mono.

**Backend — replay wired (Phase 1 completion).**

- Task 1.7 — Historic replay routes: `GET /api/replay/:symbol/:date` streams the day's closed `footprint_cells` as NDJSON from a server-side cursor (never buffered), `/ticks` streams the raw tick archive for a window. Replay reads from Postgres only (the offline-safe half of the ADR-005 live/replay read split).
- Task 1.4 / 1.5e — TypeScript footprint-aggregator reference impl + shared conformance fixtures; CVD ported into the Rust aggregator so the Rust core owns all the aggregation math.
- Task 1.4c — Bucketing constants de-duplicated per ADR-007 (4 call sites collapsed to 2 irreducible per-language literals + the assertion test).

**Tests (Phase 5).**

- `bun test` server suites (~314) — WS frame schemas, tick batch writer, partition lifecycle, bridge transport + framing, supervisor backoff, Binance client against recorded frames, replay query + NDJSON serialization.
- Vitest web suites (195, 18 files) — footprint / CVD engine, painters, theme-token bridge, stream store + rings, reserved-dimension CLS guards, worker-offline indicator.
- `cargo test` Rust suites (~49) — aggregator + CVD invariants and the Rust <-> TypeScript bridge conformance against committed MessagePack byte oracles.
- Playwright E2E (`tape-e2e`, 15) — live-footprint render, replay control wiring, theme toggle, keyboard a11y, and a client-side ~200 ticks/sec frame-budget load test; deterministic in CI via a dev-only store-injection hook + mocked WebSocket, with one `@live` spec behind a flag.

**Performance hardening (Phase 5.4).**

- CLS 0.337 -> 0: the mobile tape feed's normal-flow row prepend (every tick pushed the list down ~31 px) rewritten to transform-positioned rows; status-bar numerics reserved with `tabular-nums` + `min-w`; SideRail / ReplayBar / ApiStatus chrome boxes reserved.
- TBT ~930 ms -> ~260–630 ms: WebSocket connect + snapshot decode deferred behind `requestIdleCallback` (past the interactive window); the rAF render loop made self-idling (zero frames on a quiet market) — without gating the chart behind a gesture.

**Deploy (Phase 6).**

- Four-stage `Dockerfile` (rust-builder, web-builder, server-builder, slim runtime) producing one image; `entrypoint.sh` runs the migration, starts the Bun server, waits for `/health`, then launches Next and forwards SIGTERM to both children.
- `fly.toml` — single Machine in `fra`, all external HTTPS terminating at the Elysia server on 3001 with a catch-all reverse proxy to Next on 3000 (one external port, no dual-service collision); machine kept warm (`auto_stop_machines = 'off'`, `min_machines_running = 1`) so the WS stream is live on load.
- `DEPLOY.md` production runbook: one-time Fly + Postgres setup, deploy, verify, rollback, troubleshooting, cost.
- Deployed to [https://tape-demo.fly.dev](https://tape-demo.fly.dev); `/health` returns `status: ok` with `db.connected: true` and `worker.state: connected` (`cellsOpen` / `ticksProcessed` climbing, WS frames flowing).

### Changed

- The v0.0.1 review-pass gaps (D-03 intra-cell histogram, D-04 CVD sub-pane) are closed; the chart now carries the full footprint identity rather than a heatmap.

### Known boundaries (v1)

- **Synth tick source on the demo.** Binance's public WebSocket is geo-restricted from the Fly deploy region, so the demo runs a deterministic in-process synthesizer feeding the Rust worker over the same bridge the real feed would. The worker produces real cells, CVD, tape, and persisted history without the exchange. The Binance client is built, unit-tested, and env-flagged off (`BINANCE_WS_ENABLED=0`).
- **No accounts / auth in v1.** `better-auth` is named as the v2 identity path (saved layouts, alerts) but is not present — no dependency, no active code.
- **Single symbol.** BTC-PERP only; ETH-PERP / SOL-PERP defer to v2 (the `topic` dimension already carries the symbol, so no protocol bump is needed).
- **Lighthouse Performance 77 on the live route** — accepted and documented in ADR-009; CLS / A11y / BP / SEO are >= 95.

## [0.0.1] — 2026-05-31

First publishable cut. Backend is feature-complete for v1.0, frontend ships the chart core + cursor + tooltip + mobile collapse, six ADRs ratified, designer-critic and reviewer passes landed with three fixes shipped. Deploy is the next step.

### Added

**Architecture (ADR-001 to ADR-006).**

- **ADR-001** — Stack flavour `api-heavy`, backend Elysia on Bun plus a Rust hot-path worker (rationale: Bun `ServerWebSocket` fan-out throughput, Eden Treaty types-only contract, NautilusTrader-style topology as senior-signal).
- **ADR-002** — Bridge transport: Unix domain socket on Linux, named pipe on Windows, length-prefixed binary framing (`u32` LE length + payload). Won against Bun FFI on debuggability and against gRPC on same-host overhead.
- **ADR-003** — Bridge payload encoding: MessagePack via `rmp-serde` on Rust and `msgpackr` on Bun (`useRecords: false`). Schema source of truth is Rust structs annotated with `ts-rs`; generated TS committed under `server/src/lib/schemas/bridge/generated/` and gated by `bridge:check` in CI. Backward-compat rule: new fields are `Option<T>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`; never rename, never remove.
- **ADR-004** — Worker supervision: Elysia-as-supervisor via `Bun.spawn`. Exponential backoff 250 ms -> 5 s with ±20 % jitter; 10-crashes-in-60-s circuit breaker. Cell-state recovery on restart accepts a brief sub-bar gap and re-enters from the next aggTrade; closed-bar history in Postgres is the durable source of truth.
- **ADR-005** — Persistence schema: vanilla PostgreSQL, `ticks` with native declarative monthly `PARTITION BY RANGE (ts_ms)` + 30-day retention + idempotent partition lifecycle (`ensureRollingPartitions(2)` + `dropTickPartitionsOlderThan(30)` daily at 03:00 UTC), `footprint_cells` plain table kept indefinitely. Tick write path is Elysia direct via batched `COPY ticks FROM STDIN`; cell writes are Rust-worker-on-bar-close.
- **ADR-006** — WebSocket frame contract: single endpoint `/ws/stream`, topic-multiplexed envelope, discriminated union over `kind`. Backpressure is drop-oldest + cell-delta coalescing as primary, 256 KB / 2 s per-client circuit breaker + `CloseEvent.code = 4290` as second-line. Codec is MessagePack via `msgpackr` on both ends (`useRecords: false`).

**Backend** (`tape-server`).

- Task 1.1 — Bun + Elysia scaffold, `GET /health` returning a Zod-validated `{ status, commit, ts, db, worker, ws, binance }` envelope.
- Task 1.2 — Drizzle ORM + postgres-js driver wired against PostgreSQL 17, `sessions` table, fail-fast `getDb()` for hot paths plus a tolerant `pingDb()` for the health probe.
- Task 1.2a — `ticks` (monthly-partitioned) + `footprint_cells` Drizzle schemas, partition-helper module (`ensureTickPartitionFor`, `ensureRollingPartitions`, `dropTickPartitionsOlderThan`), drizzle-zod-derived row schemas.
- Task 1.2b — Tick batch writer (500-row ring + 50 ms coalescing window + `COPY ticks FROM STDIN`), retention scheduler (bootstrap sweep + daily 03:00 UTC rearm), `/health.db.partitionCreateLagDays` and `tickBatchFlushCount` counters surfaced.
- Task 1.3 — Binance Futures aggTrade ingest: `BinanceFuturesClient` on Bun's native browser-spec WebSocket, `BinanceIngestor` glue (sessions row + tick persistence + WS broadcast + snapshot cache), Zod schema with `z.coerce.number()` on decimal-string fields, mutex with the in-process synthesizer. `/health.binance` surfaces `connected` / `lastTickTsMs` / `parseErrors` / `restartCount` / `sessionId`.
- Task 1.4a — Bridge transport scaffold: cross-platform path resolver, length-prefixed framing reader/writer on both Rust and Bun sides, `BridgeClient` five-state machine over `Bun.connect({ unix })`, `WorkerSupervisor` over `Bun.spawn` with the project-wide backoff curve and the 10-crashes-in-60-s circuit breaker. `/health.worker` surfaces `state` / `pid` / `restartCount` / `lastExitCode`.
- Task 1.4b — Bridge serialization tooling: `rmp-serde` on the Rust side, `msgpackr` on the Bun side, ts-rs codegen pipeline via `pnpm -F tape-server bridge:generate`, CI gate via `bridge:check`, three pnpm scripts (`bridge:generate` / `bridge:check` / `bridge:clean`).
- Task 1.5b — Bridge conformance test: bidirectional Rust <-> Bun frame round-trip against committed `.msgpack` byte oracles for six representative payload variants. Verifies the contract before Task 1.5 wires the real aggregator.
- Task 1.6a — Five WS Zod schema files under `src/lib/schemas/ws/` (tick, cell, snapshot, control, frame envelope), discriminated union enforcing the bar-close-vs-delta invariant at the schema layer, 23 tests / 34 expect calls covering positive/negative parses, the non-overlapping totals invariant, and envelope routing.
- Task 1.6b — WebSocket fan-out endpoint `/ws/stream`, msgpackr binary frames, snapshot-on-connect, drop-oldest backpressure, 256 KB / 2 s circuit breaker, `/health.ws` counters (`connectedClients`, `framesPerSecOut`, `droppedFrameCount`, `overrunDisconnectCount`, `snapshotCacheHitRate`).
- Deterministic in-process synthesizer (`WS_SYNTHESIZE=1`) at ~5 ticks/sec with one `cell.delta` per 500 ms and one `cell.close` per 60 s — drives offline UI work, CI, and screenshot capture.

**Frontend** (`tape-web`).

- Task 2.1 — Next 15.5 + React 19.2 + Tailwind v4.3 (CSS-first `@theme` block, OKLCH palette) + next-themes + TanStack Query + Zustand + Zod scaffold. Landing page polls `/health` with a calm `API offline` placeholder.
- Task 2.2 — Eden Treaty wired via a types-only re-export shim at `tape-server/src/app.ts`; cross-package contract experiment verified (renaming a server route surfaces as a typecheck failure at the web call site).
- Task 2.3 — Layout shell (`TopBar` / `SideRail` / `MobileRail` / `StatusBar`), three shadcn primitives (`Button`, `Tooltip`, `Separator`), Motion-driven rail width transition (220 ms easeOutCubic, single curve constant), Zustand persistence at `tape-ui-v1`, WCAG AA verified on every chrome surface.
- Task 2.4 — Replay control bar (Phase 2.4): play/pause, speed selector (1x / 5x / 30x), scrub handle, keyboard shortcuts. State surface only — the playback engine lands with the replay data source (deferred).
- Task 2.5 — Theme tokens consolidated, light/dark palette parity verified, `--color-fg-subtle` / `--color-fg-muted` / `--color-fg` contrast measured against every surface used.
- Task 2.6 — `WSStreamClient` + `useStreamStore` (ephemeral Zustand, 200-tick + 120-cell rings) + `WSStreamProvider` (dynamically imported so the ~14 KB msgpackr runtime lands in its own chunk). StatusBar reads `useConnectionState` / `useTickCount` / `useLastTick`.
- Task 3.1 — Canvas2D footprint chart core: layered painters (axes, cells, grid, right-edge tape strip), single rAF loop with subscribe-once contract, dirty-flag gating, theme-token bridge via `useSyncExternalStore` so the React shell never re-renders per frame.
- Task 3.2 — Cursor crosshair + cell tooltip + clickable Follow-live affordance (Phase 3.2 scope was reduced to UX layer; the CVD sub-pane originally planned in 3.2 was deferred to v1.1 per CRITIQUE-2026-05-31).

**Phase 4 review-cycle fixes** (post designer-critic + reviewer).

- `CellTooltip` USD price formatting normalized.
- `server/.env.example` extended to cover every consumed env var (BINANCE_WS_ENABLED, WORKER_PIPELINE_ENABLED, WS_SYNTHESIZE, BRIDGE_PATH, BRIDGE_WORKER_BIN, BRIDGE_WORKER_PROFILE, TAPE_COMMIT_SHA, ...) with the three-way mutex precedence inline-documented.
- Mobile chart collapse below 768 px: footprint chart hides, layout collapses to tape-only single column per PLAN.md success criterion.

### Known limitations (v1.0)

Surfaced honestly from `CRITIQUE-2026-05-31.md` — 18 defects from the designer-critic pass, tracked for v1.1. Three were already fixed and are listed under "Phase 4 review-cycle fixes" above (D-02, D-05 partial, plus the `CellTooltip` and env.example touch-ups); the remainder ships open.

**Blocker (1 remaining of 2 originally tagged).**

- **D-01** — Cursor crosshair horizontal stroke may collapse at the right edge of the viewport and may interact with the halo alpha in a way that makes the H line invisible at the intersection. Live re-verification + extension across the strip + axis (TradingView convention).

**High (8).**

- **D-03** — Cells render as a single mixed-OKLCH `fillRect` per cell. The promised intra-cell bid/ask horizontal histogram is absent — the literal "footprint" signal is collapsed to a heatmap. ~30 lines of painter code, no engine API change.
- **D-04** — CVD sub-pane absent. Phase 3.2 was silently rescoped from "CVD Canvas2D sub-pane sharing the rAF loop" to "cursor + tooltip + Follow-live"; the CVD pane is half of the product identity and must land.
- **D-05** — `--color-fg-subtle` on `--color-bg` is 5.5:1 — passes AA but reads as illegible grey-on-grey on the StatusBar labels. Lift the token or switch `StatusCell` `<dt>` to `--color-fg-muted` (8:1, already in the palette).
- **D-06** — Cell text overflows the 24 px cell width at labels like `1.2K` (~24 px wide at 10 px JetBrains Mono). Widen `cellWidth` to 28 px or clip text to cell bounds.
- **D-07** — Y-axis price labels are bare integers (`71210`) with no `$` prefix, no decimal alignment, `textAlign: 'left'`. Recruiter-who-is-not-a-trader reads it as "numbers", not "price".
- **D-08** — Theme toggle is text-only (`theme: system` chip), no icons, no Motion crossfade between surfaces despite PLAN.md committing the crossfade in the animation stack. Replace with a `shadcn ToggleGroup` of `Sun` / `Laptop` / `Moon` icons; wrap the surface root in a 180 ms opacity-bridge gated by `useReducedMotion()`.
- **D-09** — Tape "ticker" is a static redraw, not a stream. No per-tick entry motion. Add a 1-frame translate-up tween (Y offset -> 0 over 1 rAF) so the eye registers arrival.
- **D-10** — Follow-live pill fades in (opacity 0 -> 1, 180 ms) with no translate, so on a small surface the appearance does not register. Add `initial={{ y: -4 }}`; consider repositioning closer to the bar grid's right edge.

**Medium (6).**

- **D-11** — Cold-load empty state: no skeleton, no "warming up" message. First impression reads as "broken".
- **D-12** — Replay bar height transition is smooth (220 ms easeOutCubic) but inner controls pop in via conditional render the same frame. Stagger the contents ~120 ms after the height transition begins.
- **D-13** — Scroll smoothing uses fixed 0.2 linear interpolation per frame + 0.5 px settle snap — visible last-frame jump. Replace with a Motion `spring` config.
- **D-14** — Five surfaces share the cyan hue 195 accent: brand mark, symbol icon, live pip, cursor crosshair, focus ring. No hue hierarchy. Reserve `--color-accent` for one role; introduce `--color-accent-data` at hue 210.
- **D-15** — `--color-ask` light mode is `oklch(0.55 0.2 28)` on `oklch(0.985 0.005 100)` — 3.8:1, **fails WCAG AA** for normal text. Used in the tape strip and tooltip "Ask vol" line in light mode. Drop to L 0.48 or below.
- **D-16** — `CellTooltip` `visibility: hidden` toggles synchronously with `opacity: 0` — the 120 ms fade-out is dead code. Move the visibility flip behind `transition-delay: 120ms` or drop it entirely.

**Low (2).**

- **D-17** — MobileRail overlay and panel transitions run in parallel; the Linear/Vercel sheet pattern staggers the overlay ~40 ms ahead.
- **D-18** — Brand mark "Tape" at `text-base font-medium` competes visually with the `BTCUSDT-PERP` data pill. Lift to `text-lg font-semibold` or swap to a tightened Inter Display cut.

**Out of scope for v1.0, also not in the v1.1 backlog (deferred per PLAN.md).**

- Historic replay engine (Task 1.7) — scrubber UI ships, data wiring does not.
- User accounts and saved layouts (`better-auth` is scaffolded but inactive; v2 reactivation path).
- Per-IP rate limit on the public WebSocket — to land at deploy time alongside CSP headers and the production observability story.
- Multi-symbol (ETH-PERP, SOL-PERP) — v2, gated on commercial-seed signal.
- CME futures (NQ / ES) — v2 pivot only if commercial validation succeeds.
- Multi-exchange (Bybit, OKX) — v2.

---

[Unreleased]: https://github.com/AntczakJ/portfolio/compare/tape-v0.1.0...HEAD
[0.1.0]: https://github.com/AntczakJ/portfolio/compare/tape-v0.0.1...tape-v0.1.0
[0.0.1]: https://github.com/AntczakJ/portfolio/releases/tag/tape-v0.0.1
