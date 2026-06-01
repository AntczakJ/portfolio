# meld — web

Next.js 15 frontend for [meld](../README.md), a local-first collaborative whiteboard with sub-100 ms presence via Yjs and conflict-free merges via the y-websocket protocol.

This package is the client of the [`meld-server`](../server) Hono + Hocuspocus backend. The two halves are wired with Hono RPC (Task 2.2) for end-to-end type-safe HTTP, and the canonical `y-websocket` `WebsocketProvider` for the CRDT data path (Task 2.5).

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript strict
- Tailwind CSS v4 (CSS-first, `@theme` block, no `tailwind.config.js`)
- next-themes (light canonical + dark secondary, attribute=`data-theme`)
- TanStack Query (server state) · Zustand (UI state, added later)
- react-hook-form + Zod (forms, added later)
- Motion (animation chrome, added in Phase 3.1 — drawing surface itself is hand-rolled Canvas2D)

See `../DECISIONS.md` for ADR-001 (stack + CRDT), ADR-002 (Hono + Hocuspocus integration), ADR-003 (Yjs snapshot persistence) and `../PLAN.md` for the full task list.

## Run

```bash
# from the repo root
pnpm install
pnpm -F meld-web dev
```

Open <http://localhost:3000>.

## Configuration

Copy `.env.example` to `.env.local` and adjust if your backend lives somewhere other than `localhost:3001`.

```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

`.env` files are never committed.

## Scripts

| Script           | Purpose                                |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | Next dev server on port 3000           |
| `pnpm build`     | Production build                       |
| `pnpm start`     | Production server (after `build`)      |
| `pnpm lint`      | ESLint via `next lint`                 |
| `pnpm typecheck` | `tsc --noEmit` against `tsconfig.json` |
| `pnpm test`      | Vitest (suites added later)            |

## Theme tokens

Tokens are defined in `src/app/globals.css` inside the Tailwind `@theme` block. The light "paper canvas" palette is canonical; the dark palette overrides via `:root[data-theme='dark']`. The brand accent is a confident violet at `oklch(0.55 0.18 285)` that doubles as slot 0 of the 8-slot awareness palette (assigned per session to remote-cursor color). Per `docs/conventions.md` § 14, these tokens are sovereign to meld and never reused from another project.

## Accessibility

- Visible focus ring on every interactive element (`:focus-visible` outline using `--color-focus-ring`); no `outline: none` anywhere.
- `prefers-reduced-motion` collapses all CSS animations and transitions to ~0 ms — the Motion-based presence and avatar-stack components added in Phase 3 also gate on `useReducedMotion()`.

## What is here in v0

Only the scaffold: theme provider, query provider, landing page (brand mark + pitch + CTA + three capability lines). The board canvas, presence cursors, awareness avatar stack, and offline/reconnect transition land in Phases 2.4–3.6. The landing is intentionally spare so the wow moment can speak for itself on the board route.

## Reference

- [`../PLAN.md`](../PLAN.md) — full spec and task list
- [`../DECISIONS.md`](../DECISIONS.md) — ADRs
- [`../AGENT_NOTES.md`](../AGENT_NOTES.md) — cross-agent context
- [Root `CLAUDE.md`](../../../CLAUDE.md) and [`docs/conventions.md`](../../../docs/conventions.md) — portfolio-wide rules
