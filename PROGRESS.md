# Portfolio — Global Progress

> Read this file before any change. Update it after.

## State

- **Portfolio status: 8 projects — ALL shipped + deployed to Fly.io, including `nocturne` (slot 8), deployed 2026-06-14.** The backend-variance target is met: four api-heavy projects across four distinct backends (tape Elysia/Bun, meld Hono/Node, pulse NestJS/Node, atlas Fastify/Node) plus FOUR web-only creative showcases (razors-edge, apex, atrium the landing page, and nocturne the generative GPU piece). atlas (slot 6, Fastify) completes the backend-variance story; atrium (slot 7) is the front door; nocturne (slot 8) is the creative-coding / generative-graphics showcase.
  - `tape` — v1 shipped + deployed, api-heavy orderflow visualizer (Elysia/Bun + Rust worker), slot 1, demo at https://tape-demo.fly.dev
  - `meld` — v1 shipped + deployed, api-heavy local-first whiteboard (Hono/Node + Yjs), slot 2, demo at https://meld-demo.fly.dev
  - `razors-edge` — v1 shipped + deployed, web-only dark-luxe barbershop showcase (GSAP), slot 3, demo at https://razors-edge-demo.fly.dev
  - `pulse` — v1 shipped + deployed, api-heavy uptime monitor (NestJS + BullMQ), slot 4, demo at https://pulse-demo-web.fly.dev
  - `apex` — v1 shipped + deployed, web-only EV car-rental showcase (R3F 3D configurator), slot 5, demo at https://apex-rentals.fly.dev
  - `atlas` — v1 shipped + deployed, api-heavy live geospatial fleet tracking (Fastify + WebSocket + MapLibre, keyless Protomaps basemap), slot 6, demo at https://atlas-ops.fly.dev
  - `atrium` — v1 shipped + deployed, web-only GSAP scroll-driven portfolio landing page / lobby, slot 7, demo at https://atrium-demo.fly.dev (the bare `atrium` Fly name was taken). Lighthouse 99/100/96/100, Vitest 54/54 + Playwright 18/18 green.
  - `nocturne` — **v1 shipped + deployed (2026-06-14)**, web-only creative slot 8: a GPU audio-reactive generative particle experience, demo at https://nocturne-demo.fly.dev. GPGPU FBO ping-pong curl-noise field (default 262k particles, runtime-adaptive to 1M), Web Audio FFT reactivity (procedural built-in source + mic + file upload), cinematic post (bloom/vignette/chromatic-aberration), four-tier degradation (poster fallback), auto-dimming cinematic HUD, /about, SEO. R3F single-family + custom GLSL, no GSAP/Motion, eval-free CSP (tighter than apex). Full pipeline complete (planner → architect → 3 FE passes → designer-critic [§ 14 vs-apex PASS] → reviewer [APPROVE, 0 blockers] → must-fix → test-engineer → doc-writer → deploy). 123 Vitest + 29 Playwright E2E green; Lighthouse /about 100/100/96/100. Dev port 3100.
- **Scaffold:** done (2026-05-28)
- **CI:** green
- **First commit:** done (repo has full history)

## Deployment status (INTERNAL — 2026-06-06)

All eight demos are deployed to Fly.io. **The Fly apps are currently STOPPED to control cost; they are restartable on request.** This pause is internal and cost-driven — it is NOT reflected in any public README or CHANGELOG (the demo links there stay normal/live by deliberate owner policy).

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
| atrium      | `atrium-demo` (web only, no DB)                                                                                      | auto-starts on URL hit; the bare `atrium` Fly name was taken                                                              |
| nocturne    | `nocturne-demo` (web only, no DB)                                                                                    | auto-starts on URL hit; scale-to-zero (min 0); WebGL runs client-side on the visitor's GPU                                |

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

- [x] Seventh project — **`atrium`** (slot 7) — the portfolio landing page / lobby. Full pipeline complete 2026-06-09: planner → architect (ADR-002 GSAP single-library no-Motion + Next-15 integration, ADR-003 data model + `GITHUB_BASE` + scroll architecture) → frontend-engineer (Phases 1–4: scaffold, sovereign six-hue tokens, hero descent through type into a CSS-3D atrium of light, six pinned project bays, directory, about, footer) → designer-critic (re-skin gate vs razors-edge PASSED; 2 blocker + 4 high defects, all fixed) → reviewer (APPROVE, 0 blockers) → SEO surface (metadata, OG image, robots, sitemap, JSON-LD) → test-engineer (Vitest 54/54, Playwright 18/18, Lighthouse 99/100/96/100) → doc-writer (README + CHANGELOG + screenshots) → **deploy to Fly (2026-06-10, https://atrium-demo.fly.dev — single-Machine Next standalone, the razors-edge/apex web-only pattern; deploy surface Dockerfile/fly.toml/.dockerignore/DEPLOY.md added)** → **`GITHUB_BASE` flip DONE (2026-06-10): the monorepo `github.com/AntczakJ/portfolio` made public + `main` pushed, `NEXT_PUBLIC_GITHUB_BASE` baked into the build, so the six per-project repo links are live monorepo deep-links — verified 200 unauthenticated**. Web-only, GSAP-only. **Nothing remaining except the optional v2 backlog (root-domain hosting decision; per-bay preview stills).**

## In progress

- **`nocturne` (slot 8) — PLANNED, awaiting architecture.** Planner authored `projects/nocturne/PLAN.md` + `DECISIONS.md` (ADR-001) + `PROGRESS.md` + `AGENT_NOTES.md` (2026-06-14). Web-only creative; composition tracker updated (slot 8, web-only creative, backend "—"). Next: the `architect` authors ADR-002/003/004 (GPGPU+R3F/Next+tiers · Web Audio pipeline · reduced-motion+degradation+poster hand-off), then `frontend-engineer` Phase 1. The other seven projects are v1-complete and deployed.

## Next

- [x] Flip `GITHUB_BASE` — DONE 2026-06-10. The monorepo `github.com/AntczakJ/portfolio` was made public, `main` pushed (deep-links verified 200 unauthenticated), and `NEXT_PUBLIC_GITHUB_BASE` baked into the atrium build (Dockerfile ARG + `fly.toml [env]`); the six per-project repo affordances are now live monorepo deep-links across atrium. (Other projects' `repoUrl` strategies are unaffected — this seam is atrium-only.)
- [ ] Optional: per-project v2 backlogs (recorded in each project's CHANGELOG / PLAN under deferred items). atrium's: root-domain hosting decision + per-bay preview stills (`CHANGELOG.md` `[Unreleased]`).
- [ ] On request: restart the Fly demos per the Deployment status table above (atrium is web-only — auto-starts on URL hit).

## Portfolio composition tracker

Per `docs/conventions.md` § 12 — minimum 2–3 `api-heavy` projects with backend variance.

| Slot | Project     | Category                | Backend      |
| ---- | ----------- | ----------------------- | ------------ |
| 1    | tape        | api-heavy               | Elysia (Bun) |
| 2    | meld        | api-heavy               | Hono (Node)  |
| 3    | razors-edge | web-only (creative)     | — (mocked)   |
| 4    | pulse       | api-heavy               | NestJS       |
| 5    | apex        | web-only (creative)     | — (mocked)   |
| 6    | atlas       | api-heavy               | Fastify      |
| 7    | atrium      | web-only (landing page) | — (none)     |
| 8    | nocturne    | web-only (creative)     | — (none)     |

Composition status: 7 shipped + deployed projects, including **atrium (slot 7), deployed 2026-06-10 at https://atrium-demo.fly.dev** — the portfolio landing page / lobby (web-only, GSAP scroll-driven; full build+review+test+docs+deploy pipeline complete; presents the six showcases as the front door). **4 api-heavy across FOUR distinct backends** (tape Elysia/Bun + meld Hono/Node + pulse NestJS/Node + atlas Fastify/Node) + 2 web-only creative (razors-edge, apex). The § 12 constraint (2–3 api-heavy, ≥ 2 backends — ideally Hono + Fastify + one of NestJS / Elysia) is **fully satisfied and the backend-variance story is COMPLETE**: atlas (slot 6) claims the last unused § 11 backend (Fastify), so the portfolio demonstrates all four cutting-edge Node/Bun backends (thin-and-fast Elysia/Bun · multi-runtime-edge Hono · opinionated-enterprise NestJS · focused-performance Fastify). The two web-only creative slots (razors-edge dark-luxe marketing, apex 3D-configurator) round out the range. No backend axis remains to fill.
