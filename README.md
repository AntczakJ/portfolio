# Portfolio — Jan Antczak

Production-grade showcase monorepo. Each subfolder in `projects/*` is an independent, self-contained project — frontend or fullstack — built to a single quality bar: accessible, performant, tested, documented, and designed to stop you for five seconds.

## Projects

| Name                                     | Pitch                                                                                                                                                                                                                 | Stack                                                                                                                                    | Demo                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`tape`](./projects/tape/)               | Production-grade real-time orderflow visualizer for crypto perpetual futures: a live Canvas2D footprint chart, CVD pane, tape strip, and replay, with a Rust hot-path aggregation worker behind a MessagePack bridge. | Next 15 + React 19 + Tailwind v4 + Elysia (Bun) + Rust worker + Postgres + Drizzle (api-heavy)                                           | [tape-demo.fly.dev](https://tape-demo.fly.dev)               |
| [`meld`](./projects/meld/)               | Local-first collaborative whiteboard with sub-100 ms presence and CRDT auto-merge on reconnect.                                                                                                                       | Next 15 + React 19 + Tailwind v4 + Hono (Node 22) + Hocuspocus + Yjs + Postgres + Drizzle                                                | [meld-demo.fly.dev](https://meld-demo.fly.dev)               |
| [`razors-edge`](./projects/razors-edge/) | Cinematic dark-luxe barbershop marketing site with a scroll-driven blade-sweep hero and a fully mocked multi-step booking flow.                                                                                       | Next 15 + React 19 + Tailwind v4 + GSAP (scroll) + Motion (wizard) + TanStack Query + Zod (web-only, no backend)                         | [razors-edge-demo.fly.dev](https://razors-edge-demo.fly.dev) |
| [`pulse`](./projects/pulse/)             | Real uptime monitor: scheduled probes, an SSE-pushed live status board, a self-driving incident state machine, signed webhook alerts, and a public redacted status page.                                              | Next 15 + React 19 + Tailwind v4 + uPlot + Motion + NestJS (Node 22) + BullMQ + Redis + Postgres + Drizzle (api-heavy)                   | [pulse-demo-web.fly.dev](https://pulse-demo-web.fly.dev)     |
| [`apex`](./projects/apex/)               | Premium car-rental marketing site with a real WebGL 3D car configurator (live colour + wheel swaps, four-tier degradation) and a fully mocked multi-step reservation flow.                                            | Next 15 + React 19 + Tailwind v4 + React Three Fiber + drei (3D) + GSAP (scroll) + TanStack Query + Zustand + Zod (web-only, no backend) | coming soon                                                  |

## Philosophy

- **Polish over breadth.** Every project ships with a "wow moment" — 3D, scroll-driven animation, transitional view, generative element. Minimalism is not a default; it is a decision.
- **Variance is the point.** Different projects use different backends, different design systems, different animation strategies. The portfolio demonstrates range, not a single template repeated.
- **Quality is non-negotiable.** Light + dark, mobile-first from 320 px up, WCAG 2.2 AA, Lighthouse ≥ 95 across categories, shared Zod schemas front-to-back, tests on critical paths.

Full policy lives in [`CLAUDE.md`](./CLAUDE.md) and [`docs/conventions.md`](./docs/conventions.md). Visual references in [`docs/inspirations.md`](./docs/inspirations.md).

## Stack defaults

**Frontend:** Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · TanStack Query · Zustand · react-hook-form + Zod.
**Backend (when needed):** Hono / Fastify / NestJS / Elysia · Drizzle ORM · PostgreSQL · better-auth · Zod.
**Animation (per project):** Motion (React state-driven) · GSAP (scroll/timeline/SVG) · React Three Fiber + drei (3D).
**Tooling:** pnpm · Vitest · Playwright · Testing Library · ESLint · Prettier · Husky · commitlint · GitHub Actions · Lighthouse CI.

Stack flavour (web-only vs api-heavy) is decided per project — see [`docs/conventions.md`](./docs/conventions.md) § 10.

## Repository structure

```
portfolio/
├── .claude/agents/        # Subagents (planner, architect, FE, BE, designer-critic, test, doc, reviewer)
├── .github/               # CI, Lighthouse, Dependabot, PR template
├── .husky/                # pre-commit (lint-staged), commit-msg (commitlint)
├── docs/                  # conventions, inspirations
├── projects/              # Individual showcases (one folder each)
├── CLAUDE.md              # Operating manual (loaded by Claude Code every session)
├── PROGRESS.md            # Global portfolio tracker
└── package.json           # Monorepo root (pnpm workspace)
```

## Running locally

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

To work on a single project: `cd projects/<name> && pnpm dev`.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/). Enforced by commitlint.
- **Branches:** `feature/<scope>-<short>`, `fix/<scope>-<short>`, `chore/<short>`.
- **PRs:** template under `.github/PULL_REQUEST_TEMPLATE.md`.

## Author

Jan Antczak · [janek.antczak@gmail.com](mailto:janek.antczak@gmail.com)

## License

[MIT](./LICENSE) © 2026 Jan Antczak
