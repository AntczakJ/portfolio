# Portfolio — Global Progress

> Read this file before any change. Update it after.

## State

- **Projects:** 6 (`tape` — implement phase Phase 3.2 landed; `meld` — v1 shipped, demo live at https://meld-demo.fly.dev; `razors-edge` — built 2026-06-03, web-only dark-luxe barbershop showcase, reviewer GREEN, 53 unit + 18 E2E pass, not yet deployed; `pulse` — v1 shipped + deployed 2026-06-04, api-heavy NestJS uptime monitor, slot 4, demo live at https://pulse-demo-web.fly.dev; `apex` — built 2026-06-05, web-only premium EV-positioned car-rental showcase with a real R3F + drei 3D configurator (four-tier WebGL degradation) and a fully mocked multi-step reservation flow, slot 5, 151 unit + 22 E2E pass, desktop Lighthouse ≥95, P0-1 resolved (whole fleet on CC0 Kenney models; CSP tightened — no wasm-unsafe-eval), v1 shipped + deployed 2026-06-05, demo live at https://apex-rentals.fly.dev; `atlas` — planned 2026-06-06, api-heavy live geospatial fleet/delivery tracking (Fastify + WebSocket + MapLibre), slot 6, deterministic server-side simulation engine streaming telemetry to a live map, planner done → architect next, not yet built)
- **Scaffold:** done (2026-05-28)
- **CI:** green on empty repo (placeholder workflows)
- **First commit:** pending owner ACK

## Done

- [x] Monorepo scaffold (pnpm workspace, TS strict, ESLint flat, Prettier, Husky, commitlint).
- [x] CI + Lighthouse + Dependabot workflows.
- [x] Eight Claude Code subagents in `.claude/agents/`.
- [x] `docs/conventions.md` with stack policy, workflow, extraction triggers, do-not-share list.
- [x] `docs/inspirations.md` with reference list and animation-library policy.
- [x] First project — name + one-line pitch from owner: **`tape`** — production-grade real-time orderflow visualizer for crypto perpetual futures (CVD, footprint chart, tape replay over WebSocket).
- [x] Planner subagent produced `projects/tape/PLAN.md`, `DECISIONS.md` (ADR-001), `PROGRESS.md`, `AGENT_NOTES.md`.
- [x] Second project — name + one-line pitch from owner: **`meld`** — local-first collaborative whiteboard with sub-100 ms presence and conflict-free shape merges via Yjs CRDT over Hono multi-runtime backend, anonymous-link-share onboarding. Pure-showcase slot (tape holds the commercial-seed slot).
- [x] Planner subagent produced `projects/meld/PLAN.md`, `DECISIONS.md` (ADR-001), `PROGRESS.md`, `AGENT_NOTES.md` (2026-05-31).
- [x] Third project — name + one-line pitch from owner: **`razors-edge`** — cinematic dark-luxe marketing site for an upscale barbershop with a fully mocked, delightful multi-step booking flow. Web-only creative / marketing showcase (owner's deliberate call; NestJS api-heavy slot preserved). Wow: scroll-driven blade-slice hero (GSAP ScrollTrigger).
- [x] Planner subagent produced `projects/razors-edge/PLAN.md`, `DECISIONS.md` (ADR-001), `PROGRESS.md`, `AGENT_NOTES.md` (2026-06-03).
- [x] Fourth project — name + one-line pitch from owner: **`pulse`** — a real, working uptime / status monitor (scheduled probes actually hit endpoints; a live dashboard pushed over SSE; an incident state machine; real webhook alerting; an SEO-friendly public status page). Api-heavy, the deliberate **3rd api-heavy slot claiming the reserved NestJS backend** (tape Elysia/Bun + meld Hono/Node + pulse NestJS = three distinct backends). Wow: the live status board reacting in real time to real probes, with an incident opening live (dot flips red, incident row grows, alert fires) and auto-closing on recovery, reproducible on demand.
- [x] Planner subagent produced `projects/pulse/PLAN.md`, `DECISIONS.md` (ADR-001), `PROGRESS.md`, `AGENT_NOTES.md` (2026-06-03). Composition tracker updated — slot 4, api-heavy, NestJS; § 12 satisfied with margin (3 api-heavy, 3 backends).

## In progress

- Project 1 (`tape`) — implement phase, Phase 3.2 (cursor + crosshair + cell tooltip + Follow-live affordance) landed 2026-05-30; Phase 3.3..3.6 and Phase 1 Rust-side follow-ons (1.5 / 1.5c / 1.5d) continue.
- Project 2 (`meld`) planned — handing to `architect` for ADR-002 (Hono WebSocket adapter choice) then ADR-003 (Yjs snapshot persistence strategy), then `frontend-engineer` + `backend-engineer` for parallel implementation of v1 scope.

## Next

- [ ] `architect` authors **ADR-002** (Rust ↔ Elysia bridge), **ADR-003** (persistence schema), **ADR-004** (WebSocket frame contract) in `projects/tape/DECISIONS.md`.
- [ ] `backend-engineer` scaffolds Bun + Elysia under `projects/tape/server/` (PLAN.md task 1.1).
- [ ] `frontend-engineer` scaffolds Next.js 15 + Tailwind v4 under `projects/tape/web/` (PLAN.md task 2.1).

## Portfolio composition tracker

Per `docs/conventions.md` § 12 — minimum 2–3 `api-heavy` projects with backend variance.

| Slot | Project     | Category            | Backend      |
| ---- | ----------- | ------------------- | ------------ |
| 1    | tape        | api-heavy           | Elysia (Bun) |
| 2    | meld        | api-heavy           | Hono (Node)  |
| 3    | razors-edge | web-only (creative) | — (mocked)   |
| 4    | pulse       | api-heavy           | NestJS       |
| 5    | apex        | web-only (creative) | — (mocked)   |
| 6    | atlas       | api-heavy           | Fastify      |

Composition status: 6 projects, **4 api-heavy across FOUR distinct backends** (tape Elysia/Bun + meld Hono/Node + pulse NestJS/Node + atlas Fastify/Node) + 2 web-only creative (razors-edge, apex). The § 12 constraint (2–3 api-heavy, ≥ 2 backends — ideally Hono + Fastify + one of NestJS / Elysia) is now **fully satisfied and the backend-variance story is COMPLETE**: atlas (slot 6) claims the last unused § 11 backend (Fastify), so the portfolio now demonstrates all four cutting-edge Node/Bun backends (thin-and-fast Elysia/Bun · multi-runtime-edge Hono · opinionated-enterprise NestJS · focused-performance Fastify). The two web-only creative slots (razors-edge dark-luxe marketing, apex 3D-configurator) round out the range. No backend axis remains to fill.

Planned (pre-allocated, not yet ratified):

- Slot 5 — edge-native voice/multimodal (Motion).
- Slot 6 (optional) — WebGPU + TSL.
