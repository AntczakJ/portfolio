# Changelog

All notable changes to **atrium** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **Host at the portfolio root domain.** atrium is deployed at `atrium-demo.fly.dev`; the eventual decision to point a root domain at it (rather than the per-project demo subdomain) is still open.
- **Per-bay preview stills.** Each bay reserves a no-reflow media slot and the `Project` schema carries an optional `previewImage`; sourcing six optimised AVIF preview stills (captured, optimised, never the LCP) is the planned enrichment.

## [0.1.1] — 2026-06-10

### Added

- **Deployed to Fly.io.** Live at [atrium-demo.fly.dev](https://atrium-demo.fly.dev) (region `fra`, single Machine, Next.js 15 standalone — the razors-edge/apex web-only pattern). The bare `atrium` Fly app name was already taken, so the app is `atrium-demo` and the canonical origin (`NEXT_PUBLIC_SITE_URL`, baked at build time) is `https://atrium-demo.fly.dev`.
- **Deploy surface:** `Dockerfile` (three-stage: deps → Linux standalone build → slim runtime; the standalone is built inside the Linux image to dodge the Windows symlink-EPERM trace failure), `fly.toml` (single HTTP service on :3000, health check on `/`, shared-cpu-1x / 512 MB, region `fra`), `.dockerignore`, and `DEPLOY.md` (the runbook, including the flyctl 0.4.57 first-deploy gotcha — run from the project dir, not `--config` + `--app`). No `web/public` copy step: atrium has no static public dir (OG/robots/sitemap are dynamic routes, fonts are self-hosted by `next/font`).
- Verified live: `/` returns 200 with the exact strict CSP (no `unsafe-eval`); `/robots.txt`, `/sitemap.xml`, and `/opengraph-image` all resolve and reference the canonical origin.

### Changed

- **GitHub repo links flipped live.** The monorepo `github.com/AntczakJ/portfolio` was made public and `main` pushed, and the deployed build now bakes `NEXT_PUBLIC_GITHUB_BASE` (Dockerfile ARG + `fly.toml [env]`). This flips `REPO_LINKS_LIVE` true, so all six per-project repo affordances render as live `<a>` monorepo deep-links (`${GITHUB_BASE}/tree/main/projects/<slug>`) instead of the disabled "coming soon" controls — no component change, the single `GITHUB_BASE` seam. All six deep-links were verified to resolve HTTP 200 unauthenticated before the flip. The disabled-affordance fallback remains for any build that leaves the base unset.

## [0.1.0] — 2026-06-09

Initial build of atrium: the portfolio's front door — a single, scroll-driven cinematic landing page that presents the six showcase projects as the lobby of the whole portfolio, and is itself project number seven. Feature-complete for v1, reviewed (designer-critic and reviewer passes landed, all must-fix defects cleared), and fully tested. Web-only, no backend. Built and measured against the ambition of being the eventual portfolio root. (Deployed the following day — see [0.1.1].)

### Added

**Architecture (ADR-001 to ADR-003).**

- **ADR-001** — Stack flavour `web-only` (no backend, no API, no database; the only data is a typed in-repo module of six fixed project descriptors read at build time). Primary animation library GSAP + ScrollTrigger. Sovereign design tokens with an atrium-local six-signature-hue strategy (no token reuse from any sibling). The typed project-data model, with `demoUrl`s linked normally and `repoUrl`s derived from a single `GITHUB_BASE` constant — the repo has no git remote yet, so the GitHub links must be one flippable seam rather than scattered broken inline URLs. Portfolio composition: the api-heavy slots are already filled by `tape` (Elysia/Bun), `meld` (Hono/Node), `pulse` (NestJS), and `atlas` (Fastify), so slot 7 is a deliberate third web-only showcase — the landing page itself — with no open backend axis to fill.
- **ADR-002** — The animation posture (single-library GSAP; Motion is not a dependency; CSS owns all hover, active, theme-crossfade, mobile-drawer, and toast micro-interaction; binary scroll state is `IntersectionObserver`, not GSAP) and the GSAP / Next 15 App Router integration contract: a single `'use client'` registration module with a memoised, code-split `loadGsap()`; all GSAP through a post-paint `useGsapEffect` running inside `gsap.context()` for auto-revert cleanup; `gsap.matchMedia()` for the reduced-motion and mobile-simplified branches; the refresh-coordinator calling `ScrollTrigger.sort()` before `ScrollTrigger.refresh()` (load-bearing with seven pins — hero plus six bays); transform/opacity only with transient narrow `will-change`; the verified strict CSP with no `unsafe-eval`; and free-GSAP-core-only kinetic titles (real-DOM type plus `clip-path` plus `font-variation-settings`, no Club plugin).
- **ADR-003** — The `Project` Zod schema and `src/data/projects.ts` (six entries in canonical order, pitches and stacks sourced from the root README, real demo URLs, derived repo URLs, signature accent tokens, a fixed `year`). The `GITHUB_BASE` monorepo deep-link shape (`${GITHUB_BASE}/tree/main/projects/<slug>`) and the disabled-affordance-until-`REPO_LINKS_LIVE` presentation. The six `--bay-*` signature-hue token names and per-project mapping. The hero-descent → six-pinned-bays → directory scroll architecture and the three-tier degradation contract (full cinema / reduced-motion static directory / no-JS directory).

**Scaffold and foundation** (Phases 1 to 2).

- Next 15.5 App Router + React 19.2 + TypeScript strict + Tailwind v4 (CSS-first, no `tailwind.config.js`), dev and prod pinned to port 3080. next-themes with dark default and a `:root` dark-canonical token set so first paint is dark with no FOUC. No TanStack Query and no Motion — single-library GSAP, no data fetching. The razors-edge-verified strict CSP (`script-src 'self' 'unsafe-inline'`, no `unsafe-eval`) plus the full security-header set in `next.config.ts`, confirmed live against `next start`.
- The atrium-local GSAP integration modules (`src/lib/gsap/{register,use-gsap-effect,refresh-coordinator}.ts`) re-authored from the proven razors-edge shape: code-split `loadGsap()`, scoped `gsap.context()` cleanup, and the `sort()`-before-`refresh()` coordinator. GSAP is code-split off the initial bundle and fetched after hydration.
- Sovereign design tokens in `app/globals.css` (OKLCH): the architectural near-black + volumetric-warm-light palette, one neutral-warm brand accent for the wordmark and threshold, and six `--bay-*` signature hues (each with base, text-safe, and on-colour variants), plus the intentional light "architectural daylight" theme. Every text and accent pair contrast-verified to WCAG AA in both themes, including each signature hue.
- Type system: Bricolage Grotesque (variable display — a structural architectural grotesque, deliberately not a serif so atrium reads distinct from razors-edge) for the wordmark and per-bay titles, Inter (variable sans) for body and UI, both via `next/font` (self-hosted, CSP-clean) and both SIL OFL 1.1, with `font-variation-settings` hooks for the kinetic title resolves.
- The `Project` Zod schema (`src/lib/schemas/project.ts`, with `z.config({ jitless: true })` so the client-reachable parse stays eval-free under the strict CSP) and `src/data/projects.ts` (six entries validated at module load — a malformed entry fails the build). `src/lib/site-config.ts` with `SITE_URL`, `GITHUB_BASE`, and the `REPO_LINKS_LIVE` seam. `.env.example` documenting `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_GITHUB_BASE`.

**Chrome, the hero descent, and degradation** (Phase 3).

- The post-hero sticky header (brand mark, anchor nav to the six bays and the directory with `aria-current`, a Radix-dialog mobile drawer, a CSS theme toggle, a contact affordance) — both binary scroll states driven by `IntersectionObserver`, not GSAP. The designed footer (wordmark, compact six-link repeat, contact, the GitHub profile link on the same `REPO_LINKS_LIVE` seam, credits).
- The volumetric-warm-light background field and the reusable "shaft of light / threshold" transition component (the bay-to-bay connective tissue), pure CSS and SVG, no WebGL.
- The hero threshold and pinned GSAP descent: the `ATRIUM` wordmark in the shaft of light (real server DOM, the LCP element), scrubbed through a scale-and-thicken drop into a CSS-3D colonnade of light. CLS-safe transform pin; verified at ~60 fps.
- The three-tier degradation contract wired: the `prefers-reduced-motion` branch creates no pin or scrub and lands on the composed resting frame; the no-JS render is the full directory in real DOM.

**The six bays, the directory, and about** (Phase 4).

- The reusable project-bay component, rendered from a `Project`: the kinetic title (two layered real-text copies — a signature-hue ghost wiped by `clip-path` as the legible `<h2>` settles via a weight transition, no Club plugin), the pitch, a stack ribbon, an `api-heavy · <backend>` or `web-only (creative)` badge, a wow-moment note, and the two outward links (a live demo `<a>` and the disabled repo control) with disambiguated accessible names and `rel="noopener noreferrer"`.
- The six pinned bays wired into the scroll sequence through the refresh-coordinator; the six-pins-at-60fps spike resolved (all seven pins hold ~60 fps on desktop; the mobile and reduced-motion branches collapse the bays to a clean unpinned vertical stack).
- The directory (arrival) elevated to a first-class ruled index — all six projects with pitch, category badge, stack chips, and both links, under the portfolio range statement — built as the no-cinema, reduced-motion, and no-JS floor. The about section with the portfolio convictions and a `mailto:` plus the profile-link seam.

**Polish, review, and SEO** (Phase 5).

- Designer-critic review against the reference set (Olivier Larose, Stripe, Linear, Klim, Aristide Benoist), with the explicit "not a razors-edge re-skin" gate passed. All six must-fix defects resolved: the colonnade rebuilt as a genuine CSS-3D atrium (receding floor, two converging colonnades of standing columns, a clerestory glow at the vanishing point — CSS transforms only, no WebGL); the descent re-choreographed so a continuous camera Z-travel and a floor-light bloom run across the full pin (no dead frames); the light theme re-keyed to architectural daylight; each bay's hue made to light the room rather than trim it; the six hues re-spaced around the colour wheel; and the bay title raised above the supporting panels in the visual hierarchy.
- The primary SEO surface: per-page metadata, a designed Open Graph image (`next/og`, the wordmark-in-light composition), `robots.txt`, `sitemap.xml`, and `Person` plus `ItemList` JSON-LD over the six projects. Code review (reviewer) landed with an approve verdict and zero blockers.

**Tests** (Phase 6).

- 54 Vitest unit tests over the `Project` schema and the real `PROJECTS` config (six in canonical order, every demo URL the real deployment, every repo URL derived from `GITHUB_BASE`, the four-api-heavy / two-web-only split with correct backend badges, and the guard that `github.com` appears in exactly one source file).
- 18 Playwright E2E tests against the production build: the twelve outward affordances (six live demo links plus six disabled repo controls — not links, not tab stops), the reduced-motion static-directory path (zero pin-spacers, every title resolved, nothing frozen), the theme toggle in both themes with persistence and no FOUC, full keyboard reachability, the no-JS directory render, and the SEO surface.
- Lighthouse CI (`lighthouserc.json` plus the workflows) asserting >= 95 across all four categories with no scoped exception, plus a Core Web Vitals check. Verified locally against the production build on :3080: Performance 99 · Accessibility 100 · Best Practices 96 · SEO 100 (LCP ~0.9 s, CLS ~0.009, TBT ~10 ms).

**Docs** (Phase 7).

- This `CHANGELOG.md`, and the end-user-facing `README.md` (pitch, demo status, screenshots of the descent and the bays in both themes and on mobile, stack, run instructions, architecture notes, key decisions, and the v2 path), with a committed screenshot-capture script (`e2e/capture-readme-screenshots.mjs`).

[Unreleased]: https://keepachangelog.com/en/1.1.0/
[0.1.1]: https://keepachangelog.com/en/1.1.0/
[0.1.0]: https://keepachangelog.com/en/1.1.0/
