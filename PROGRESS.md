# Portfolio — Global Progress

> Read this file before any change. Update it after.

## State

- **Portfolio status: COMPLETE — 6 projects, all shipped and deployed to Fly.io.** The backend-variance target is met: four api-heavy projects across four distinct backends (tape Elysia/Bun, meld Hono/Node, pulse NestJS/Node, atlas Fastify/Node) plus two web-only creative showcases (razors-edge, apex). atlas (slot 6, Fastify) completes the backend-variance story.
  - `tape` — v1 shipped + deployed, api-heavy orderflow visualizer (Elysia/Bun + Rust worker), slot 1, demo at https://tape-demo.fly.dev
  - `meld` — v1 shipped + deployed, api-heavy local-first whiteboard (Hono/Node + Yjs), slot 2, demo at https://meld-demo.fly.dev
  - `razors-edge` — v1 shipped + deployed, web-only dark-luxe barbershop showcase (GSAP), slot 3, demo at https://razors-edge-demo.fly.dev
  - `pulse` — v1 shipped + deployed, api-heavy uptime monitor (NestJS + BullMQ), slot 4, demo at https://pulse-demo-web.fly.dev
  - `apex` — v1 shipped + deployed, web-only EV car-rental showcase (R3F 3D configurator), slot 5, demo at https://apex-rentals.fly.dev
  - `atlas` — v1 shipped + deployed, api-heavy live geospatial fleet tracking (Fastify + WebSocket + MapLibre, keyless Protomaps basemap), slot 6, demo at https://atlas-ops.fly.dev
- **Scaffold:** done (2026-05-28)
- **CI:** green
- **First commit:** done (repo has full history)

## Deployment status (INTERNAL — 2026-06-06)

All six demos are deployed to Fly.io. **The Fly apps are currently STOPPED to control cost; they are restartable on request.** This pause is internal and cost-driven — it is NOT reflected in any public README or CHANGELOG (the demo links there stay normal/live by deliberate owner policy).

Restart procedure (durable — do not hardcode machine IDs; list them with `fly machines list -a <app>`). Start the database first, then the api/server, then the web. Web-only apps auto-start when the demo URL is hit.

```sh
# pattern
fly machines list -a <app>                 # find the machine id(s)
fly machine start <id> -a <app>            # start; DB first, then api/server, then web
```

| Project     | Apps (start in this order)                                                                                           | Notes                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| tape        | `tape-pg` (Postgres) → `tape-demo` (web)                                                                             | web carries the Elysia server + Next via the catch-all proxy                                                              |
| meld        | `meld-db` (Postgres) → `meld-demo` (web)                                                                             | web carries Hono + Hocuspocus + Next                                                                                      |
| razors-edge | `razors-edge-demo` (web only, no DB)                                                                                 | auto-starts on URL hit                                                                                                    |
| pulse       | `pulse-demo-db2` (Postgres) → `pulse-demo-api` (NestJS, web + worker processes, 4 machines) → `pulse-demo-web` (web) | Redis is **Upstash (managed, always-on)** — not a Fly machine, nothing to start; the worker→SSE bridge needs it reachable |
| apex        | `apex-rentals` (web only, no DB)                                                                                     | auto-starts on URL hit                                                                                                    |
| atlas       | `atlas-db-eu` (Postgres) → `atlas-fleet-eu` (Fastify server + engine + WS) → `atlas-ops` (web)                       | the live map runs DB-less; DB is for the persisted events history                                                         |

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

- Nothing in active build. All six projects are shipped and deployed; the portfolio composition is complete.

## Next

- [ ] Optional: per-project v2 backlogs (recorded in each project's CHANGELOG / PLAN under deferred items).
- [ ] On request: restart the Fly demos per the Deployment status table above.

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

Composition status: 6 projects, **all shipped + deployed**. **4 api-heavy across FOUR distinct backends** (tape Elysia/Bun + meld Hono/Node + pulse NestJS/Node + atlas Fastify/Node) + 2 web-only creative (razors-edge, apex). The § 12 constraint (2–3 api-heavy, ≥ 2 backends — ideally Hono + Fastify + one of NestJS / Elysia) is **fully satisfied and the backend-variance story is COMPLETE**: atlas (slot 6) claims the last unused § 11 backend (Fastify), so the portfolio demonstrates all four cutting-edge Node/Bun backends (thin-and-fast Elysia/Bun · multi-runtime-edge Hono · opinionated-enterprise NestJS · focused-performance Fastify). The two web-only creative slots (razors-edge dark-luxe marketing, apex 3D-configurator) round out the range. No backend axis remains to fill.
