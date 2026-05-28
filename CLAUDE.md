# CLAUDE.md — Operating Manual

Loaded by Claude Code at the start of every session in this repository. These rules supersede defaults.

## 1. Identity

This is the **portfolio monorepo of Jan Antczak** (`janek.antczak@gmail.com`). Each subfolder under `projects/*` is an independent showcase — frontend or fullstack — built to production quality. The portfolio's purpose is to demonstrate range and craft, not to ship one template repeated.

## 2. Communication

- **Conversations with the owner: Polish.** Always, in every session, in every channel.
- **Code, comments, commits, docs, READMEs, UI copy: English.**
- **No emojis anywhere** — neither in chat responses, nor commits, nor UI. Use icon libraries instead: `lucide-react`, `phosphor-icons`, `heroicons`.

## 3. Stack — hard defaults

Deviate only when the project genuinely requires it, and record the deviation in `projects/<name>/DECISIONS.md` (ADR format).

**Frontend:** Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · TanStack Query · Zustand · react-hook-form + Zod.
**Backend (api-heavy only):** Hono / Fastify / NestJS / Elysia · Drizzle ORM · PostgreSQL (or SQLite for showcase) · better-auth · Zod.
**Animation, picked per project (do not stack three libraries in one project):** Motion (React state-driven) · GSAP (scroll/timeline/SVG) · React Three Fiber + drei (genuine 3D).
**Tooling:** pnpm · Vitest · Playwright · Testing Library · ESLint · Prettier · Husky · lint-staged · commitlint · GitHub Actions · Lighthouse CI.

### Web-only vs api-heavy

Decision lives in `projects/<name>/PLAN.md` and is justified in `DECISIONS.md`. Hard criteria in [`docs/conventions.md`](./docs/conventions.md) § 10. **Portfolio constraint:** at minimum 2–3 of the projects must be api-heavy, with backend variance across `Hono`, `Fastify`, and optionally `NestJS` or `Elysia/Bun`. Planner enforces this when accepting a new project brief.

## 4. Quality bar — every project, no exceptions

- **Theming:** light + dark via CSS variables + `next-themes`, respecting `prefers-color-scheme`.
- **Responsive:** mobile-first, tested from 320 px upward.
- **Validation:** Zod schemas in `src/lib/schemas/`, shared between frontend and (where applicable) backend.
- **Tests:** Vitest unit + Playwright E2E on critical paths.
- **Docs:** per-project `README.md` with screenshots/GIF, stack, run instructions, demo link, key decisions.
- **Mock data:** `src/mocks/` with faker.js, seeded for determinism.
- **Accessibility:** WCAG 2.2 AA, full keyboard navigation, `prefers-reduced-motion` respected, contrast ≥ 4.5:1.
- **Performance:** Lighthouse ≥ 95 across all categories. Core Web Vitals green. `next/image` with AVIF.
- **SEO:** meta tags, OG image, JSON-LD, sitemap, robots.
- **Security:** CSP headers, rate limiting on any public backend, `.env.example` committed (never `.env`), input sanitization.

## 5. Design level

Showcases must be **arresting**, not "clean and minimal because that's safe". Every project earns its existence with one **wow moment** — something that holds a viewer for five seconds:

- A 3D element, scroll-driven animation, transitional view, generative texture, kinetic typography, creative hover state.

Look at, learn from, and explicitly reference work in [`docs/inspirations.md`](./docs/inspirations.md). The `designer-critic` subagent reviews UI milestones against those references with zero pochwał.

## 6. Workflow — for every change

```
spec → plan → tasks → implement → review → test → docs → commit
```

| Step          | Owner                                                  | Output                                             |
| ------------- | ------------------------------------------------------ | -------------------------------------------------- |
| **spec**      | owner (you, the user)                                  | One-line brief + audience + wow-moment hint        |
| **plan**      | `planner` subagent                                     | `projects/<name>/PLAN.md` + initial `DECISIONS.md` |
| **tasks**     | `planner`                                              | Task list (TaskCreate) derived from PLAN.md        |
| **implement** | `frontend-engineer` / `backend-engineer` / `architect` | Code, with `PROGRESS.md` updated each step         |
| **review**    | `designer-critic` (UI) + `reviewer` (code)             | Concrete defect list, applied                      |
| **test**      | `test-engineer`                                        | Vitest unit + Playwright E2E                       |
| **docs**      | `doc-writer`                                           | Per-project `README.md`, screenshots, CHANGELOG    |
| **commit**    | main thread                                            | Conventional Commit                                |

## 7. Subagents — always delegate

The eight subagents in `.claude/agents/` are not optional. **Use them.** The main thread orchestrates and integrates; specialists do the work. Default delegations:

- New project → `planner`
- Stack/architecture decision → `architect`
- UI work → `frontend-engineer`
- Server-side work → `backend-engineer`
- UI milestone review → `designer-critic`
- Test suite → `test-engineer`
- README / screenshots / changelog → `doc-writer`
- Final review before commit → `reviewer`

Every subagent reads `CLAUDE.md`, `docs/conventions.md`, and the active project's `PROGRESS.md` + `AGENT_NOTES.md` on start. Every subagent updates `PROGRESS.md` and `AGENT_NOTES.md` on end.

## 8. Per-project files — required from day one

```
projects/<name>/
├── PLAN.md          # Spec, tasks, success criteria
├── DECISIONS.md     # ADRs (architecture/stack choices with rationale)
├── PROGRESS.md      # State tracker — read on start, write on end
├── AGENT_NOTES.md   # Cross-agent context, gotchas, references
├── README.md        # End-user facing — pitch, stack, run, screenshots
├── CHANGELOG.md     # Keep a Changelog
└── ...              # Source, tests, mocks
```

## 9. Before / after any change

- **Before:** read `PROGRESS.md` of the active project. If missing, read the root `PROGRESS.md`.
- **After:** update `PROGRESS.md` with what was done and what's next. If a subagent took the action, the subagent updates it; the main thread does not duplicate.

## 10. Git & PRs

- **Convention:** [Conventional Commits](https://www.conventionalcommits.org/). Enforced by commitlint. Scope = project name or `root`.
- **Branches:** `feature/<scope>-<short>`, `fix/<scope>-<short>`, `chore/<short>`, `docs/<short>`.
- **PR template:** `.github/PULL_REQUEST_TEMPLATE.md`.
- **Do not push without explicit owner direction.** Repo currently has no remote.

## 11. Tooling reminders

- Node 22 LTS (see `.nvmrc`). pnpm ≥ 9 (currently 11.4).
- `pnpm install` once at root installs everything across the workspace.
- `pnpm -r <script>` runs across all projects that define the script.
- Husky `pre-commit` runs lint-staged; `commit-msg` runs commitlint. Failures block the commit — fix the underlying issue, do not bypass with `--no-verify`.
