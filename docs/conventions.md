# Conventions

This document is the single source of truth for how code, files, and decisions are organised across the portfolio. Subagents read it on start. The root `CLAUDE.md` defers all "how" detail here.

---

## 1. TypeScript settings

Every project's `tsconfig.json` extends `tsconfig.base.json` at the repo root. The base config locks in:

- `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`.
- `strict: true` and the additional safety flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`.
- `verbatimModuleSyntax: true` — every type-only import must say `import type`.
- `isolatedModules: true`, `forceConsistentCasingInFileNames: true`.

Projects may override `lib` (e.g. for Node-only backends), `jsx`, or `paths`. They should not weaken `strict` family flags.

## 2. File naming

- **Files and folders:** `kebab-case` (`user-profile.tsx`, `lib/auth/session-store.ts`).
- **React components (the symbol, not the file):** `PascalCase` (`UserProfile`). File can be `user-profile.tsx` and export `UserProfile`.
- **Hooks:** `use-something.ts` exporting `useSomething`.
- **Types and interfaces:** `PascalCase`, no `I` prefix.
- **Constants:** `SCREAMING_SNAKE_CASE` for true constants only; prefer `as const` for inline literals.
- **Test files:** co-located, `foo.ts` + `foo.test.ts`. Playwright specs in `e2e/`.

## 3. Server vs Client components (Next 15)

- **Server by default.** No `'use client'` unless the file genuinely needs it.
- A file needs `'use client'` if it uses: `useState`, `useEffect`, `useRef`, event handlers (`onClick` etc.), browser-only APIs (`window`, `localStorage`), client-only libraries (Motion, Zustand, TanStack Query hooks).
- Keep the `'use client'` boundary as low in the tree as possible — push fetch/data work into the server parent.
- Server actions are preferred over client-side fetch for mutations that originate from the same page.

## 4. Tailwind v4 conventions

- Class order is enforced by `prettier-plugin-tailwindcss`. Do not fight it.
- Use theme tokens (CSS variables defined in `app/globals.css`) for colors, spacing, radius. Avoid arbitrary values (`bg-[#abc123]`) when a token exists.
- No inline `style` props except for genuinely dynamic values (computed transforms, measured dimensions). Static styles belong in classes.
- Component variants: `class-variance-authority` (cva) when a component has two or more axes of variation. Otherwise a couple of conditional classes inline is fine.

## 5. Forms

- `react-hook-form` with `zodResolver`.
- Zod schemas live in `src/lib/schemas/<entity>.ts`. In api-heavy projects, the **same file** is imported by the frontend and the backend — that is the contract.
- Inputs always have an associated `<label>`. Error messages are connected via `aria-describedby`.

## 6. Mock data

- `src/mocks/<entity>.ts` exports factory functions using faker.
- Always call `faker.seed(<number>)` at the top of the factory module to keep mock data deterministic across reloads.
- Mock data is **domain-coupled and per project** — never extracted to a shared package (see § 14).

## 7. Conventional Commits

```
<type>(<scope>): <subject>

[body]

[footer]
```

- **Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `style`, `ci`, `build`, `revert`.
- **Scope:** project name (`feat(mountain-club): ...`) or `root` for repo-level changes (`chore(root): bump pnpm`).
- **Subject:** imperative, lowercase, no trailing period, ≤ 72 chars.
- **Body** explains the why, not the what. Wrap at convenience, no hard limit.
- Enforced by commitlint via the `commit-msg` Husky hook.

## 8. Branch naming

- `feature/<scope>-<short-desc>` for new functionality.
- `fix/<scope>-<short-desc>` for bug fixes.
- `chore/<short-desc>` for repo / tooling work without a clear scope.
- `docs/<short-desc>` for docs-only changes.

`main` is the default and the only protected branch.

## 9. Pull requests

- PR template lives at `.github/PULL_REQUEST_TEMPLATE.md`.
- Required: linked project, category, screenshots/GIF for UI changes, the quality checklist ticked honestly.
- Local commands must pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## 10. Web-only vs api-heavy — hard decision criteria

Each project is one or the other. The planner picks and the architect ratifies in `DECISIONS.md` ADR-001.

A project is **api-heavy** if **any** of the following is true:

- It uses **WebSocket or SSE** for long-lived bidirectional communication.
- It runs **background jobs**, a queue, or a cron schedule.
- Its API is **consumed by a non-Next client** (mobile, third-party integration, CLI).
- It has a **heavy auth flow** — multi-tenant, OAuth provider, machine-to-machine tokens.
- It has **heavy domain logic** that benefits from being tested in isolation from the UI.

Otherwise the project is **web-only**: Next.js route handlers + server actions cover everything, no separate backend service.

## 11. Backend choice for api-heavy

Pick one of the following. The choice must serve **two** masters: (a) what fits this specific project, (b) portfolio backend variance.

- **Hono** — edge-friendly, type-safe RPC via `@hono/zod-validator`. Good for thin API gateways, edge functions, projects emphasising request-path performance.
- **Fastify** — mature Node ecosystem, schema-first via TypeBox or Zod plugins, strong plugin community. Good for traditional Node servers with heavier middleware needs.
- **NestJS** — opinionated, modular, decorator-heavy. Good for projects emphasising enterprise patterns, dependency injection, layered architecture.
- **Elysia / Bun** — Bun-native, end-to-end type-safe, great DX. Good for projects emphasising raw throughput and the Bun runtime story.

The architect records the choice and rationale in ADR-001 of the project.

## 12. Portfolio composition — hard requirement

By the time the portfolio reaches five projects, **at least 2–3 must be api-heavy**, and the api-heavy projects must cover **at least two distinct backend frameworks** from § 11 (ideally three — Hono + Fastify + one of NestJS / Elysia/Bun).

The planner enforces this when accepting a new project brief. If the next brief would violate the constraint, the planner recommends an api-heavy brief instead and asks the owner to confirm before producing PLAN.md.

Track composition in the table at the bottom of root `PROGRESS.md`.

## 13. Extraction triggers — when to add `packages/*`

The monorepo starts flat. We extract to `packages/*` only when a trigger fires:

- **Trigger A: third project arrives** AND we genuinely have divergence to consolidate → extract `packages/eslint-config` and `packages/tsconfig`. Do not pre-emptively extract before the third project exists. Do not extract if all three projects still share the root config without modification.
- **Trigger B: two specific projects need to share types** (e.g., a web client and its dedicated API) → extract `packages/<scope>-shared-types` scoped to that pair. Do not promote it to a portfolio-wide shared package.
- **Trigger C: CI cumulative build + test time exceeds 5 minutes** → add Turborepo for caching. Not before.

Each extraction is its own ADR in the project that prompted it (or `root` if portfolio-wide).

## 14. Do not share — the black list

These never leave the project they belong to, even when extraction would technically be possible:

- **Design tokens, theme variables, Tailwind preset.** Each project has its own visual personality. A shared theme would collapse the portfolio into one repeated identity — the opposite of what it exists to demonstrate.
- **Mock data.** Domain-coupled by definition. Sharing it would force fake homogenisation.
- **"Reusable" UI components** (Buttons, Cards, generic Inputs). Different projects intentionally demonstrate different design system approaches. If something feels reusable, it usually means it has not been customised enough yet.

If you (subagent or owner) catch yourself proposing one of these — stop. The project that wants it should build its own.

## 15. Animation library policy

Pick one per project. Do not stack:

- **Motion (ex-Framer Motion)** — React-first, state-driven transitions, layout animations, gesture work. Default choice for typical UI motion.
- **GSAP** — scroll-driven timelines, SVG path animation, complex choreography with many independently animated elements. Reach for it when Motion's declarative model fights you.
- **React Three Fiber + drei** — only when the project actually uses WebGL / 3D. Not for "fancy 2D backgrounds" — those should be CSS or Motion.

The planner names the choice in PLAN.md. The frontend-engineer respects it. Adding a second library mid-project requires an ADR.

## 16. Workflow

Every change, however small, follows:

```
spec → plan → tasks → implement → review → test → docs → commit
```

Each step has an owning subagent (see `CLAUDE.md` § 6 — the table). The main thread orchestrates; specialists do the work. Skipping a step requires a one-line justification in `AGENT_NOTES.md`. "It was a small change" is not a justification — small changes still get review and docs, just in proportion.
