# Portfolio — Global Progress

> Read this file before any change. Update it after.

## State

- **Projects:** 3 (`tape` — implement phase Phase 3.2 landed; `meld` — v1 shipped, demo live at https://meld-demo.fly.dev; `razors-edge` — built 2026-06-03, web-only dark-luxe barbershop showcase, reviewer GREEN, 53 unit + 18 E2E pass, not yet deployed)
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
| 4    | —           | —                   | —            |
| 5    | —           | —                   | —            |

Composition status: 3 projects, 2 api-heavy (Elysia + Hono = two distinct backends). The § 12 constraint (2–3 api-heavy, ≥ 2 backends, evaluated at the 5-project mark) is satisfied at this point. The **NestJS api-heavy slot remains open** (reserved for the planned slot-4 AI agentic tool) — razors-edge being web-only was the owner's deliberate call, not drift. **Planner watch:** if the next brief is also web-only, flag it and recommend an api-heavy / NestJS brief to keep the 2–3 api-heavy target reachable by project 5.

Planned (pre-allocated, not yet ratified):

- Slot 4 — AI agentic tool — api-heavy — NestJS.
- Slot 5 — edge-native voice/multimodal (Motion).
- Slot 6 (optional) — WebGPU + TSL.
