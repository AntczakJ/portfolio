# meld — PLAN

> Local-first collaborative whiteboard with Yjs CRDTs and Hono backend.
> Brand display: **Meld**. Repo dir: `meld`.

## Problem

Collaborative whiteboards (Figma, Miro, Excalidraw multiplayer, tldraw) have proven the product surface, but most of the conflict-resolution and offline story is opaque to a viewer — the magic is buried under accounts, paywalls, and "join a workspace" friction. A senior backend / fullstack recruiter clicking a portfolio demo does not get to *see* CRDT correctness; they get to see a Google-Docs-style cursor and have to take it on faith.

For this portfolio, `meld` is the **local-first / CRDT showcase**. The 2026 signal is specific: FOSDEM 2026 ran a dedicated local-first dev-room, nine competing CRDT stacks are in active rotation (Yjs, Automerge, Loro, Jazz, ElectricSQL, Diamond Types, Y-Sweet, BlockNote sync, Hocuspocus), and picking a SPECIFIC stack on a SPECIFIC domain reads as deliberate architectural positioning vs the generic "real-time collaboration" pitch every fullstack portfolio claims. `meld` is a pure-showcase slot — tape already holds the commercial-seed slot in the portfolio plan, so meld is unburdened by monetisation framing and free to maximise the architectural-signal axis.

## Audience

One viewer group, optimised for one path:

**Senior backend / fullstack recruiters (US / EU)** clicking the demo URL from a HN thread, a Reddit r/programming post, a Twitter / X tech-thread share, or a recruiter forward. They land on a desktop monitor (1440 px+ typical, 1920 px+ common), open DevTools out of habit to inspect the WebSocket frames, and want to see — in the first 10 seconds — proof that the CRDT story works without reading the README first. The wow moment delivers that proof visually before they read a single word of copy.

Secondary path: mobile share recipients (320 px+). v1 collapses to **view-only** below 768 px — full edit requires ≥ 768 px and a pointer. The mobile recipient still sees the live cursors of desktop collaborators moving in real time, which is enough wow on a phone screen.

## Wow moment

**Two browser tabs open the same shared board URL. Tab A draws a rectangle. Tab B's user-color cursor floats over the new shape with sub-100 ms perceptible lag, and the rectangle is mirrored conflict-free. Disconnect tab A in DevTools (offline mode), keep drawing in tab A. Reconnect → Yjs auto-merges, no visible conflict, no loss.**

Concretely, on first paint:

- The viewer opens `/board/<base32-random-12>` in one tab. A randomly assigned emoji-name (e.g., "Otter") and OKLCH-distinct user color are visible in the top-right corner.
- "Open second tab" affordance is one click on the share button — it opens the same board URL in a new tab with a different assigned identity.
- Both viewports show each other's cursor as a smooth ~120 ms-interpolated floating dot in distinct OKLCH color, with a name pill anchored below the dot.
- Type your name in the corner input — the other tab sees the name pill update via Yjs awareness within a frame (~16 ms).
- Draw a rectangle in tab A — tab B sees it materialise with no perceptible lag (target < 100 ms perceived end-to-end).
- Hit DevTools → Network → Offline in tab A. Draw three more shapes. Tab B stops receiving updates (cursor of tab A is shown as a "ghost" — desaturated, dotted outline).
- Hit Online. Within ~200 ms, tab B's view reconciles to tab A's full set of shapes. No popup, no merge dialog, no manual conflict resolution — Yjs guarantees deterministic merge and the UI just *is* correct after reconnect.

The drawing canvas itself is **raw Canvas2D** — Motion does NOT drive per-frame paint of shapes, only React-shell chrome (presence cursor in-out, avatar stack, shape select / deselect transitions on the React side).

## Stack flavour

**`api-heavy`.**

Justification against `docs/conventions.md` § 10 (three independent triggers fire):

- **WebSocket trigger.** The y-websocket protocol is a long-lived bidirectional WebSocket: each board client maintains a persistent connection over which Yjs sync messages and awareness frames flow in both directions for the lifetime of the session. Next route handlers cannot host the per-board fan-out room — a dedicated long-lived backend process with in-memory room state is required.
- **Background work trigger.** A debounced Yjs snapshot persistence worker writes the board's encoded document state to Postgres on the trigger boundary (every ~5 s of board idle OR every 100 ops, whichever fires first). A snapshot-chain compaction sweep runs as a background loop. Both are stateful background processes, not request-response handlers.
- **Heavy domain logic trigger.** CRDT merge invariants (commutativity of concurrent shape inserts, associativity of awareness-state merges, ordering of update encoding under causal histories), snapshot chunking (how to split a large `Y.Doc` update binary across multiple bytea rows for replay-after-compaction), and awareness fan-out per room with per-client send-queue bounds — these benefit from being tested in isolation from the React UI.

`web-only` is rejected because none of these three survives the Next-only model.

## Backend choice — Hono on Node

**Selected: Hono 4.x on Node 22 LTS for v1; multi-runtime story (Bun + Deno + CF Workers + Vercel Edge) carried in the README + DEPLOY notes as the v2 migration path.**

Rationale serves the two masters from `docs/conventions.md` § 11:

(a) **Fits this project.** Hono's `serve()` + `@hono/node-server` is the most mature production Node target for Hono in 2026 — and Node 22 is also the runtime the `y-websocket-server` reference implementation (the canonical Yjs server adapter from the Yjs core team) is documented against, which short-circuits a class of "did Bun's WebSocket helper preserve the y-protocol byte-for-byte" debugging. Hono's WebSocket helper (`@hono/node-ws`) handles the HTTP upgrade and gives us a typed RouteHandler returning a `WSContext` we can connect straight into the y-websocket-server's `setupWSConnection(conn, request, opts)` per-room handler. Typed RPC via `@hono/zod-validator` pairs cleanly with Zod schemas shared between frontend and backend per `docs/conventions.md` § 5 — the HTTP control surface (anonymous session creation, board metadata, snapshot trigger) is fully type-inferred on the client side via Hono RPC's `hc<AppType>` client.

(b) **Advances portfolio variance.** This is the load-bearing axis for this project. Tape (slot 1) committed Elysia on Bun — Bun-native, max-throughput, edge-of-2026 backend. Meld (slot 2) commits Hono on Node — multi-runtime, edge-ready, edge-of-2026 backend with a different design philosophy. The variance is between TWO distinct cutting-edge 2026 frameworks across two `api-heavy` slots, exactly the variance ADR portfolio policy (§ 12) mandates. Hono's multi-runtime story is the explicit 2026 senior-signal — the same source code can target Node, Bun, Deno, CF Workers, and Vercel Edge, which means the v2 migration to CF Workers Durable Objects (one DO per board = horizontal scale-out, sub-50 ms global edge) is a deploy-config change, not a rewrite. We frame this in README and DEPLOY explicitly so a recruiter clicks through the v2 path without us having to ship it.

(c) **Runtime pick for v1: Node 22.** The Yjs ecosystem's canonical server adapter (`y-websocket-server`) targets Node first. Bun has growing y-websocket compatibility but the wire-protocol verification surface is smaller. Picking Node 22 for v1 maximises the chance the y-protocol handshake "just works" with `setupWSConnection` and lets us spend the engineering budget on the persistence + presence + offline-merge demo paths, not on adapter debugging. The architect will ratify the WebSocket adapter choice in ADR-002.

(d) **v2 migration target: CF Workers Durable Objects.** One Durable Object per board = horizontal scale-out, global edge, sub-50 ms p99 latency for presence cursors. The Yjs document binary is small (~10–100 KB for a typical session) and the DO storage API is purpose-built for "one document, one process, eventual snapshot to durable storage" — exactly the shape Yjs wants. NOT shipped in v1; documented in DEPLOY.md as the v2 path.

## CRDT stack — Yjs

**Selected: Yjs 13.x + y-websocket protocol + y-protocols/awareness for ephemeral state.**

Why Yjs over the 2026 competitive set:

- **Automerge** — strong Rust-derived CRDT, but text + drawing primitives both go through the same `Doc` abstraction and the JS / WASM bundle is heavier. Smaller ecosystem for whiteboard-specific patterns. Rejected on ecosystem-narrative grounds.
- **Loro** — newer, Rust-derived, claims faster delta size for text-heavy workloads. Smaller wire-format wins at the byte level but tooling and reference adapters are less mature; no first-class y-websocket-equivalent reference server. Rejected on maturity grounds for a 2-week project.
- **Jazz** — collab framework on top of CRDTs, not a raw CRDT lib. Higher level than what we want to demonstrate — meld is supposed to *show* the CRDT, not hide it behind a framework. Rejected on architectural-signal grounds.
- **ElectricSQL** — Postgres-replication-based, "local-first" in a different sense (sync the rows, not the ops). Wrong shape for an in-memory whiteboard with high-frequency ephemeral state. Rejected on workload-fit grounds.
- **Diamond Types** — research-grade, fast text CRDT. Text-only — no drawing primitives. Rejected on scope-fit grounds.

Why Yjs wins:

- **Text + drawing primitives both first-class** via `Y.Map`, `Y.Array`, `Y.Text` — shapes are `Y.Map` entries inside a top-level `Y.Array<Y.Map>`; text labels are `Y.Text`; freehand line points are `Y.Array<number>`.
- **`y-protocols/awareness` gives presence + cursors out of the box** — ephemeral state (cursor position, selection, name, color) is namespaced separately from document state and never persisted, exactly the shape the wow moment needs.
- **Largest production ecosystem in 2026** — BlockNote, Tldraw, Hocuspocus, Liveblocks Yjs adapter, JupyterLab RTC all build on Yjs. Picking Yjs reads as "production-ready CRDT" not "research toy".
- **Smallest CRDT wire format** among the contenders — Yjs's binary update encoding (Lib0 varint + structural delta) is 30–60% smaller than Automerge's equivalent on a typical whiteboard session, which directly affects presence-frame latency on slow networks.
- **`docs/inspirations.md` deep-research finding alignment** — picking a SPECIFIC stack (vs generic "real-time") is the architectural signal that distinguishes a senior portfolio pick. Yjs is the most defensible specific pick in 2026.

## Animation stack

**Motion (ex-Framer Motion)** as the single animation library, per `docs/conventions.md` § 15.

Scoped to React-shell chrome:

- **Presence cursor interpolation** — the floating dot's position lerps to the latest awareness-broadcast position over ~120 ms (matches Figma's perceptual feel). Implemented as a `<motion.div style={{ x, y }}>` driven by a per-tick `animate` value, NOT a raw `requestAnimationFrame` loop, because the cursor is React-shell not Canvas2D.
- **Awareness avatar stack** — top-right corner shows up to 5 connected user avatars as colored pills; new users animate in via Motion's `AnimatePresence` with a 200 ms `ease-out` enter and 150 ms exit.
- **Shape select / deselect transitions** — the React-rendered selection bounding box + handle dots fade + scale on select via Motion. The shape itself on the Canvas2D layer does NOT animate — only the React-rendered selection chrome on top of it.
- **Toolbar / palette mount-unmount** — shadcn `Dialog` / `Popover` / `Command` palette transitions use Motion's defaults (which shadcn already wires).
- **Theme toggle** — light / dark crossfade respecting `prefers-reduced-motion`.

**Not** used for:

- The Canvas2D drawing surface itself (raw `requestAnimationFrame` loop, no Motion involvement on a per-frame basis).
- Per-shape redraw on Yjs document updates (Yjs observer → state setter → React re-render → Canvas2D draw call, no Motion).
- Cursor color assignment (deterministic OKLCH from session id hash, no animation).

GSAP and R3F are rejected: no scroll-driven timeline, no SVG choreography, no 3D content. shadcn / Motion is the entire animation surface.

## Success criteria

All measurable, all gate v1 ship:

- **Two-tab presence demo.** End-to-end perceptible latency for cursor movement and shape mirror < 200 ms p99 on a typical desktop on the deployed demo URL (localhost dev expected ~30–50 ms).
- **Shape merge under simultaneous edits.** Conflict-free and deterministic. Reviewer-checked: open two tabs, draw concurrent overlapping rectangles in both, assert both shapes survive and the document state is identical in both tabs after sync.
- **Offline edit + reconnect.** No data loss in a 30-tab tab-rotate stress test (open 30 tabs, each draws 10 shapes offline, reconnect all 30, assert final state contains all 300 shapes).
- **Cold load.** Time-to-interactive < 2 s on desktop, < 4 s on mobile (mid-tier Android, throttled 4G). Measured via Lighthouse + WebPageTest median of 5 runs.
- **Deployment stability.** Demo URL serves uninterrupted for 7 consecutive days with no manual restart, no memory leak (RSS growth < 50 MB over 24 h with 5 boards each holding 100 ops).
- **Lighthouse.** Performance / Accessibility / Best Practices / SEO each ≥ 95 on the production demo URL.
- **Responsive.** Renders correctly from 320 px upward. Below 768 px the canvas drops to view-only (full edit requires ≥ 768 px and a pointer per the spec). Cursor presence still works on mobile view-only.
- **Theming.** Light + dark via CSS variables + `next-themes`, respecting `prefers-color-scheme`. Sovereign OKLCH palette — Meld is a fresh visual identity, no token reuse from tape per `docs/conventions.md` § 14.
- **Accessibility.** WCAG 2.2 AA. Full keyboard navigation of the toolbar and command palette. `prefers-reduced-motion` disables Motion transitions on cursor smoothing and on avatar stack enter / exit. Selected shape's geometry is mirrored to an `aria-live="polite"` readout for screen readers.

## Tasks

Ordered, granular, each with size estimate and responsible subagent. The implement phase starts after ADR-002 (Hono WebSocket adapter) and ADR-003 (Yjs snapshot persistence strategy) are authored by the architect.

### Phase 0 — Architecture lock-in

| # | Task | Size | Subagent |
|---|---|---|---|
| 0.1 | Author ADR-002: Hono WebSocket adapter choice — `@hono/node-ws` vs hand-rolled `ws`-on-Node upgrade vs other adapter — and the integration shape with `y-websocket-server`'s `setupWSConnection`. Decision must consider: y-protocol byte-for-byte preservation, per-room broadcast fan-out, reconnect / resume semantics, Windows dev parity. | M | architect |
| 0.2 | Author ADR-003: Yjs snapshot persistence strategy — debounce trigger boundary (5 s idle OR 100 ops, ratify or revise), snapshot encoding (`Y.encodeStateAsUpdate` full state vs incremental updates list vs hybrid), bytea chunking strategy for large boards (> 1 MB), snapshot-chain compaction sweep cadence, replay-after-compaction correctness. | M | architect |
| 0.3 | Author ADR-004: WebSocket frame contract for non-Yjs control messages (welcome frame with assigned session id + emoji-name + OKLCH color, board-room metadata, overrun control frames). Yjs sync + awareness frames pass through unchanged per the y-websocket protocol. Zod schemas in `src/lib/schemas/ws/` shared frontend / backend. | S | architect |

### Phase 1 — Backend skeleton

| # | Task | Size | Subagent |
|---|---|---|---|
| 1.1 | Node 22 + Hono scaffold under `projects/meld/server/`. `package.json` named `meld-server`, ESLint flat config, Prettier, TypeScript strict per `docs/conventions.md` § 1. `.nvmrc` pinning Node 22. `GET /health` endpoint returning `{ status, commit, ts }` via Hono RPC + Zod-validated response schema. | S | backend-engineer |
| 1.2 | Drizzle ORM + Postgres setup. Migrations folder, dev `docker-compose.yml` with local Postgres on a non-conflicting port (avoid 5432 / 5434 Mila / 5435 tape clashes — pick 5436 or higher). Schema barrel under `src/db/schema/`. Initial table: `boards` (id text PK base32-random-12, created_at timestamptz, last_active_at timestamptz). | S | backend-engineer |
| 1.3 | Yjs snapshot persistence table + write path. `board_snapshots` table per ADR-003 (board_id FK, sequence int, payload bytea, created_at). Debounced snapshot writer (5 s idle OR 100 ops, ratified by ADR-003) that calls `Y.encodeStateAsUpdate(doc)` on the per-room `Y.Doc` and writes the bytea row. Snapshot loader on room boot. Unit-tested with synthetic op streams. | M | backend-engineer |
| 1.4 | Hono WebSocket adapter wired per ADR-002. `/ws/board/:boardId` route upgrades the HTTP connection and hands off to `setupWSConnection(conn, request, { docName: boardId })` from `y-websocket-server`. Per-room `Y.Doc` lifecycle (create on first connect, persist to Postgres on debounce, evict from memory after N minutes idle, reload from snapshot on next connect). | M | backend-engineer |
| 1.5 | Snapshot-chain compaction background sweep per ADR-003. Periodic (e.g., hourly cron) job that reads the chain of incremental updates for a board, computes a merged snapshot, writes it as a new row with `is_compaction = true`, and atomically marks the older rows superseded. Conformance test asserts the merged snapshot replays identically to the chain it replaces. | M | backend-engineer |
| 1.6 | `POST /api/boards` endpoint creating a new board with a base32-random-12 id, returning `{ boardId, shareUrl }`. Hono RPC + Zod-validated request / response. Rate-limited per IP. | S | backend-engineer |
| 1.7 | better-auth scaffolding committed but unused — anonymous session cookie identifies a user across reloads, assigns a deterministic emoji-name + OKLCH color per session. Documented in `AGENT_NOTES.md` as "wired but not activated" so v2 (saved boards per account, board ownership, paid tier) plugs in cleanly. | S | backend-engineer |

### Phase 2 — Frontend skeleton

| # | Task | Size | Subagent |
|---|---|---|---|
| 2.1 | Next.js 15 + React 19 + Tailwind v4 + shadcn/ui scaffold under `projects/meld/web/`. Package name `meld-web`. Theme provider via `next-themes` with `attribute="data-theme"`. **Sovereign OKLCH palette** in `app/globals.css` — NO token reuse from tape (`docs/conventions.md` § 14). Visual direction: warm-paper light theme, deep-graphite dark theme, vivid OKLCH user-color assignment palette (~12 distinct hues for 12 concurrent users max). | S | frontend-engineer |
| 2.2 | Hono RPC client (`hc<AppType>`) setup pointing at the Node server. End-to-end type inference verified by deliberately breaking a server response shape and confirming the client typecheck error surfaces. | S | frontend-engineer |
| 2.3 | Layout shell + first shadcn primitives. Top bar (BrandMark "Meld" + connection status pill + theme toggle + share-board affordance), main canvas area, bottom toolbar (drawing primitives + selection + undo / redo placeholders). shadcn primitives: `Button`, `Tooltip`, `Separator`, `Dialog` (for share board modal), `Popover` (for color picker placeholder), `Command` (palette). Mobile-first responsive from 320 px. Below 768 px, the canvas is view-only and the bottom toolbar collapses to a single "open on desktop to edit" hint. | M | frontend-engineer |
| 2.4 | Board route `/board/[boardId]` (or `/[boardId]` if shorter URL wins on share aesthetics — pick one in implement phase). Server component fetches board metadata; client component hosts the Yjs `Y.Doc` and the Canvas2D layer. | S | frontend-engineer |
| 2.5 | Yjs client setup. `new Y.Doc()` per board, `WebsocketProvider` from `y-websocket` connecting to `/ws/board/:boardId`. Awareness state seeded with session-assigned emoji-name + OKLCH color from the welcome frame (ADR-004). | M | frontend-engineer |
| 2.6 | Canvas2D drawing surface — layered architecture (background grid, shapes, selection chrome). Single `requestAnimationFrame` loop driven by Yjs document observer. No layout thrash — DOM measurement cached on resize. Drawing primitives: rectangle, ellipse, arrow, freehand line, text label (sticky-note shape deferred — see Out of scope if Phase 3 time-box doesn't cover it). Selection + drag + resize. | L | frontend-engineer |

### Phase 3 — Wow moment

| # | Task | Size | Subagent |
|---|---|---|---|
| 3.1 | Presence cursor layer (React-rendered, on top of Canvas2D). Each remote user's awareness state drives a `<motion.div>` cursor with smooth ~120 ms interpolation + name pill anchored below. Local cursor is hidden (the OS cursor already shows it). | M | frontend-engineer |
| 3.2 | Awareness avatar stack in the top-right corner. Up to 5 visible avatars + "+N" overflow pill. New users animate in via `AnimatePresence` enter; disconnects animate out. Each avatar carries the user's OKLCH color + emoji-name on hover (shadcn `Tooltip`). | M | frontend-engineer |
| 3.3 | Offline-mode visual treatment. When the WebSocket disconnects (manually via DevTools or network drop), the connection status pill flips to "Offline — your changes are saved locally". Remote cursors are visually frozen + desaturated. On reconnect, the Yjs sync handshake fires automatically; the status pill flips back to "Live" with a Motion celebrate-in transition. | M | frontend-engineer |
| 3.4 | Share-board affordance. Top-bar share button opens a shadcn `Dialog` with the board URL + a "Open new tab with this URL" button (which is the primary "demo the multi-user wow" path on a single-machine viewer). Copy-to-clipboard with `navigator.clipboard.writeText`. | S | frontend-engineer |
| 3.5 | Selection chrome + per-shape readout. Selected shape's bounding box + handle dots are React-rendered above the Canvas2D layer (NOT on the canvas, so the selection survives canvas redraws without flicker). `aria-live="polite"` mirror announces selection geometry for screen readers. | M | frontend-engineer |
| 3.6 | Conflict viz dev-affordance — a dev-only `Cmd+Shift+D` overlay shows the current Yjs document state vector + the last 10 sync messages received. Strip at build via `process.env.NODE_ENV === 'development'` (same dev-pip strip-at-build pattern tape Task 2.4 established). Reviewer + designer-critic feedback channel for the CRDT story. | S | frontend-engineer |

### Phase 4 — Review

| # | Task | Size | Subagent |
|---|---|---|---|
| 4.1 | UI milestone review against `docs/inspirations.md` references — Linear (chrome restraint), tldraw / Excalidraw (whiteboard reference), Rauno Freiberg (detail polish). Designer-critic produces concrete defect list; frontend-engineer applies. Zero pochwał. | M | designer-critic |
| 4.2 | Code review of server (Hono + y-websocket adapter + snapshot persistence + compaction). Focus on the CRDT correctness invariants (commutativity, associativity, snapshot replay equivalence) and the backpressure path on per-room broadcast. | M | reviewer |

### Phase 5 — Tests

| # | Task | Size | Subagent |
|---|---|---|---|
| 5.1 | Vitest unit suite for the snapshot writer — debounce trigger boundary, encoding correctness, replay round-trip on a synthetic op stream of 1000 ops. | M | test-engineer |
| 5.2 | Vitest unit suite for the compaction sweep — assert merged snapshot replays identically to the original chain, assert older rows are atomically marked superseded, assert no concurrent-writer race corrupts the chain. | M | test-engineer |
| 5.3 | Playwright E2E: two-tab presence demo — open two browser contexts, both load the same board, tab A draws a rectangle, assert tab B sees it within 500 ms; tab A goes offline, draws 3 more shapes, comes back online, assert tab B receives all 3 within 1 s; theme toggle works in both tabs; keyboard nav reaches all interactive elements. | L | test-engineer |
| 5.4 | Playwright E2E: 30-tab offline rotation stress test — programmatically open 30 contexts, each draws 10 shapes while offline, reconnect all 30, assert final state contains all 300 shapes in deterministic order. | M | test-engineer |
| 5.5 | Lighthouse CI workflow asserting ≥ 95 across categories on the deployed demo. | S | test-engineer |

### Phase 6 — Docs

| # | Task | Size | Subagent |
|---|---|---|---|
| 6.1 | `README.md` — pitch, stack, run instructions, demo URL, screenshots + GIF of the two-tab presence wow moment, key decisions, v2 migration path (CF Workers Durable Objects). | M | doc-writer |
| 6.2 | `CHANGELOG.md` initialised, Keep a Changelog format. | S | doc-writer |
| 6.3 | Architecture diagram (Mermaid in README) showing: browser tab A ↔ Hono `/ws/board/:id` ↔ `y-websocket-server` per-room `Y.Doc` ↔ debounced snapshot writer ↔ Postgres `board_snapshots`; awareness fan-out per room; browser tab B mirroring the same room. | S | doc-writer |

## Out of scope (v1)

Locked. v2 candidates only.

- User accounts, saved boards per account, board ownership, paid tier. `better-auth` scaffolded but inactive.
- PNG / SVG export of the board.
- Multi-page boards (one board = one page in v1).
- Asset uploads (images, files) — drawing primitives only.
- Native mobile gestures (pinch-zoom, two-finger pan). Mobile gets view-only below 768 px.
- CF Workers Durable Objects deploy. v1 deploys to a Node host (Fly.io Machines or Railway, picked in deployment ADR). v2 migration path documented in DEPLOY.md.
- Sticky-note shape — deferred unless Phase 2.6 time-box covers it. Reviewer / designer-critic may pull it forward if the toolbar feels thin without it.
- Undo / redo. Yjs supports `UndoManager` natively but wiring it across the toolbar + keyboard shortcuts + multi-user semantics is its own task. Bottom toolbar carries placeholder buttons but they are `aria-disabled`.
- Multi-board navigation / "my boards" list. URL share is the only board-discovery surface in v1.
