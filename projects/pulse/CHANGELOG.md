# Changelog

All notable changes to **pulse** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Bumped the `pulse-server` dev dependency `vitest` `^2.1.8` → `^4.1.0` to close **GHSA-5xrq-8626-4rwp / CVE-2026-47429** (critical, CVSS 9.8 — arbitrary file read/exec when the Vitest UI server is network-exposed; no patched 2.x exists). This also reconciles the manifest with the lockfile (which already resolved `vitest@4.1.8`). All `pulse-server` tests pass on 4.1.8 (18 files, 189 passed / 1 skipped).

### Added

- Project README for the shipped v1: live demo link, the wow-moment description, screenshots (the live board and the demo-incident-down beat, light and dark, plus the public page on mobile), the accurate stack, verified run instructions for the three-process model, architecture notes, the key-decision links, and the testing / quality story.
- `docs/capture-screenshots.mjs` — Playwright screenshot capture script that drives the live demo headlessly, triggers the demo-incident arc, and waits on the real `data-status=down` state before capturing the wow shot.
- `docs/screenshots/` — board (light / dark), demo-incident-down (light / dark, the wow), monitor detail (light / dark), public status page (light / dark / mobile), incidents (light / dark), and alerts (light / dark) PNGs captured against the live demo.

## [0.1.0] — 2026-06-04

First shipped cut. A real, working uptime / status monitor — feature-complete for v1 and deployed: scheduled BullMQ probes genuinely hit endpoints behind an airtight SSRF guard, a live SSE-pushed status board reacts to real results, an incident state machine opens and closes incidents from the result stream, signed webhook alerts fire on every transition, a public redacted status page ships with full SEO, and a demo-open auth posture lets a recruiter explore without a login wall. Seven ADRs ratified; designer-critic and reviewer passes landed with fixes applied; Vitest + Playwright + Lighthouse CI in place. Deployed to [https://pulse-demo-web.fly.dev](https://pulse-demo-web.fly.dev).

### Added

**Architecture (ADR-001 to ADR-007).**

- **ADR-001** — Stack flavour `api-heavy` (four of the five hard triggers fire), backend NestJS on Node 22 LTS with Drizzle + PostgreSQL + BullMQ + Redis + better-auth + Zod. Real-time channel SSE (not WebSocket — the live channel is strictly server-to-client). Charting uPlot for live time series + hand-rolled SVG / CSS for sparklines, uptime bars, and status dots. Motion as the single animation library. Sovereign clean-SaaS tokens, no reuse from tape / meld / razors-edge. Portfolio backend variance completed: Elysia/Bun (tape), Hono/Node (meld), NestJS/Node (pulse) — three distinct backends across three api-heavy projects.
- **ADR-002** — Probe scheduler + BullMQ design + the SSRF guard. One repeatable job per monitor keyed by a stable scheduler id `probe:<monitorId>`; remove-then-add reconciliation on mutation plus an `OnModuleInit` boot reconciliation against the DB as source of truth (orphan sweep). A failing endpoint is a successful job that records `down`; `attempts` / `backoff` are reserved for infrastructure faults. Resolve-then-pin SSRF guard (scheme allowlist, credentialed-URL reject, per-record DNS validation against the full private / loopback / link-local / metadata denylist, undici IP pin against rebinding, manual per-hop redirect re-checking, 512 KB body cap), run at both create-time and execution-time.
- **ADR-003** — Real-time SSE contract + the worker-to-SSE Redis bridge. Named-event vocabulary (`check.result`, `status.change`, `incident.open`, `incident.close`, `alert.fired`, `heartbeat`) with Zod payloads in the shared `events.ts`. Two channel scopes: the cookie-authenticated dashboard stream (`/api/stream`, the session user's monitors only) and the unauthenticated redacted public stream (status changes + incidents only). The worker publishes to the Redis channel `pulse:events`; each API replica's bridge holds a dedicated ioredis subscriber, validates each envelope, and relays it into an RxJS subject the `@Sse()` routes filter by scope. 256-event per-scope ring buffer for `Last-Event-ID` resume; longer gaps reconcile via REST refetch.
- **ADR-004** — Incident state machine + uptime computation. A pure reducer (N=3 consecutive bad opens exactly one incident, M=2 consecutive good closes it, degraded escalates to down on the open incident, the N/M debounce is the flap suppression). Hybrid uptime: 24h from raw `check_results`, 7d/30d from the hourly rollup table plus a live-incident top-up; degraded counts 50%, a result's coverage is capped at the interval, and gaps longer than 2x the interval are `unknown` and excluded from numerator and denominator.
- **ADR-005** — Drizzle data model, indexing, retention / rollup, and the alert dispatch split. The `(monitor_id, checked_at DESC)` hot-path index; two DB-level correctness invariants (partial unique `incidents(monitor_id) WHERE status='open'`; unique `alert_deliveries(incident_id, alert_channel_id, transition)`); 35-day raw retention + 400-day hourly rollups via a 5-minute rollup job and an hourly GC sweep; one `AlertDispatcher` interface with a real HMAC-signed webhook and a mocked email implementation; the `public_status_page_monitors` join governing the public surface.
- **ADR-006** — Fly deploy topology. One NestJS image as two Fly processes (`web` = HTTP + the two `@Sse()` routes + better-auth; `worker` = BullMQ probe + rollup + GC), both warm-floored so the wow moment never cold-starts. A separate Next app reverse-proxies the API single-origin so the `EventSource` cookie-auth is first-party. Upstash Redis + Fly Postgres, region `fra`. The demo-incident mechanism is the owned `/demo/flaky` endpoint toggled by a Redis flag, inside the SSRF allowlist so the full arc completes on the deploy.
- **ADR-007** — The demo-open auth posture. better-auth is fully wired (email + password sign up / in / out / get-session), but the deployed demo never hits a login wall: an unauthenticated visitor reads the shared seeded demo workspace (board, detail, incidents, the demo trigger) while mutations require a real session (a clear `401 authentication_required`). One crisp seam — `CurrentOwnerService.resolveOwnerUserId` (reads) vs `requireUserId` (writes). The `users.id` FK flag was resolved additively (uuid kept, better-auth configured to emit UUIDs onto the existing table).

**Backend** (`pulse-server`).

- Phase 1 — NestJS scaffold (config + Zod-validated env + `GET /health`), Drizzle + Postgres with the full schema and the two DB-level correctness indexes, Redis + BullMQ wiring, the shared Zod schemas including the `events.ts` SSE contract, monitors CRUD with the scheduler-reconcile seam, and the SSRF guard (two pure functions, 39 tests). Ports: API 3080, Postgres 5437, Redis 6381.
- Phase 2 — The probe runner / processor (execution-time SSRF guard with the undici IP pin, manual per-hop redirects, classification extracted to a pure module), boot-time repeatable-job reconciliation with orphan sweep, the idempotent one-result-one-event write path, the worker / web process split (`main.ts` web vs `worker.ts`), and the rollup + GC repeatable jobs.
- Phase 3.1 — The two `@Sse()` routes, the worker-to-SSE Redis bridge (dedicated subscriber, boundary validation, the per-scope ring buffer, heartbeat), and the event publisher.
- Phase 4 — The monitor-detail read endpoints (`/monitors/:id/uptime|series|history|checks`) with the hybrid uptime math as pure unit-tested modules; the 30d query verified to read rollup rows, not the raw scan.
- Phase 5 — The incident engine (the pure reducer wired into the check-recording path, single-open enforced in both the reducer and the DB), the alerts module (the real HMAC-SHA256-signed webhook dispatcher and the mocked email dispatcher, claim-the-slot de-dup), the alert-channels CRUD, and the demo trigger (`/demo/flaky`, `/demo/trigger`, `/demo/status`, Redis-flag-backed, gated by `DEMO_TRIGGER_ENABLED`).
- Phase 6 — better-auth integration (session auth, auth-endpoint rate limiting, the additive UUID reconciliation), the redacted public read surface (`GET /public/:slug`, exposing only status + 30-day uptime % + redacted incidents) with its own rate-limit guard, and the deterministic frozen-`now` seed (the demo monitor, the 30-day history, the public-page join).

**Frontend** (`pulse-web`).

- Phase 3.2 / 3.3 — Next 15 + React 19 + Tailwind v4 scaffold with the sovereign clean-SaaS token set (AA-verified status semantics in both themes, status never color-alone), the strict no-`unsafe-eval` CSP, and the live status board: monitor cards (status dot + text label, host, response-time sparkline, ticking "last checked"), the single `EventSource` client feeding TanStack Query / Zustand, the create-monitor dialog (RHF + Zod), and `aria-live` announcements.
- Phase 3.4 — The "Trigger demo incident" affordance with a guided running state (arming -> in progress -> recovering -> complete) so the ~30-45 s real arc reads as deliberate theatre.
- Phase 4 — The monitor detail route: 24h / 7d / 30d uptime cards, the imperative uPlot response-time chart (off the React render path, theme-aware, CSP-clean, live 24h append from the SSE store), the hand-rolled SVG uptime history bar, and the recent-checks list.
- Phase 5 — The incidents view (live-updating timeline with all / open / resolved filters), the board incident indicators (the live incident strip + the down-ring + the outage summary), the alerts config (channel list, create dialog, the webhook signing hint, the honest "mock — no real email sent" badge), and the hand-rolled Motion-based alert toast.
- Phase 6 — The auth UI (sign-in / up dialog + session-aware header + sign-out), the demo-open gating (write affordances prompt sign-in instead of a raw 401), the public `/status/[slug]` page (SSR redacted payload + live public-stream updates + per-page metadata, `next/og` OG image, JSON-LD, sitemap, robots), and the landing.

**Review-cycle fixes** (designer-critic + reviewer, Phase 7, applied).

- The CSP-jitless regression — `z.config({ jitless: true })` imported into the client graph (providers + the SSE / form schema modules) so client chunks do not JIT-probe `new Function` under the no-`unsafe-eval` CSP.
- The public status page hydration mismatch — narrow `suppressHydrationWarning` on the three time-dependent text nodes, keeping the real SSR "Ns ago" text for SEO.
- The post-sign-up board lag — a shared `invalidateOnAuthChange` helper invalidating every owner-scoped cache on sign-in / up / out.
- The synchronized down beat — the demo card status and the summary headline always agree in one settled frame; the public banner can never read operational while an incident is open.
- The repo-root strict-ESLint conformance pass over `web/src` (153 errors resolved properly, behaviour unchanged).

**Tests and CI** (Phase 8).

- ~190 server Vitest tests (the incident reducer invariants, uptime against known-percentage fixtures, probe classification, the SSRF ranges, HMAC signing, alert de-dup, the SSE bridge, the owner / redaction seams).
- ~131 web Vitest tests (chart adapters, history-bar bucketing, sparkline path, status-token AA contrast, form-to-API mapping, the incident store, the SSE schema, the production CSP header assertion).
- 14 Playwright E2E (`pulse-e2e`): landing smoke, the live board (one SSE connection, real state, no polling), the demo-incident arc, the ADR-007 auth boundary, the incidents view, the redacted public page, and keyboard + reduced-motion — plus a `@smoke` subset for deploy verification.
- Lighthouse CI asserting >= 95 in all four categories on the landing and the public status page, Core Web Vitals green; the authenticated dashboard documented exempt.
- CI workflows: `pulse-e2e` and `pulse-lighthouse` (Postgres + Redis service containers, migrate + seed, NestJS web + worker, built Next, then the suite / LHCI).

**Deploy** (Phase 9).

- The full ADR-006 deploy surface: `Dockerfile` (pulse-api, one image / two processes, TS via `tsx`), `Dockerfile.web` (pulse-web Next standalone), `entrypoint.sh` (role-aware: migrate + idempotent seed then exec), `fly.toml` (two processes, web-only health check), `fly.web.toml`, `.dockerignore`, the single-origin `rewrites()` proxy in `web/next.config.ts`, and `DEPLOY.md` (one-time setup, deploy, verify, rollback, migrations, cost, secrets, troubleshooting).
- Redis = Upstash, Postgres = Fly Postgres, region `fra`. Migrations + the idempotent demo seed run on every web boot.
- Deployed to [https://pulse-demo-web.fly.dev](https://pulse-demo-web.fly.dev); the live board, the full demo-incident arc, the public page, and the auth boundary verified on the live URL.

### Mocked / honest boundaries

- **Email alerts are mocked.** The email channel satisfies the same `AlertDispatcher` interface but does not open an SMTP connection — it records an `alert_deliveries` row and logs the rendered message. The webhook channel is the genuinely-sent, HMAC-signed v1 alert. A real SMTP transport can drop in later without touching the incident engine.
- **Seed vs live.** Seeded history (faker, `faker.seed`, frozen `now`) makes the board and the public page rich on first load; everything from `now` forward is a real scheduled probe. The boundary is the credibility line and is documented.

### Not shipped in v1 (deferred)

- **Multi-tenant SaaS surfaces** — teams, org membership, roles, billing. v1 is single-owner; the schema carries `user_id` FKs but the UI does not build it.
- **TCP / ping / DNS / SSL-expiry probe types** — v1 is HTTP/HTTPS only. A documented v2 stretch.
- **Live email / SMS / PagerDuty alerting** — webhook is the real v1 channel; email is mocked. Other transports are v2.
- **On-call schedules, escalation policies, alert routing** — v1 fires every enabled channel on every transition.
- **Multiple public status pages, custom domains, maintenance windows, subscriber notifications** — Statuspage-tier features deferred to v2.
- **Multi-region probing** — v1 probes from one region; geo-distributed probes are a v2 systems extension.
- **Historical down-sampling beyond the 35-day raw / hourly-rollup retention** — long-horizon analytics is v2 (Postgres partitioning noted as the scaling path).

---

[Unreleased]: https://github.com/AntczakJ/portfolio/compare/pulse-v0.1.0...HEAD
[0.1.0]: https://github.com/AntczakJ/portfolio/releases/tag/pulse-v0.1.0
