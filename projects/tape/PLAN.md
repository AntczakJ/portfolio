# tape — PLAN

> Real-time orderflow visualizer for crypto perpetual futures.
> Brand display: **Tape**. Repo dir: `tape`.

## Problem

Retail and prop crypto-perp traders pay $30–70/month for hosted orderflow tooling (Coinalyze, TensorCharts) or accept the feature gaps of free alternatives (Aggr.trade). The market has revealed willingness to pay for tape, footprint, CVD and imbalance — but most products feel like 2018-era Flash dashboards bolted onto modern data. There is room for a product-grade, sub-2s-to-interactive, 60 fps tape that takes the live Binance Futures feed seriously as an engineering problem instead of an integration footnote.

For this portfolio, `tape` doubles as the **commercial-seed showcase**: a recruiter visiting the demo URL sees production-grade real-time architecture (long-lived WebSocket fan-out, Rust hot-path aggregation, Canvas2D rendering under load), not creative-dev work. The same artifact is the wedge for an eventual paid v2 if the demo URL converts.

## Audience

Two viewer groups, optimised in this order:

1. **Retail / prop crypto-perp traders** on BTC, ETH, SOL Binance Futures. Desktop primary (1440px+ chart real estate), mobile secondary (320px+ tape-only fallback). They land from a Twitter share, a r/algotrading post, or a recruiter forward, recognise the footprint chart layout in under three seconds, and start scrubbing within ten.
2. **Senior backend / staff-level recruiters** reviewing Jan's portfolio. They open the demo URL on a desktop monitor, open DevTools to see the WebSocket frames, check Lighthouse, and look at the GitHub repo for the Rust↔Bun bridge.

Pivot path: CME futures (NQ/ES) in v2 if commercial signal validates the wedge, leveraging the owner's existing NQ/XAU/BTC strategy domain knowledge.

## Wow moment

**Canvas2D-rendered footprint chart streaming LIVE BTC-PERP tick data via Binance Futures WebSocket, redrawing at 60 fps under thousands of trades/sec with no layout thrash.**

Concretely, on first paint:

- The viewer sees a footprint chart of the last ~30 minutes of BTCUSDT perpetuals, bid/ask volume per price cell rendered as horizontal histograms inside each bar, delta number bottom-right of each bar, CVD line overlaid in a sub-pane.
- A live trade ticker animates in from the right at real speed — every visible trade is a real trade that just happened on Binance Futures.
- Hovering a price cell reveals aggregated bid volume / ask volume / delta / imbalance percentage for that cell across the bar window.
- Hitting the replay button rewinds to 00:00 UTC of the current day and scrubs forward at 1×, 5×, or 30× — at 30×, a full 24h session completes in under five seconds, footprint cells materialising in real time.

The chart itself is Canvas2D (not Motion, not SVG). Motion handles the chrome — replay control transitions, theme switching, panel mount animations.

## Stack flavour

**`api-heavy`.**

Justification against `docs/conventions.md` § 10 (three independent triggers fire):

- **WebSocket trigger.** Two long-lived bidirectional streams are core to the product: (a) upstream from Binance Futures (`<symbol>@aggTrade`, `<symbol>@depth20@100ms`, `<symbol>@bookTicker` on `wss://fstream.binance.com`), (b) downstream from our server to each browser client. Next route handlers cannot host the persistent fan-out connection — a dedicated long-lived backend process is required.
- **Background work trigger.** A continuous ingestion + footprint aggregation worker runs even when no client is connected, so replay history accumulates. This is a stateful background process, not a request-response handler.
- **Heavy domain logic trigger.** CVD, footprint cell aggregation, bid/ask imbalance, delta divergence — these are tested in isolation from the UI. The aggregation logic has correctness invariants (CVD monotonicity within a bar, bid+ask = total volume per cell) that warrant unit tests divorced from rendering.

`web-only` is rejected because none of the above survives the Next-only model.

## Backend choice — Elysia on Bun

**Selected: Elysia 1.x on Bun 1.x.** Rationale serves the two masters from `docs/conventions.md` § 11:

(a) **Fits this project.** Bun's HTTP and WebSocket implementations are first-class and benchmark fastest in the 2026 cohort (independent benchmarks: Elysia ~397K req/s vs Hono ~253K on identical Bun runtime; under WebSocket load, Bun's `ServerWebSocket` outperforms Node's `ws` library by ~3× on broadcast fan-out). End-to-end TypeScript inference via Eden Treaty eliminates an entire class of contract bugs between the Elysia server and the Next.js client — relevant because the WebSocket frame schemas (trade tick, footprint cell update, replay control) are non-trivial. Bun's native `Bun.spawn` and FFI surfaces make the Rust hot-path bridge (see "plus" below) less ceremonial than the equivalent Node `child_process` / `node-ffi-napi` path.

(b) **Advances portfolio variance.** This project claims the **"cutting-edge 2026 backend"** slot. Pre-cleared with owner: the remaining api-heavy projects in the planned 5–7 portfolio mix are slated for Hono (project 2, local-first editor) and NestJS (project 3, AI agentic tool). So `tape` picking Elysia does not pressure backend variance — it establishes it. The composition tracker after slot 1 reads: `Elysia` covered; `Hono` + `NestJS` planned; `Fastify` remains available as a future option.

**Plus: Rust hot-path worker** for footprint cell aggregation and CVD rollups. Architecture mirrors NautilusTrader (Rust event-driven core + TS/Python control plane). The exact integration mechanism — Unix socket, shared Postgres queue, Bun FFI bridge, or stdin/stdout newline-delimited JSON — is **deferred to ADR-002**, to be authored by the `architect` subagent at the start of the implement phase. ADR-001 deliberately does not pin this to avoid premature lock-in before the architect has prototyped the alternatives.

## Animation stack

**Motion (ex-Framer Motion)** as the single animation library, per `docs/conventions.md` § 15.

Scoped to:

- Replay control bar (play/pause/speed transitions, scrub handle).
- Theme toggle (light/dark crossfade respecting `prefers-reduced-motion`).
- Panel mount/unmount animations (footprint chart pane, tape pane, CVD sub-pane).
- Tooltip and cursor-readout fade-ins on hover.

**Not** used for:

- The footprint chart itself (Canvas2D `requestAnimationFrame` loop, no Motion involvement).
- The CVD line (Canvas2D, same rAF loop as the footprint).
- The live tape ticker rows (CSS `transform` translateY with `will-change`, hand-rolled to avoid Motion's reconciliation overhead at >10 row updates/sec).

GSAP and R3F are rejected: no scroll-driven timeline, no SVG choreography, no 3D content.

## Success criteria

All measurable, all gate v1 ship:

- **Live throughput.** Footprint + tape rendering sustains ≥ 60 fps under 200 trades/sec on a 2020-era laptop (Chrome, mid-tier integrated GPU). Measured via Chrome DevTools Performance panel, frame budget ≤ 16.6ms 99th percentile across a 60s recording.
- **Replay speed.** Full 24h BTC-PERP session scrubs through in < 5 s at 30× speed, materialising all footprint cells without dropped ticks.
- **Cold load.** Time-to-interactive < 2 s desktop, < 4 s mobile (mid-tier Android, throttled 4G). Measured via Lighthouse + WebPageTest median of 5 runs.
- **Stability.** Demo URL serves uninterrupted for 7 consecutive days with no manual restart, no memory leak (RSS growth < 50MB over 24h continuous ingest).
- **Lighthouse.** Performance / Accessibility / Best Practices / SEO each ≥ 95 on the production demo URL.
- **Responsive.** Renders correctly from 320px upward. Below 768px breakpoint, footprint chart hides and the layout collapses to tape-only single column.
- **Theming.** Light + dark via CSS variables + `next-themes`, respecting `prefers-color-scheme`. Footprint chart cell colors theme-aware (bid green / ask red shift hue per theme to maintain WCAG AA contrast on respective backgrounds).
- **Accessibility.** WCAG 2.2 AA. Full keyboard navigation of replay controls and symbol picker. `prefers-reduced-motion` disables Motion transitions and freezes the tape ticker animation. Footprint chart hover values mirrored to a live `aria-live="polite"` readout for screen readers.

## Tasks

Ordered, granular, each with size estimate and responsible subagent. The implement phase starts after ADR-002 (Rust bridge) is authored.

### Phase 0 — Architecture lock-in

| # | Task | Size | Subagent |
|---|---|---|---|
| 0.1 | Author ADR-002: Rust hot-path worker ↔ Elysia control plane bridge mechanism (Unix socket vs Bun FFI vs stdin/stdout JSON vs shared Postgres queue). Decision must consider: latency budget (cell update propagation < 5ms), Windows dev parity (owner machine), deployment target footprint. | M | architect |
| 0.2 | Author ADR-003: Persistence schema for footprint cells and aggTrade archive (per-second buckets vs per-trade rows; partitioning strategy for the daily replay query). | M | architect |
| 0.3 | Author ADR-004: WebSocket frame contract (Zod schema shared `src/lib/schemas/`) for trade tick, footprint-cell-update, CVD-update, replay-control messages between Elysia server and Next.js client. | S | architect |

### Phase 1 — Backend skeleton

| # | Task | Size | Subagent |
|---|---|---|---|
| 1.1 | Bun + Elysia project scaffold under `projects/tape/server/`. Bun version pin via `.bun-version`. ESLint flat config, Prettier, TypeScript strict per `docs/conventions.md` § 1. | S | backend-engineer |
| 1.2 | Drizzle ORM + Postgres setup. Migrations folder, dev `docker-compose.yml` with local Postgres on a non-conflicting port (avoid 5432/5434 clashes — owner has Mila on 5434, see user memory). | S | backend-engineer |
| 1.3 | Binance Futures WebSocket ingestion client: connect to `<symbol>@aggTrade`, reconnect-with-backoff, heartbeat handling, gap detection via `lastTradeId`. Unit-tested against recorded frames. | M | backend-engineer |
| 1.4 | Footprint cell aggregator (TypeScript reference impl in Bun, to be ported to Rust per ADR-002). Bid/ask split per price cell per bar, delta, CVD rollup. Unit tests assert invariants (bid+ask = total volume; CVD monotone within bar except on reversal). | M | backend-engineer |
| 1.5 | Rust hot-path worker per ADR-002. Cell aggregation reimplementation, bridge wiring, conformance tests vs TypeScript reference impl on a recorded 1h tick dataset. | L | backend-engineer |
| 1.6 | Server WebSocket endpoint `/ws/stream/:symbol` — broadcasts trade ticks, cell updates, CVD updates to subscribed clients. Backpressure handling (drop oldest, never block). Rate limit per IP. | M | backend-engineer |
| 1.7 | Historic replay endpoint: `GET /api/replay/:symbol/:date` returns chunked NDJSON of aggregated cells for the requested UTC day. Sourced from data.binance.vision archive, cached locally on first request. | M | backend-engineer |
| 1.8 | better-auth scaffolding committed but unused — session-less public demo in v1. Document the wiring in `AGENT_NOTES.md` as "ready for v2 saved layouts / alerts". | S | backend-engineer |

### Phase 2 — Frontend skeleton

| # | Task | Size | Subagent |
|---|---|---|---|
| 2.1 | Next.js 15 + React 19 + Tailwind v4 + shadcn/ui scaffold under `projects/tape/web/`. Theme provider via `next-themes`. CSS variables in `app/globals.css` per `docs/conventions.md` § 4. | S | frontend-engineer |
| 2.2 | Eden Treaty client setup pointing at the Elysia server. End-to-end type inference verified by deliberately breaking a server schema and confirming the client type error surfaces. | S | frontend-engineer |
| 2.3 | Layout shell: header (symbol picker placeholder — BTCUSDT only in v1), main chart pane, side tape pane, footer status bar. Mobile-first, breakpoint at 768px collapses to tape-only. | M | frontend-engineer |
| 2.4 | Replay control bar with Motion transitions: play/pause/stop, speed selector (1×/5×/30×), scrub handle with current timestamp readout, keyboard shortcuts (Space, arrow keys). `prefers-reduced-motion` disables Motion. | M | frontend-engineer |
| 2.5 | Light + dark theme tokens in `app/globals.css`. Footprint chart cell colors (bid / ask / delta-positive / delta-negative) defined as CSS variables; readable by the Canvas2D layer via `getComputedStyle` on mount and theme change. WCAG AA contrast verified per token. | M | frontend-engineer |

### Phase 3 — Wow moment

| # | Task | Size | Subagent |
|---|---|---|---|
| 3.1 | Canvas2D footprint chart renderer: layered architecture (background grid, cells, delta numbers, axes). Single rAF loop. No layout thrash — all DOM measurement cached on resize. 60 fps target enforced by FPS counter in dev mode. | L | frontend-engineer |
| 3.2 | Canvas2D CVD line sub-pane, sharing the same rAF loop as the footprint. Synced X-axis with the footprint chart. | M | frontend-engineer |
| 3.3 | Live tape ticker (CSS `transform translateY`, virtualized to last 100 visible trades). Bid/ask color coding. Click-to-pin behaviour. | M | frontend-engineer |
| 3.4 | WebSocket client wiring with reconnect-and-replay-from-gap logic. Zustand store for trade stream + cell cache. TanStack Query reserved for historic replay HTTP fetches. | M | frontend-engineer |
| 3.5 | Cursor crosshair + per-cell readout panel (aggregated bid / ask / delta / imbalance% for the hovered cell). `aria-live="polite"` mirror for screen readers. | M | frontend-engineer |
| 3.6 | Replay mode: switch the data source from live WebSocket to the NDJSON historic endpoint, drive the rAF loop from a virtual clock at the selected speed. | M | frontend-engineer |

### Phase 4 — Review

| # | Task | Size | Subagent |
|---|---|---|---|
| 4.1 | UI milestone review against `docs/inspirations.md` references. Designer-critic produces concrete defect list; frontend-engineer applies. Zero pochwał. | M | designer-critic |
| 4.2 | Code review of server + Rust bridge + WebSocket fan-out. Focus on correctness invariants and the backpressure path. | M | reviewer |

### Phase 5 — Tests

| # | Task | Size | Subagent |
|---|---|---|---|
| 5.1 | Vitest unit suite for the TypeScript footprint aggregator (reference impl) — invariants, edge cases (gap, duplicate, out-of-order tick). | M | test-engineer |
| 5.2 | Conformance test: TypeScript reference aggregator vs Rust hot-path worker, identical output on a recorded 1h dataset. | M | test-engineer |
| 5.3 | Playwright E2E: live mode loads, footprint renders, replay control opens, scrub moves chart, theme toggle works, keyboard nav reaches all interactive elements. | M | test-engineer |
| 5.4 | Lighthouse CI workflow asserting ≥ 95 across categories on the deployed demo. | S | test-engineer |
| 5.5 | Load test: synthetic 200 trades/sec injected client-side, assert frame budget ≤ 16.6ms 99th percentile. | M | test-engineer |

### Phase 6 — Docs

| # | Task | Size | Subagent |
|---|---|---|---|
| 6.1 | `README.md` — pitch, stack, run instructions, demo URL, screenshots / GIF of the wow moment, key decisions. | M | doc-writer |
| 6.2 | `CHANGELOG.md` initialised, Keep a Changelog format. | S | doc-writer |
| 6.3 | Architecture diagram (Mermaid in README) showing Binance Futures → Elysia ingestion → Rust worker → Postgres → WebSocket fan-out → Next client. | S | doc-writer |

## Out of scope (v1)

Locked. v2 candidates only if commercial signal validates after the demo URL accumulates 100 real visitor signups.

- Multi-symbol — ETH-PERP, SOL-PERP defer to v2.
- User accounts, saved layouts, alerts — `better-auth` scaffolded but inactive.
- Mobile native gestures (pinch-zoom, two-finger scrub) — mobile gets tape-only fallback below 768px.
- CME futures pivot (NQ/ES) — only if commercial-seed thesis validates.
- Multi-exchange (Bybit, OKX) — single-exchange ingestion v1.
- DOM heatmap, volume profile, order book depth visualisation beyond bid/ask color in the footprint cells.
- Programmatic alert engine — no Pine-equivalent in v1.
