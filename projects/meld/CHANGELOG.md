# Changelog

All notable changes to **meld** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project README rewritten for the shipped v1: live demo link, screenshots (the two-tab presence hero plus landing and board, light and dark, plus mobile), accurate stack, verified run instructions, and architecture notes.
- `docs/capture-screenshots.mjs` — Playwright screenshot capture script for the README; `e2e/capture-hero-local.mjs` drives two browser contexts against a local production-style stack for the two-tab presence hero shot.
- `docs/screenshots/` — the two-tab presence hero (light / dark, the headline wow-moment shot, captured from a local prod stack), landing (light / dark / mobile), and board (light / dark) PNGs.

## [0.0.1] — 2026-06-01

First shipped cut. Local-first collaborative whiteboard, feature-complete for v1: real-time multi-user drawing, sub-100 ms cursor presence, conflict-free CRDT auto-merge, anonymous identity, offline-mode UX, and a single-Machine Fly deploy. Nine ADRs ratified; designer-critic and reviewer passes landed with fixes applied; Playwright deploy-verification harness in place. Deployed to [https://meld-demo.fly.dev](https://meld-demo.fly.dev).

### Added

**Architecture (ADR-001 to ADR-009).**

- **ADR-001** — Stack flavour `api-heavy`, backend Hono on Node 22 LTS, Yjs as the CRDT layer (`y-websocket` protocol + `y-protocols/awareness`). Portfolio backend variance: tape runs Elysia on Bun, meld runs Hono on Node 22. CF Workers Durable Objects named as the v2 horizontal-scale target.
- **ADR-002** — Hocuspocus WebSocket server mounted on the same Node `http.Server` as Hono; Hono owns HTTP control routes, Hocuspocus owns `/ws/board/:boardId`. Room registry is Hocuspocus's own `Server.documents` map. Origin check shares the `MELD_ALLOWED_ORIGINS` allowlist with HTTP CORS, fails closed in production. Backpressure via Hocuspocus `maxRate` / `maxMessageSize` / `timeout` config, close code `4290`.
- **ADR-003** — Hybrid persistence: a Hocuspocus `Storage` adapter backed by `boards` (denormalised snapshot column) plus `board_ops` (per-edit `bytea` durability). Snapshot debounce 5 s idle / 30 s ceiling / 100-ops early flush. 30-day inactive-board retention via a nightly 03:00 UTC cascade sweep; rolling 6 h compaction backstop. No chunking in v1 (200-shape board encodes at ~25 KB).
- **ADR-004** — WebSocket control-frame contract: JSON over TEXT frames, parsed through a Zod discriminated union, kept strictly separate from the binary y-websocket protocol. Six v1 `kind` literals (`welcome`, `control.overrun`, `control.board-deleted`, plus three v1.1 / v2 stubs). `protocolVersion: 1` gates discriminator-vocabulary changes.
- **ADR-005** — Anonymous session model: server-minted UUID v4 in a JS-readable `meld_session` cookie, no DB persistence. Deterministic per-session emoji name (`fnv1a(sessionId) % 128`) and per-board OKLCH color (`fnv1a(sessionId + ':' + boardId) % 8`). Each WS connection is its own awareness identity, so two tabs of one browser show as two cursors sharing the same emoji and color.
- **ADR-006** — Production topology: single Fly Machine, single external port, one Node process serving both Hono HTTP and Hocuspocus WS. WS upgrade routed at the `http.Server` `upgrade` event before the Hono catch-all. Behind Fly edge TLS with `X-Forwarded-Proto` trusted by the cookie middleware; `Secure` forced in production.
- **ADR-007** — Playwright deploy-verification harness against the live URL: cold load, `/health` Zod parse, session-cookie roundtrip, board create / open, WS welcome-frame parse, and the two-tab presence proof (`connectedClients` goes to 2 then back to 1).
- **ADR-008** — Two-layer Canvas2D drawing surface (shapes + cursors), independent dirty flags and rAF loops, single Yjs shape-map observer, critical-damped cursor lerp (~120 ms settle). `getComputedStyle` + `MutationObserver` theme bridge, one token parse per `data-theme` flip. Dev-only conflict-viz overlay stripped from production builds (grep-verified zero matches in `.next/static/chunks`).
- **ADR-009** — Offline-mode UX contract: banner-only disconnect treatment, whole-canvas reconcile crossfade gated on incoming-shape count, `aria-live` announcement, 1500 ms disconnect debounce (with `navigator.onLine` bypass), reduced-motion degradation to zero duration.

**Backend** (`meld-server`).

- Task 1.1 — Node 22 + Hono 4 scaffold, `GET /health` returning a Zod-validated `{ status, commit, ts }` envelope, explicit `0.0.0.0` bind, `tsx` dev / start.
- Task 1.2 — Drizzle ORM + postgres-js driver against PostgreSQL 17, `boards` and `board_ops` schemas, shared `bytea` custom type exposing `Uint8Array` end to end, drizzle-zod-derived row schemas, tolerant `pingDb()` for the health probe.
- Task 1.3 — Hocuspocus `Storage` adapter: per-edit ops append + debounced snapshot flush, in-memory per-board ops counter for the early-flush trigger, snapshot-plus-ops-tail rehydrate.
- Task 1.4 — Hocuspocus bootstrap on the shared `http.Server`, `/ws/board/:boardId` room routing at the `upgrade` event, origin check, backpressure config.
- Task 1.5 — `RetentionScheduler` (daily 03:00 UTC inactive-board sweep, cascade delete + `control.board-deleted` broadcast in one transaction) and `CompactionSweep` (rolling 6 h backlog backstop). `/health` extended with retention and storage counters.
- Task 1.6 — `POST /api/boards` and `GET /api/boards/:boardId` HTTP control routes.
- Task 1.7a / 1.7b — anonymous-session cookie middleware (FNV-1a + emoji allowlist + per-board OKLCH derivation), Hocuspocus `onConnect` cookie read, welcome-frame identity wire, `POST /api/session` cookie-disabled fallback.
- Task 1.X-control — six WS control-frame Zod schemas, welcome emit on the Hocuspocus `connected` hook, token-bucket rate-limit extension, `emitOverrunAndClose` helper, types-only re-export through `src/app.ts` for the web client.

**Frontend** (`meld-web`).

- Task 2.1 — Next 15.5 + React 19.2 + Tailwind v4 (CSS-first, sovereign OKLCH palette) + next-themes + TanStack Query + Zustand + Zod scaffold.
- Task 2.2 / 2.3 — Hono RPC client, `ApiStatusDot`, chrome shell (top bar, status row), first radix / shadcn primitives.
- Task 2.4 — board route `/board/[boardId]`, `useCreateBoard` mutation, board-not-found 404 dialog.
- Task 2.5a / 2.5b — awareness seed pipeline, `useAwareness()` hook over `useSyncExternalStore`, `<AwarenessProvider>`, brand-corner identity badge derived from the session cookie + welcome-frame reconciliation.
- Task 2.6 — Canvas2D scaffold per ADR-008: `BoardEngine` two-layer surface, `HocuspocusProvider` factory, theme bridge, dev conflict-viz overlay (production strip verified).
- Task 3.2 — drawing primitives (rectangle, ellipse, freehand, text), `<BoardToolbar />` with keyboard shortcuts, pointer overlay, awareness-color shape painter.
- Task 3.3 — presence cursors: cursor field on awareness, engine cursor map with critical-damped lerp, arrow + name-pill painter, ~30 ms cursor-write throttle.
- Task 3.4 — offline-mode UX (ADR-009): `useConnectionStatus`, `<ConnectionBanner />`, `<OfflineAriaLiveRegion />`, reconcile crossfade, `--color-warning` token.

**Review-cycle fixes** (post designer-critic + reviewer, Phase 4).

- Applied four designer-critic must-fixes: BrandMark logomark + wordmark sizing, IdentityBadge scale + border beat, solid-accent active toolbar slot, cursor name-pill sizing and alpha.
- Bundled the reviewer's security-headers gap: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy in `web/next.config.ts`.

**Tests and CI** (Phase 5).

- `node --test` unit suites on the server (storage adapter, retention, control frames, session helpers).
- Vitest unit suites on the web (engine, painters, theme tokens, tool store, identity badge, connection banner, offline aria-live region).
- Playwright E2E harness (`meld-e2e`): nine v1 specs (landing, board creation, board not found, identity cookie, drawing primitives, multi-user presence, connection banner, offline-edit merge, theme toggle), a `@smoke` subset for deploy verification, and a CI workflow.

**Deploy** (Phase 6).

- Three-stage `Dockerfile` (Next standalone web-builder, pnpm-deployed server-builder, slim runtime), `entrypoint.sh` (drizzle migrate then supervise server + web), `fly.toml` (single `[http_service]`, auto-stop off / min-1-machine to keep WS connections warm), `.dockerignore`, and a `workflow_dispatch` deploy workflow.
- `DEPLOY.md` production runbook: one-time Fly setup, deploy, verify, rollback, migrations, cost, observability, troubleshooting.
- Deployed to [https://meld-demo.fly.dev](https://meld-demo.fly.dev); `/health` returns 200 with the full canonical JSON envelope.

### Not shipped in v1 (deferred)

- **Accounts and saved boards.** better-auth is named as the v2 identity path in ADR-001 / PLAN.md but is **not present** in v1 — no dependency, no active code. v1 identity is the anonymous session cookie only.
- **Selection chrome, drag / resize, multi-select** — Phase 3.2b scope deferred to v1.1.
- **Application-level heartbeat, settings sync, name-collision kick** — reserved as v1.1 / v2 stub schemas (intentional dead schema with documented reactivation paths).
- **CF Workers Durable Objects transport** — the v2 horizontal-scale target; the Hocuspocus extension-hook shape is preserved so the migration is transport-only.
- **Canvas-merge visual assertion in E2E** — the offline-merge spec asserts reconnect behaviour; the pixel-level merge assertion is a v1.1 deferral.

---

[Unreleased]: https://github.com/AntczakJ/portfolio/compare/meld-v0.0.1...HEAD
[0.0.1]: https://github.com/AntczakJ/portfolio/releases/tag/meld-v0.0.1
