# Portfolio — Global Progress

> Read this file before any change. Update it after.

## State

- **Projects:** 2 (`tape` — implement phase Phase 3.2 landed; `meld` — planned 2026-05-31)
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

## In progress

- Project 1 (`tape`) — implement phase, Phase 3.2 (cursor + crosshair + cell tooltip + Follow-live affordance) landed 2026-05-30; Phase 3.3..3.6 and Phase 1 Rust-side follow-ons (1.5 / 1.5c / 1.5d) continue.
- Project 2 (`meld`) planned — handing to `architect` for ADR-002 (Hono WebSocket adapter choice) then ADR-003 (Yjs snapshot persistence strategy), then `frontend-engineer` + `backend-engineer` for parallel implementation of v1 scope.

## Next

- [ ] `architect` authors **ADR-002** (Rust ↔ Elysia bridge), **ADR-003** (persistence schema), **ADR-004** (WebSocket frame contract) in `projects/tape/DECISIONS.md`.
- [ ] `backend-engineer` scaffolds Bun + Elysia under `projects/tape/server/` (PLAN.md task 1.1).
- [ ] `frontend-engineer` scaffolds Next.js 15 + Tailwind v4 under `projects/tape/web/` (PLAN.md task 2.1).

## Portfolio composition tracker

Per `docs/conventions.md` § 12 — minimum 2–3 `api-heavy` projects with backend variance.

| Slot | Project | Category  | Backend       |
| ---- | ------- | --------- | ------------- |
| 1    | tape    | api-heavy | Elysia (Bun)  |
| 2    | meld    | api-heavy | Hono (Node)   |
| 3    | —       | —         | —             |
| 4    | —       | —         | —             |
| 5    | —       | —         | —             |

Planned (pre-allocated, not yet ratified):

- Slot 3 — AI agentic tool — api-heavy — NestJS.
- Slot 4 — web-only creative (R3F + GSAP).
- Slot 5 — edge-native voice/multimodal (Motion).
- Slot 6 (optional) — WebGPU + TSL.
