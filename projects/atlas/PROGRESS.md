# atlas — Progress

> Read on start. Write on end.

## State

- **Phase:** **planned** (planner pass DONE, 2026-06-06). PLAN.md, DECISIONS.md (ADR-001), PROGRESS.md, AGENT_NOTES.md, TASKS.md authored under `projects/atlas/`. NOT committed (the main thread commits).
- **Category:** api-heavy. Portfolio slot 6.
- **Backend:** Fastify (Node 22 LTS) + `@fastify/websocket` + Drizzle + PostgreSQL (plain, `jsonb` GeoJSON; PostGIS deferred to v2) + Zod (`fastify-type-provider-zod`). **Fastify is the one § 11 backend not previously used — Atlas completes the four-backend variance story.**
- **Real-time transport:** WebSocket (`@fastify/websocket`). SSE rejected (bidirectional control + high-frequency telemetry — see ADR-001).
- **Map engine:** MapLibre GL JS, **keyless-by-default tile source** (optional richer-style key via env — HARD constraint: no paid secret committed).
- **Geo math:** turf.js, shared FE+BE via `src/lib/geo/`.
- **Simulation:** server-side, deterministic pure tick reducer + IO shell, seeded, replayable.
- **Animation:** map motion = hand-rolled rAF interpolation (NOT a library) + MapLibre native camera; Motion (single declarative library, § 15) for UI/panel transitions only.
- **Tokens:** sovereign operations/control-room, NO reuse from tape / meld / razors-edge / pulse / apex (§ 14).
- **Wow moment:** a live map where the fleet glides smoothly in real time (1 Hz authoritative ticks, 60 fps client interpolation) along routes, with route trails, live ETAs ticking down, and geofence enter/exit events firing live as vehicles cross zones — reproducible on demand via the deterministic engine's focus/replay affordance.
- **Created:** 2026-06-06
- **Demo URL:** not yet deployed.
- **Proposed ports (confirm on scaffold):** Fastify server **3090**, Next web **3091**, Postgres **5438**, Redis (only if ADR-007 needs one — likely not, no queue) TBD. Non-colliding with tape (3000-3002/3055-3061, pg 5435), meld (3002, pg 5436), razors-edge (3070), pulse (api 3080 / web 3081 / pg 5437 / redis 6381), Mila (pg 5434).
- **Architect pass:** PENDING. ADR-002..007 deferred (see PLAN.md "Deferred to architect").

## Done

- [x] Planner pass (2026-06-06): PLAN.md (problem, audience, wow + mandatory fallback, api-heavy justification, Fastify rationale, keyless-MapLibre constraint, WS-vs-SSE, simulation-engine design, turf/Postgres posture, animation split, success criteria, Phase 0–9 tasks, simulation/mock data shape, out-of-scope, deferred-to-architect), DECISIONS.md ADR-001, this PROGRESS.md, AGENT_NOTES.md, TASKS.md.

## In progress

- (nothing — awaiting architect pass)

## Next

1. **`architect`** — author **ADR-002** (simulation engine: pure tick reducer + determinism/seed + projection + dwell/speed + route-end + in-process vs split worker) in `projects/atlas/DECISIONS.md`. (PLAN.md Task 0.1)
2. **`architect`** — author **ADR-003** (real-time WS contract: frame vocabulary + encoding + subscription scoping + heartbeat + reconnect/resume + backpressure) and **ADR-006** (map engine + keyless tile source + dark/light basemaps + the CSP MapLibre allowances — the keyless gate). (PLAN.md Tasks 0.2, 0.5)
3. **`architect`** — author **ADR-004** (geo math + geofence debounce + ETA), **ADR-005** (data model + plain-Postgres-vs-PostGIS + retention), **ADR-007** (Fly deploy topology + WS-over-edge + warm floor). Then gate engineering kickoff on ADR-002 + ADR-005: **`backend-engineer`** starts the Fastify scaffold (Task 1.1) in parallel with **`frontend-engineer`** starting the Next + Tailwind v4 scaffold (Task 2.1). (PLAN.md Tasks 0.3, 0.4, 0.6, 1.1, 2.1)

## Handoff

**Next subagent: `architect`.** Pick up at PLAN.md Phase 0 (Tasks 0.1–0.6) — author ADR-002..007 in `projects/atlas/DECISIONS.md`, challenging the assumptions flagged in `AGENT_NOTES.md` § "Decisions to revisit" rather than inheriting them. The keyless-map constraint (ADR-006) and the streaming-surface-is-not-Motion / off-render-path interpolation discipline are hard gates, not negotiable defaults.

## Portfolio composition note

Atlas = slot 6, api-heavy, **Fastify** — the fourth distinct backend across four api-heavy projects (Elysia/Bun · Hono/Node · NestJS · Fastify). The § 12 backend-variance target was already satisfied with margin by pulse; Atlas **completes** it (every § 11 framework now represented). The root `PROGRESS.md` composition tracker row is added by the main thread.
