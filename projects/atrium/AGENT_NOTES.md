# atrium — Agent Notes

> Append-only cross-agent context. Every subagent reads on start, appends on end.

## Gotchas

- **The repo has NO git remote yet (CLAUDE.md § 10) — GitHub links cannot be real today.** Every project's `repoUrl` MUST derive from a single `GITHUB_BASE` constant (env-overridable `NEXT_PUBLIC_GITHUB_BASE`, documented placeholder) in `src/data/projects.ts` / `src/lib/site-config.ts`. **Never hardcode a `github.com/...` URL inline in a component.** Flipping `GITHUB_BASE` to the real owner/repo the instant a remote exists must make all six repo links real with no other change. The architect picks the URL shape in ADR-003 (monorepo `${GITHUB_BASE}/tree/main/projects/<slug>` vs split `${GITHUB_BASE}-<slug>`). How the placeholder _presents_ before it is real (a live link to the placeholder vs a quietly-disabled "repo" affordance) is an open design call — decide at Task 4.1 and record it here. Whatever the choice, it must never look like a broken link to a viewer.
- **Demo links are NORMAL/live — never surface the internal "Fly stopped to control cost" status anywhere public.** The six `demoUrl`s are the real public Fly URLs (`tape-demo.fly.dev`, `meld-demo.fly.dev`, `razors-edge-demo.fly.dev`, `pulse-demo-web.fly.dev`, `apex-rentals.fly.dev`, `atlas-ops.fly.dev`). The Fly apps are currently stopped internally to control cost but **auto-start on URL hit / restart on request**, so the public face stays normal. Do NOT add any "demo may be sleeping / cold start" wording. (Root `PROGRESS.md` "Deployment status" has the internal restart procedure if a demo needs a manual kick — internal only.)
- **GSAP integration: reuse the razors-edge contract, do not rediscover it.** razors-edge already solved GSAP-in-Next-15-App-Router in this codebase. Carry the lessons (ADR-002 will formalise): all GSAP through `useGSAP()` from `@gsap/react` (never raw `useLayoutEffect` + `gsap.context()`); register plugins once in a single `'use client'` module; never import ScrollTrigger into a Server Component; reduced-motion + responsive via `gsap.matchMedia()` inside the `useGSAP` callback; and — critically for a multi-pinned-section page — **async-loaded ScrollTriggers must refresh via a shared coordinator that calls `ScrollTrigger.sort()` BEFORE `ScrollTrigger.refresh()`**, never in isolation, or a downstream pinned bay measures its `start` against a document missing an upstream pin's spacer and pins too early. atrium has a hero pin + six bay pins — this ordering rule is load-bearing here. See razors-edge `src/lib/gsap/refresh-coordinator.ts` and its AGENT_NOTES "Gallery early-pin bugfix" entry.
- **CSP posture is fixed (the razors-edge result): `script-src 'self' 'unsafe-inline'`, NO `unsafe-eval`, `style-src 'self' 'unsafe-inline'`.** GSAP core + ScrollTrigger + `@gsap/react` do NOT need `unsafe-eval` (proven in razors-edge). Next 15's inline bootstrap forces script `'unsafe-inline'` (a bare `script-src 'self'` blocks hydration); GSAP's inline transform writes + Tailwind force style `'unsafe-inline'`. Verify the smoke ScrollTrigger under **`next build && next start`**, NOT `next dev` (the meld trap: `next dev` cannot run under a CSP forbidding `unsafe-eval`). Set the full header set too (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`). The v1.1 nonce-hardening debt (to drop both inline grants) is the same carried debt razors-edge noted.
- **`prefers-reduced-motion` must FULLY neutralise the scroll choreography to a static, readable page (PLAN success criteria — explicit owner requirement).** No pin, no scrub, no descent, no parallax — and critically, **nothing frozen mid-transition.** The reduced-motion path renders the directory floor top-to-bottom with every project and every link present and legible. Design the directory section as the no-cinema/no-JS floor FIRST (it is also the no-JS render target), so reduced-motion is "render the floor, skip the pins," not a second codebase. razors-edge's designer-critic flagged exactly this trap: a reduced-motion path must land on a CLEAN composed frame, never a frozen mid-transition state.

## Architect — Phase 0 (ADR-002 + ADR-003) verified facts + follow-ups (2026-06-09)

- **[RESOLVED — ADR-002] Motion is OUT. atrium is single-library GSAP.** No `motion`/`framer-motion` dependency. All scroll/pin/scrub/timeline = GSAP; all hover/active/theme-crossfade/mobile-drawer/toast = CSS (`transition`, `data-state`, Radix `data-state` keyframes for the sheet, `prefers-reduced-motion`). No presence-heavy surface exists to justify Motion. Adding it in v2 needs its own ADR naming the specific interaction (§ 15). Binary scroll _state_ (header backdrop flip, `aria-current`) is `IntersectionObserver`, NOT GSAP — that is state observation, not an ADR-002 violation (razors-edge precedent).
- **[RESOLVED — ADR-002] GSAP integration = re-author the razors-edge shape as atrium-local `src/lib/gsap/{register,use-gsap-effect,refresh-coordinator}.ts`.** `register.ts` = memoised `loadGsap()` dynamic-import + `registerPlugin(ScrollTrigger, useGSAP)` once (code-split off the initial bundle — protects the home-route Lighthouse budget). `use-gsap-effect.ts` = post-paint `useEffect` running setup inside `gsap.context(..., scope.current)` (auto-revert cleanup, StrictMode-safe); hero scrub uses `{ idle: true }`, item-hiding bay reveals use the non-idle variant. **THE refresh-coordinator rule is load-bearing here (7 pins: hero + 6 bays):** never call `ScrollTrigger.refresh()` in isolation — every setup calls `requestGlobalRefresh()`, which debounces to one coordinated refresh that calls `ScrollTrigger.sort()` BEFORE `refresh()` so every upstream pin's spacer is applied before each downstream bay is measured (else bays pin too early — the razors-edge gallery-early-pin bug ×6). These stay atrium-local (NOT a shared package — § 13 has not fired).
- **[RESOLVED — ADR-002] CSP string is fixed (razors-edge-verified): `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.** NO `unsafe-eval` (GSAP core + ScrollTrigger + `@gsap/react` are clean). Both inline grants are required (Next inline bootstrap + next-themes guard for script; Next/Tailwind + GSAP inline transforms for style) — a conscious, documented relaxation, NOT drift; v1.1 nonce-hardening debt drops both. Full header set too (HSTS, nosniff, Referrer-Policy, X-Frame-Options: DENY). **Verify the smoke ScrollTrigger fires ZERO CSP violations under `next build && next start`, NOT `next dev`** (the meld trap). NOTE: razors-edge's `D-CSP-1` zod-`new Function` eval-probe does NOT apply to atrium — atrium's only Zod parse runs at module load (build time), no client-runtime validator in a render path.
- **[RESOLVED — ADR-002] Kinetic titles = free GSAP core only, NO Club plugins.** Real-DOM type + CSS (`font-variation-settings` weight/width settle, `clip-path` wipe from signature hue → legible title) + GSAP transform/opacity. SplitText/MorphSVG are out; one needs its own ADR. Real text keeps SEO/SR/no-JS complete.
- **[RESOLVED — ADR-003] `GITHUB_BASE` shape = monorepo R1: `${GITHUB_BASE}/tree/main/projects/<slug>`.** In `src/lib/site-config.ts`: `GITHUB_BASE = process.env.NEXT_PUBLIC_GITHUB_BASE ?? GITHUB_PLACEHOLDER` + `REPO_LINKS_LIVE = GITHUB_BASE !== GITHUB_PLACEHOLDER`. **Placeholder is `https://github.com/janantczak/portfolio` — OWNER MUST CONFIRM/CORRECT the owner/repo slug** (harmless if wrong: the U2 affordance never navigates to it). Split-repo R2 (`${GITHUB_BASE}-<slug>`) is the documented migration if the owner later publishes per-project repos — change only the `repoUrl` derivation.
- **[RESOLVED — ADR-003] No-remote repo presentation = U2: a disabled, `aria-disabled="true"`, non-navigating affordance** (NOT an `<a href>` to a 404) with an accessible "repository link available once published"-style label, while `REPO_LINKS_LIVE` is false. The DEMO link is always a live `<a>`. When `NEXT_PUBLIC_GITHUB_BASE` is set to a real base, `REPO_LINKS_LIVE` flips true and every repo affordance becomes a live `<a href={repoUrl}>` with NO other change — the single seam. **Task 4.1 owns the final styling so it reads as intentional ("coming soon"), never as a broken button — record the styling decision here.**
- **[RESOLVED — ADR-003] Six signature-hue token NAMES + mapping fixed** (values are Task 2.1): `--bay-tape` (slate/cyan), `--bay-meld` (collaborative warm), `--bay-razors-edge` (brass/amber), `--bay-pulse` (status green/amber), `--bay-apex` (premium chrome/cool blue), `--bay-atlas` (control-room green). Each ships base + text-safe + on-color variants (the razors-edge two-treatment lesson) so text clears ≥4.5:1 and UI ≥3:1 in BOTH themes. **Contrast wins over literal evocation** — re-tune a hue that fails light-theme contrast.

## Decisions to revisit

These are assumptions the planner left implicit or under-determined in PLAN.md / ADR-001 that downstream agents should actively challenge rather than inherit:

- **[RESOLVED — ADR-002] Whether Motion is in the project at all.** Resolved to GSAP-only — see the Architect Phase 0 block above. Motion is not a dependency.
- **[RESOLVED — ADR-003] `GITHUB_BASE` repo-URL shape.** Resolved to monorepo R1 (`tree/main/projects/<slug>`) with the U2 disabled-affordance presentation — see the Architect Phase 0 block above. Split-repo R2 documented as the migration.
- **[CARRIED — Task 4.2 spike] Six pinned bays may be too heavy.** ADR-002 carries the planner's flag: verify six sequential pins hold 60 fps on a mid-tier laptop AND mobile before over-investing. Documented fallback if not: fewer/lighter pins (pin the hero, scroll-reveal the bays) — the "tour" reading matters more than literally pinning all six. The `matchMedia` mobile branch already collapses the pins to a clean vertical stack on phones.
- **The six signature hues — exact values + per-bay mapping.** The strategy (atrium-local tokens evoking each project, NOT imported — § 14) is fixed; the specific OKLCH values, and which hue maps to which project, are a design call for Task 2.1 + the designer-critic. They must read as evoking the project (tape slate/cyan, atlas control-room green, apex premium chrome/blue, meld collaborative warm, pulse status green/amber, razors-edge brass) while clearing ≥ 4.5:1 as text / ≥ 3:1 as UI in BOTH themes. If a literal evocation fails contrast in the light theme, contrast wins and the hue is re-tuned (the razors-edge brass-vs-contrast lesson).
- **Per-bay preview stills (Task 4.5) — include or defer.** Optional, non-blocking: a small AVIF preview of each showcase enriches the bays but is a real asset-sourcing task (capture + optimise + provenance) and must NEVER be the LCP. The type-and-light composition is the v1 floor; if asset-sourcing blocks, ship without and note it as v2. Do not let screenshot-sourcing gate the page.
- **Whether the wordmark-title kinetic resolves need a Club GSAP plugin.** Assume NO (free GSAP only). Reuse the razors-edge no-Club-plugin technique: real-DOM type + CSS (`clip-path`/`font-variation-settings`) + GSAP transforms, so the titles stay real text (SEO/SR/no-JS complete). A Club plugin (SplitText/MorphSVG) requires its own ADR.
- **Map of `atrium`'s eventual hosting/routing as the portfolio ROOT (see Cross-cutting).** v1 ships as a self-contained `projects/atrium/` app like every sibling; it does NOT restructure the monorepo. The "this is the conceptual root landing page" intent is recorded below for a future hosting decision — do not attempt the root-routing restructure in v1.

## Cross-cutting concerns

- **atrium is INTENDED as the eventual portfolio root landing page, but v1 does NOT restructure the monorepo.** It ships as a self-contained `projects/atrium/` Next 15 app, consistent with every other project, deployed to its own Fly app (the razors-edge single-Machine pattern). A future decision about hosting it at the portfolio's conceptual root (a root domain pointing at atrium, or a routing/redirect layer) is out of v1 scope and is recorded here so a later agent/owner picks it up deliberately. Design the metadata/SEO/JSON-LD AS IF this is the portfolio's primary front page (it is), but do not move files or rewire the workspace to force a literal root.
- **Sovereign design tokens — NO reuse from any sibling project** (`docs/conventions.md` § 14, ADR-001). Build the architectural near-black + volumetric-light palette and the six atrium-local signature hues from scratch in `app/globals.css`. Do NOT import razors-edge's brass, apex's palette, tape's slate/cyan, etc. The six hues EVOKE the projects but are atrium's own tokens. A shared theme would collapse the "variance is the point" thesis this page exists to prove.
- **Do NOT let atrium read as a `razors-edge` re-skin.** Two GSAP scroll showcases in one portfolio is the owner's explicit, accepted call — but they MUST be visually distinct. razors-edge = warm brass-on-black, photographic, a single blade-slice hero cut. atrium = cooler architectural light, type-and-light (not photographic), a multi-stage descent + a six-bay sequence + six signature hues. The designer-critic has an explicit re-skin sign-off gate (PLAN Task 5.1). Motif, palette strategy, and structure must all differ.
- **This is the most-judged page — Lighthouse ≥ 95 ×4 with NO scoped exception, and CWV green.** It is the page a recruiter opens first. The surface is CSS/SVG light + parallax (no WebGL, no heavy photography dependency); animation is transform/opacity-only, rAF-driven scrub, transient narrow `will-change`. The directory floor keeps the page fast + complete even if the cinema is stripped. Weigh every animation decision against this budget, not on top of it.
- **SEO matters MOST here — this is the front page.** Per-page meta + OG + Twitter, a designed OG image (the wordmark-in-light composition), `robots.txt`, `sitemap.xml`, and JSON-LD: a `Person` (the author) + a `WebSite`/`CollectionPage` or an `ItemList` of the six projects as `CreativeWork`/`SoftwareApplication` with their demo URLs. Canonical via `NEXT_PUBLIC_SITE_URL` (the documented placeholder pattern razors-edge/atlas use).
- **Every outward link is a real, focusable `<a>` with a discernible name and `rel="noopener noreferrer"` `target="_blank"`.** Accessible names must disambiguate (e.g. "tape — live demo" / "tape — GitHub repo"), not bare "demo"/"repo" repeated twelve times. Full keyboard reachability of all twelve links is a success criterion + an E2E assertion.
- **Determinism / no runtime randomness.** There is no faker/mock-data layer here (the data is six fixed hand-authored entries), but keep the same discipline: no `Math.random()` / `Date.now()` in render, so screenshots + Playwright + Lighthouse are reproducible. Any "year" is a fixed field in the data, not computed.
- **English-only in all files** (source, comments, ADRs, README, UI copy). Polish is for owner chat only (CLAUDE.md § 2).
- **No emojis anywhere** (source, commits, README, UI). Icons come from `lucide-react` (CLAUDE.md § 2).
- **The `Project` Zod schema is the contract** for `src/data/projects.ts` — parse/validate at module load so a malformed entry fails loudly at build, not silently in the UI. Unit-tested in Phase 6 (all six present, in canonical order, valid demo URLs, repo URLs derived from `GITHUB_BASE`, correct category/backend badges).

## References

- **Root `README.md` (project table + Philosophy) + root `PROGRESS.md` (composition tracker + Deployment status).** Source of truth for the six projects' exact pitches, stacks, categories, backends, and demo URLs that `src/data/projects.ts` encodes; the range statement the directory/about present; and the internal (do-not-surface) Fly-stopped/restart status.
- **`docs/inspirations.md`** — Olivier Larose (scroll-driven storytelling + sequential pinned reveals — the bay tour), Stripe (long-form scroll + a custom element justifying its bundle; type as a primary element), Aristide Benoist (kinetic/generative typography — the wordmark + per-bay title resolves), Linear + Klim (directory chrome restraint + display type as specimen). The designer-critic references at least two by name per critique, with zero pochwał.
- **`docs/conventions.md`** — § 3 (low `'use client'` boundary), § 10 (web-only criteria), § 12 (portfolio composition), § 14 (do-not-share / sovereign tokens), § 15 (animation policy), § 16 (workflow).
- **CLAUDE.md** — § 2 (English/no-emoji), § 3 (stack defaults + deviate-only-when-required), § 4 (quality bar), § 5 (wow moment), § 10 (no git remote → the `GITHUB_BASE` placeholder).
- **razors-edge `DECISIONS.md` + `AGENT_NOTES.md` + `PROGRESS.md`.** The proven GSAP/Next-App-Router contract (`useGSAP`, `matchMedia`, the refresh-coordinator + `ScrollTrigger.sort()` ordering, the CSP-clean posture), the Fly single-Machine web-only deploy pattern, the `NEXT_PUBLIC_SITE_URL` placeholder + sitemap/robots/OG/JSON-LD setup, and the reduced-motion "land on a clean composed frame, never a frozen mid-transition" lesson — all directly reusable.
- **atlas `DECISIONS.md` / deploy config.** A second reference for the Fly web/Next deploy + `NEXT_PUBLIC_SITE_URL` baking pattern if needed.

## Planner — implicit assumptions downstream agents should challenge (2026-06-09)

- **The hero metaphor is named but not designed.** "Descent through the wordmark into a colonnade of light" is a direction, not a comp. The frontend-engineer + designer-critic own making it actually read as architectural/atrium (and not generic "scale a word + parallax"). If the literal descent is hard to make hold at every scrub position (the razors-edge "every intermediate frame must be a composition" bar), simplify the metaphor rather than ship a janky mid-frame — the wow can be the six-bay tour carrying more weight, with a cleaner hero.
- **Six pinned bays is a lot of pinned scroll.** Verify early (Task 4.2 / a spike) that six sequential pins stay at 60 fps and inside the Lighthouse budget on a mid-tier laptop AND on mobile. If six full pins are too heavy, the fallback is fewer/lighter pins (e.g. pin only the hero, let the bays be scroll-revealed-but-not-pinned) — the bay-to-bay "tour" reading matters more than literally pinning all six. Raise it here before over-investing.
- **The "directory floor" doing triple duty (no-cinema index + reduced-motion render + no-JS render) is deliberate but must be genuinely complete.** It is easy to treat it as a footer afterthought; it is actually the load-bearing accessibility + SEO + no-JS surface. Build it to first-class quality, not as a fallback stub.
- **Whether atrium needs `/` to also be reachable as anchor deep-links per project (`/#tape` etc.).** The PLAN allows optional per-project anchors; confirm whether the header nav + directory anchors are enough or whether shareable per-project deep-links add value. Small call, left to Task 3.1/4.3.

## frontend-engineer — Phase 1 + Phase 2 (scaffold, tokens, type, data) (2026-06-09)

Phases 1.1, 1.2, 2.1, 2.2, 2.3 complete. `pnpm --filter atrium-web typecheck` / `lint` / `build` all clean; the GSAP smoke verified under `next build && next start` (see below). Next = Phase 3.

### Workspace / scaffold (1.1)

- **Layout matches every sibling:** `projects/atrium/` umbrella package `atrium` (delegating scripts to `-F atrium-web`) + `projects/atrium/web/` package `atrium-web`. Web extends `projects/atrium/tsconfig.base.json` (a project-local copy of the root base, the razors-edge convention) with `paths: { "@/*": ["./src/*"] }`. ESLint flat (`next/core-web-vitals` + `next/typescript`) with the one scoped `react-hooks/exhaustive-deps: off` exception on `use-gsap-effect.ts` (razors-edge precedent). Prettier is the repo-root `.prettierrc` (printWidth 100, single-quote, tailwind plugin) — no per-project prettier config. `pnpm install` at root picks `atrium-web` up cleanly (resolved/added with no errors; lockfile updated).
- **DEV PORT = 3080.** Verified no collision: tape default 3000-3002 (+ server 3055-3061 internal), razors-edge 3070, pulse 3081, apex 3090, atlas 3093. `next dev -p 3080` / `next start -p 3080`.
- **next-themes:** `attribute="class"`, `defaultTheme="dark"`, `themes=['light','dark']`, `enableSystem`, `disableTransitionOnChange`. `:root` is the canonical dark token set so SSR first paint is dark — no FOUC; `<html suppressHydrationWarning>`. **No TanStack Query, no Motion in `providers.tsx`** (ADR-002 single-library GSAP, no fetching) — only `ThemeProvider` + `TooltipProvider`.
- **Security headers + CSP** are the razors-edge-verified set in `next.config.ts` `headers()` over `/(.*)`: the exact ADR-002 string `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — **NO `unsafe-eval`** — plus HSTS / nosniff / Referrer-Policy / X-Frame-Options: DENY. `output: 'standalone'` + `outputFileTracingRoot` pinned to the atrium PROJECT root via `fileURLToPath` (the meld-incident / Windows-`.pathname` lesson). **Headers confirmed live via `curl -D -` against `next start`** (all five present, CSP byte-exact).
- **GOTCHA (Windows, non-blocking):** `next build` emits the standalone trace EPERM-symlink warnings (`react`/`next` symlink into `.next/standalone`) because this Windows shell lacks symlink privilege (no Developer Mode / admin). The build itself SUCCEEDS and all pages prerender; the standalone copy is only needed at Fly-deploy time (Phase 7, Linux CI), where symlinks work. Not a code defect — same as it would be for any sibling built here.

### GSAP integration (1.2)

- **atrium-local `src/lib/gsap/{register,use-gsap-effect,refresh-coordinator}.ts`** re-authored from the razors-edge shape (NOT a shared package — § 13 has not fired). `register.ts` = memoised `loadGsap()` dynamic-import code-split + `registerPlugin(ScrollTrigger, useGSAP)` once. `use-gsap-effect.ts` = post-paint `useEffect` running setup inside `gsap.context(..., scope.current)` (auto-revert cleanup, StrictMode-safe), `{ idle }` variant for the hero scrub. `refresh-coordinator.ts` = `requestGlobalRefresh()` debounced to ONE `ScrollTrigger.sort()`-BEFORE-`refresh()` (load-bearing — atrium has 7 pins: hero + 6 bays).
- **GSAP is code-split off the initial bundle** — confirmed by the build: home route First Load JS = 104 kB with GSAP NOT in it (it loads as a separate chunk post-hydration). Protects the most-judged-page Lighthouse budget.
- **SMOKE — verified under `next build && next start` (NOT `next dev`), then to be removed before Phase 3.** Marked `// SMOKE — remove before Phase 3` in `src/components/smoke/gsap-smoke.tsx` + the section in `app/page.tsx`. Headless Chromium (Playwright-core from the store) against the prod server: **ZERO `securitypolicyviolation` events, ZERO console/page errors** with GSAP hydrated + a ScrollTrigger scrubbing; the scrub's `onToggle` flipped the marker and GSAP wrote the inline `background-color` transform (proves attach + `gsap.matchMedia()` reduced/no-preference branching + CSP-clean). The razors-edge `D-CSP-1` zod-eval probe does NOT apply (atrium's only Zod parse is `projects.ts` at module/build time, no client-runtime validator). **Reviewer: confirm the smoke + its `page.tsx` section are deleted when the real hero descent lands.**

### Tokens (2.1) — sovereign palette + six signature hues

All values OKLCH in `app/globals.css` (`@theme` + `:root` dark canonical + `.light` override). **Contrast measured with the WCAG 2.1 relative-luminance formula (OKLCH→linear-sRGB→luminance) in BOTH themes — every pair clears its target.**

- **Chrome (dark / light):** fg 16.8 / 13.4 · fg-muted 9.4 / 6.6 · fg-subtle 5.5 / 4.5 (all ≥ 4.5 text) · the warm `light` accent: light-text 14.4 / 5.5 (text) and base 14.4 / 3.3 (UI ≥ 3) · border-strong 3.8 / 3.5 (UI ≥ 3). Grounds: `--color-bg` near-black faintly-warm charcoal `oklch(0.16 0.008 75)` dark / bone `oklch(0.96 0.009 85)` light. The brand accent is `--color-light*` (a neutral warm bone/amber, the wordmark glow + shaft + threshold) — NOT a sibling hue, NOT named `accent` (shadcn `accent` is the quiet hover surface).
- **Six `--bay-*` signature hues** — each ships `base` (UI fill, ≥ 3:1) / `-text` (small text/icon, ≥ 4.5:1) / `-on` (ink on a hue fill). **Per-bay mapping + measured contrast (text vs bg / UI vs bg), DARK | LIGHT:**
  - `--bay-tape` — slate/cyan (orderflow terminal): text 11.4 / 5.1, UI 8.1 / 4.1.
  - `--bay-meld` — collaborative warm (presence/paper): text 11.3 / 5.3, UI 8.2 / 4.0.
  - `--bay-razors-edge` — brass/amber (dark-luxe edge): text 12.2 / 5.6, UI 9.9 / 4.3. (atrium-local re-tune — NOT razors-edge's imported brass token, § 14.)
  - `--bay-pulse` — status green/amber (uptime/incident): text 12.5 / 5.6, UI 9.6 / 4.5.
  - `--bay-apex` — premium chrome/cool blue (configurator): text 11.1 / 6.5, UI 7.8 / 5.4.
  - `--bay-atlas` — control-room green (geo ops): text 12.9 / 5.2, UI 10.3 / 4.2.
  - vs the raised `--color-surface` (bays may sit on cards) every `-text` still clears AA in both themes (dark ≥ 10.2, light ≥ 4.6). **Contrast won over literal evocation** where needed (the light-theme hues are darkened from their dark-theme counterparts so the `-text` variant clears 4.5; tape/apex hue angles pushed slightly bluer on light to hold chroma at the lower lightness).
- The light theme is an intentional "architectural daylight" register (warm limestone field, charcoal ink, hues darkened), not an inversion. Type scale, radius, and the volumetric-light surface hooks (`--shaft-*`, `--field-*`, `--grain-opacity`) all live here for Phase 3 to consume (CSS/SVG only — no WebGL).

### Type (2.2)

- **Display = Bricolage Grotesque** (variable, **SIL OFL 1.1**), **Sans = Inter** (variable, **SIL OFL 1.1**) — both via `next/font/google`, self-hosted (`font-src 'self'`, CSP-clean), `display: 'swap'`. Bricolage exposes the `opsz` axis (+ `wght`) and is a STRUCTURAL/architectural grotesque — deliberately NOT a serif, so atrium reads distinct from razors-edge's Fraunces serif (re-skin gate) while holding as a specimen (Stripe/Klim). It drives the wordmark + per-bay kinetic title resolves via `font-variation-settings` (`--display-wght*` / `--display-opsz` hooks in globals.css). Inter is the neutral body/UI workhorse (it is the shared portfolio UI sans; § 14 governs design TOKENS, not whether a neutral webfont is reused — the sovereign identity is the palette + the display face).
- **Token-surface note:** globals.css `--font-display` references `--font-fraunces`; rather than rename the hook I aliased Bricolage's CSS var to `--font-fraunces` (`variable: '--font-fraunces'` in `layout.tsx`) so the display-face slot stays stable regardless of the chosen face. Harmless, documented here so the reviewer is not surprised by the name.

### Data (2.3)

- **`src/lib/schemas/project.ts`** = the ADR-003 `Project` Zod schema (`.strict()` + `superRefine`: backend presence must agree with category; `accentToken` must equal `--bay-<slug>`) + `projectsSchema` (`.length(6)` + canonical-order check). **`src/data/projects.ts`** = the six entries in canonical order (tape → meld → razors-edge → pulse → apex → atlas), pitches/stacks sourced verbatim-faithfully from the root README table, real `demoUrl`s, `repoUrl` DERIVED from `repoUrlFor(slug)` = `${GITHUB_BASE}/tree/main/projects/<slug>` (R1) — **zero inline `github.com` strings**. `PROJECTS = projectsSchema.parse(rawProjects)` at module load (build fails on a malformed entry). `stack` is the curated chip subset, not the full README string. `wowMoment` authored per project. `year: 2026` fixed (determinism).
- **`src/lib/site-config.ts`** = `SITE_URL` (`NEXT_PUBLIC_SITE_URL` ?? `https://atrium.fly.dev`), `SITE_NAME`/`SITE_DESCRIPTION`, `GITHUB_PLACEHOLDER = https://github.com/janantczak/portfolio` (**OWNER MUST CONFIRM the owner/repo slug**), `GITHUB_BASE` (env-overridable), `REPO_LINKS_LIVE` (the single U2 seam — false while the placeholder is in force), `AUTHOR_NAME`/`AUTHOR_EMAIL`. `.env.example` documents both `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_GITHUB_BASE`.
- The placeholder page (`app/page.tsx`) renders the wordmark + all six projects as real server-rendered DOM (verified via `curl` — ATRIUM, all slugs, badges present) so the data module is exercised in the build. It is a Phase-1 placeholder; the real hero/bays/directory replace it in Phase 3-4.

### Carried for Phase 3+

- The smoke component + its `page.tsx` section must be deleted at the start of Phase 3 (search `SMOKE — remove before Phase 3`). **[DONE — Phase 3: `src/components/smoke/` deleted, `page.tsx` rewritten.]**
- The CARRIED Task-4.2 six-pins-at-60fps spike — still owed before over-investing in six full pins. **[Phase-3 data point: see the Phase-3 entry below — ONE pin (the hero) holds 60 fps with a single 77 ms attach long-task (the GSAP-chunk parse, one-off, not per-frame). The scrub itself is rAF-driven and clean. Six SEQUENTIAL pins is still the open spike; run it before committing to all six.]**
- The U2 disabled-repo-affordance FINAL STYLING. **[DONE — Phase 3, see the Phase-3 entry below. Styling: a dashed-border, `opacity-70`, `cursor-not-allowed`, non-navigating `<span aria-disabled="true">` with the GitBranch icon + "GitHub repo" label + an sr-only "— link available once the repository is published". Lives in `src/components/directory/repo-affordance.tsx` (`ProjectLinks`), the SHARED component for both the directory and the Phase-4 bays. The demo is always a live `<a>`. Flips to a live repo `<a>` the instant `REPO_LINKS_LIVE`. The footer profile link + the directory cards use the same seam.]**
- No favicon/OG/sitemap/robots/JSON-LD yet — that is Phase 3+ SEO work (the layout metadata is a minimal placeholder for now). **[STILL OPEN — not in Phase 3 scope (Tasks 3.1–3.3 were chrome + hero + degradation); the SEO surface is owed by a later phase. The layout `metadata`/`viewport` are still the Phase-1 placeholders.]**

## frontend-engineer — Phase 3 (chrome + hero descent — the WOW) (2026-06-09)

Tasks 3.1, 3.2, 3.3 complete. Smoke deleted first. `pnpm --filter atrium-web typecheck` / `lint` / `build` all clean; verified under `next build && next start` (headless Chrome via the store playwright-core). Home route First Load JS 148 kB; GSAP still code-split off the baseline (103 kB shared) — it loads post-hydration. Next = Phase 4.

### Chrome (3.1)

- **`src/components/chrome/site-header.tsx`** — the post-hero sticky header. Two BINARY states, both `IntersectionObserver`, NOT GSAP (ADR-002 — state observation, the razors-edge header precedent): (1) `revealed` — a `#hero-sentinel` element in document flow at the hero base (rendered by `page.tsx`, `h-0`, zero CLS) toggles the header in once the hero scrolls past (robust to no-IO: header just shows); (2) `aria-current` — one observer over the six bays + the directory (`rootMargin: -45% 0 -45%`) lights the nav item for the section crossing the viewport centre. The header is `fixed`, the sentinel lives in flow — so the header stays pinned while its observation target sits at the hero base. Exports `HERO_SENTINEL_ID` (page renders it). Backdrop is a translucent blurred warm field that only materialises once revealed.
- **`src/components/chrome/mobile-nav.tsx`** — Radix Dialog drawer (focus trap, Esc, scroll-lock, focus restore for free). Enter/exit is CSS keyed off Radix `data-state` (`[data-atrium-sheet]` / `[data-atrium-overlay]` keyframes in globals.css) — NO Motion (ADR-002). `theme-toggle.tsx` is a CSS icon cross-dissolve (mounted-guarded against hydration mismatch). `brand-mark.tsx` is the scaled wordmark specimen linking `#top`.
- **`src/components/atmosphere/light-field.tsx`** — the volumetric-warm-light FIELD: `fixed inset-0 z-0 aria-hidden`, pure CSS/SVG (NO WebGL): a shell gradient + overhead bloom + framing vignette + a STATIC inline-SVG `feTurbulence` grain data-URI at `--grain-opacity` (`mix-blend-overlay`). Also exports `LightShaft` (the directed warm beam reused by the hero). Reads the `--field-*` / `--shaft-*` / `--grain-opacity` hooks so it re-tunes for the light theme automatically. Rendered once in `layout.tsx`; the content wrapper lost its opaque `bg-background` so the field shows through (body bg is the base).
- **`src/components/atmosphere/threshold.tsx`** — the REUSABLE shaft-of-light/threshold transition (the bay-to-bay connective tissue). Server, pure CSS, `accentToken`-threaded (a faint hue wash under the neutral warm seam) + `weight` major/minor. Static composition — nothing to neutralise under reduced-motion/no-JS. Phase 4 PARALLAXES it between bays; the resting frame is this seam. Already used between the placeholder bays, before the directory, and atop the footer/about.
- **`src/components/chrome/site-footer.tsx`** — the designed footer (server): wordmark specimen, compact six-link repeat (`#bay-<slug>`), contact, the GitHub PROFILE link on the same `REPO_LINKS_LIVE` seam (disabled control while placeholder), credits. Rendered in the layout shell so every route resolves into it.

### Hero descent — THE WOW (3.2) — technique

- **Structure / CLS-safety.** `src/components/hero/hero-descent.tsx` is the ONLY new client leaf besides the header. The hero is a `min-h-[100svh]` section whose RESTING frame — the `ATRIUM` `<h1>` wordmark lit in the warm shaft, the one-liner, the scroll cue — is REAL SERVER DOM passed in as `children` (`src/components/hero/hero-content.tsx`). That resting frame is simultaneously the LCP element (type/CSS, never an image), the reduced-motion frame, and the no-JS frame. GSAP only ENHANCES it.
- **The descent.** One `{ idle: true }` `useGsapEffect` builds one pinned, scrubbed (`scrub: 0.6`) timeline over ~1.3 viewports (`end: () => '+=' + innerHeight*pin`, `invalidateOnRefresh`, `anticipatePin: 1`): Phase A — supporting copy/cue clear (`data-descent-aux`), the wordmark (`data-descent-wordmark`) SCALES UP (→ 3.4 desktop / 2.4 mobile) + fades + THICKENS via `fontVariationSettings` 'wght' → 600 (the kinetic "drop through the letterforms", no Club plugin); Phase B — the `src/components/hero/colonnade.tsx` planes (`data-colonnade-plane` 1/2/3, CSS/SVG light columns, three depths) parallax UP at different rates (depth) and the shaft (`data-descent-shaft`) widens `scaleX` 1→1.6, RESOLVING into the lit hall. The hand-off is continuous — Phase B starts at scrub 0.25 (before the wordmark fully clears), and the unpinned hero hands straight into bay 1 below; the descent IS the transition, never stalls.
- **Verified scrub (headless, prod server):** wordmark scale monotonic across scroll depth — 1.0 → 1.04 → 1.32 → 2.46 → 3.4 (rests at 1, LCP-safe; the scale tween completes ~70% while the colonnade keeps resolving — intended). CLS through the whole descent scroll = **0.011** (< 0.1). Transform/opacity only; `will-change` set on just the moving elements at attach, cleared on `onLeave`/`onLeaveBack` (narrow + transient, never blanket on the gradients).
- **Idle ambience (CSS-only, NOT GSAP):** a barely-perceptible shaft drift (`.atrium-shaft-drift`, 11 s) + the scroll-cue bob (`.atrium-cue-bob`) — decorative CSS animations on aria-hidden/non-content elements, disabled by the globals.css reduced-motion floor (PLAN: idle drift disabled under `prefers-reduced-motion`). Scroll = GSAP only; these are not scroll-driven.

### Three-tier degradation (3.3)

- **Tier 1 full** — `gsap.matchMedia()` `desktop` (≥768px, scale 3.4, pin 1.3vh, far plane on) / `mobile` (≤767px, scale 2.4, pin 1vh, far plane DROPPED) branches. Mobile is the documented "simplify on small widths" path; verified 320px has ZERO horizontal overflow and the lighter pin attaches.
- **Tier 2 reduced-motion** — the `(prefers-reduced-motion: reduce)` `matchMedia` branch creates NOTHING (no pin, no scrub, no parallax). Verified headless: NO `.pin-spacer`, wordmark VISIBLE at rest, transform `none` after scrolling — lands on the clean composed frame, nothing frozen mid-transition (the razors-edge D-07 lesson honoured).
- **Tier 3 no-JS** — verified by `curl` (JS never runs): the wordmark `<h1>`, all six `bay-<slug>` anchors, all six demo `<a>`s, the directory + its twelve outward links (demo live, repo = U2 disabled), the about, the footer — all real server DOM. GSAP only enhances.

### CSP GOTCHA — Zod JIT eval (ADR-002 assumption was WRONG; now fixed)

- **ADR-002 stated the razors-edge `D-CSP-1` zod-`new Function` eval probe "does NOT apply to atrium — atrium's only Zod parse runs at module load (build time), no client-runtime validator."** This turned out to be FALSE in the built bundle: `src/data/projects.ts` runs `projectsSchema.parse()` at module-eval, and `src/lib/site-nav.ts` (which imports `projects.ts` for `PROJECT_NAV_ITEMS`) is imported by the CLIENT header + mobile-nav — so Zod + the `.parse()` end up in the client bundle and run in the browser. **Zod v4 compiles validators with `new Function(...)` by default**, which trips the strict CSP (`script-src 'self'`, no `unsafe-eval`). The first headless probe caught exactly ONE violation: `script-src eval` from the Zod chunk (`Symbol("evaluating")` marker, no literal `new Function` string — it is constructed).
- **FIX (applied):** `z.config({ jitless: true })` at the top of `src/lib/schemas/project.ts` — switches Zod to the interpreted (non-`eval`) validator. Re-probed: **ZERO CSP violations.** The parse runs once over six fixed entries so the JIT speedup is irrelevant. This GENERALISES the razors-edge D-CSP-1 lesson to atrium; the ADR-002 "does not apply" line is superseded by this note. **Reviewer (Phase 5.3): confirm `z.config({ jitless: true })` is present and no client-runtime Zod parse re-introduces eval; the smoke-era assumption that no client Zod runs is no longer true.**
- **Test-method note for test-engineer / reviewer:** when verifying under `next build && next start` on Windows, KILL the prior `next start` (a bash `pkill -f "next start"` does NOT kill the PowerShell-spawned node — use `Get-Process node | Stop-Process -Force`) and ideally `rm -rf .next` before rebuilding — a stale server serves OLD prerendered HTML referencing deleted chunk hashes (400 / MIME errors that look like real failures but are staleness). Disable the browser HTTP cache (`Network.setCacheDisabled` CDP) when probing chunk-level behaviour. The reveal-header check must use INCREMENTAL scrolling, not an instant `scrollIntoView` jump (the IO crossing is missed by a teleport — works perfectly with real scroll).

### Gotchas / decisions for downstream

- **lucide-react 1.16 has NO brand `Github` glyph** (lucide dropped brand icons). Repo affordances use `GitBranch` (semantic, present). If a literal GitHub mark is wanted later, source an inline SVG (do not add an icon dep).
- **`z.config({ jitless: true })` is global** to the Zod instance — fine here (six tiny parses), but a future api-heavy-style runtime validator in atrium (none planned) would also run interpreted. Documented so it is not a surprise.
- **A small `#about` section + the `ABOUT_SECTION_ID` anchor were added in Phase 3** (`src/components/about/about.tsx`) to resolve the page narrative; PLAN puts the full about at Task 4.4 — this is a complete real version to ELEVATE, not a stub. Same for the directory (`directory.tsx`) and footer: shipped complete-and-real as the Tier-2/Tier-3 floor, marked for Phase-4 visual elevation. The bays are a CLEARLY-MARKED Phase-4 placeholder (`src/components/bays/bays-placeholder.tsx`, `data-phase4-placeholder="bays"`).
- **Per-project anchors `/#bay-<slug>` are wired** (header nav, mobile drawer, footer all use `bayId(slug)`), resolving the planner's "do we need per-project deep-links" question — yes, cheaply, one id contract in `src/lib/site-nav.ts`.

## frontend-engineer — Phase 4 (the six bays + directory + about) (2026-06-09)

Tasks 4.1, 4.2, 4.3, 4.4 complete. 4.5 (preview stills) deferred to v2 — non-blocking, asset-sourcing; the bays read complete on the type-and-light floor. `typecheck` / `lint` / `build` all clean; full scroll + reduced-motion + 320px verified under `next build && next start` (headless Chromium via the store). Next = Phase 5 designer-critic review.

### THE SIX-PIN SPIKE — RESOLVED: all seven pins HOLD 60 fps; `PIN_BAYS = true` ships

The carried ADR-002/Task-4.2 spike is closed. Probed the full scroll under `next build && next start` (headless Chromium 1223, incremental 90-step scroll across hero + six bay pins, rAF frame-timing instrumented):

- **Desktop 1440x900: 7 pin-spacers** (hero + 6 bays) — the refresh-coordinator `sort()`-before-`refresh()` ordering held; NO bay pinned early (the razors-edge gallery-early-pin bug ×6 did NOT recur). Frame timing across 160 frames: **p50 17.6 ms, p95 18.2 ms, only 3 frames > 32 ms**; the lone 125 ms `max` is the one-off GSAP-chunk attach long-task (the documented ~77 ms-class parse), NOT a per-frame scrub cost. The scrub holds ~60 fps through all seven pins. **0 CSP violations, 0 page errors** (the single "404" in every run is a favicon/resource fetch, not a code error).
- **Mobile 360x740 + narrow 320x700: 1 pin-spacer** (hero only — the bays are correctly UNPINNED on `max-width: 767px`, the clean vertical stack the PLAN mandates). **0 horizontal overflow at 320 px.** Over-32 ms frames are 2–4 one-off attach spikes only.
- **Reduced-motion (Tier 2): 0 pin-spacers** — the `(prefers-reduced-motion: reduce)` `matchMedia` branch creates NOTHING. The tape bay is NOT armed (the CSS ghost stays at its calm 0.18 underprint), the final title is `visibility: visible` + `clip-path: none` (fully resolved), **0 of 6 reveal items hidden** — lands on the clean composed frame, nothing frozen mid-transition (D-07 honoured). 0 CSP violations.

**Decision: ship the full pinned six-bay tour (`PIN_BAYS = true` in `bays-sequence.tsx`).** The fallback (scroll-reveal without pin, removing the six pin-spacers) stays wired as a one-line switch for future profiles — documented in the module header.

### Bay technique (4.1 / 4.2)

- **`src/components/bays/project-bay.tsx`** (SERVER) — the reusable bay, renders from a `Project`. The KINETIC TITLE is the razors-edge no-Club-plugin technique: TWO layered real-text copies of the same word — `data-bay-title-ghost` (aria-hidden, signature-hue, `clip-path`-wiped away on lock-in) + `data-bay-title-final` (the legible `<h2>` that holds the id + accessible name, resolves in via a `clip-path` reveal + a `font-variation-settings` `wght` settle light→resting). One word in the a11y tree (the final copy). Carries the hue via inline `--bay`/`--bay-text`/`--bay-on` custom props (the one allowed dynamic-inline case). Stack ribbon + `api-heavy · <backend>` / `web-only (creative)` badge + the wow-moment card + the two links (shared `ProjectLinks` — demo always live, repo U2-disabled). The `data-bay-media` column is the RESERVED, no-reflow slot a Task-4.5 preview still drops into — OMITTED by design (type-and-light is the floor).
- **`src/components/bays/bays-sequence.tsx`** (CLIENT — the ONLY client wrapper in the bay spine) — receives the six server bays + thresholds as `children`, enhances with GSAP. Per-bay timeline: arm the bay (`data-bay-armed`, a CSS hook so the ghost only lights under the cinema), set the unresolved start state, scrub the resolve. `gsap.matchMedia()` 3-tier: `reduced` (nothing) / `desktop` (pinned, `start: 'top top'`, `end: +=0.6vh`) / `mobile` (UNPINNED reveal-on-enter, `toggleActions: play none none reverse`). Threshold seams parallax (±6 yPercent) on desktop only. Cleanup reverts via the enclosing `gsap.context()` (from `useGsapEffect`); the only manual teardown is removing `data-bay-armed`.
- **`src/components/bays/bays.tsx`** (SERVER) — renders the six `ProjectBay` + interleaved hue-tinted `Threshold` (bay 1 = `major` hero→gallery seam, rest = `minor`), wraps in `BaysSequence`. **Replaced `bays-placeholder.tsx` (deleted).** `page.tsx` now imports `Bays`.
- **CSS hooks added to `globals.css`** (Phase-4 block before the reduced-motion floor): `[data-bay-title-ghost] { opacity: 0.18 }` at rest, `[data-bay-armed] [data-bay-title-ghost] { opacity: 1 }` only under the cinema — so the no-JS/reduced-motion resting frame is the calm composed state and the lit ghost only appears when GSAP arms the bay.
- **GOTCHA (TS):** `ScrollTrigger.Vars` is referenced as an AMBIENT GLOBAL type (the gsap `.d.ts` declares it globally) — do NOT `import type { ScrollTrigger } from 'gsap/ScrollTrigger'` for it (that triggers a `noUnusedLocals` error AND a side-effect import would pull GSAP into the initial bundle, breaking the code-split). Just reference `ScrollTrigger.Vars` with no import. `toggleActions` is set conditionally (not passed as `undefined`) for `exactOptionalPropertyTypes`.

### Directory (4.3) + About (4.4) elevation

- **`directory.tsx`** elevated from the Phase-3 card grid to a first-class RULED INDEX (Klim/Linear restraint): a two-column range-statement header, then six ruled rows (index + name + badge | pitch + 5 stack chips | both links). The signature-hue spine scales-in on `group-hover`/`group-focus-within` (CSS transform only). Still all-real-DOM, all twelve links reachable — the Tier-2/Tier-3 floor is intact and now visually first-class.
- **`about.tsx`** elevated: the three convictions ("polish over breadth / variance is the point / quality is non-negotiable") pulled out as a specimen list beside the statement, the `mailto:` + the GitHub PROFILE link on the same `REPO_LINKS_LIVE` U2 seam (disabled dashed control until live), a "back to directory" affordance. Build/typecheck/lint clean.
- **`site-footer.tsx`** was already complete-and-designed from Phase 3 (wordmark specimen, six-link repeat, contact, U2 profile seam, credits) — left as-is; it did not need elevation (not a stub).

### Carried for Phase 5+

- **Task 4.5 preview stills DEFERRED to v2** (non-blocking per PLAN). The `data-bay-media` column + the `previewImage?` schema field are the reserved seam; sourcing six optimised AVIFs (capture + optimise + provenance) is the remaining work. The bays read complete without them — do NOT gate ship on this.
- **SEO surface still owed** (favicon/OG/sitemap/robots/JSON-LD) — still the Phase-1 placeholder metadata, as noted in the Phase-3 entry. Not in Phase-4 scope; owed by a later phase before deploy.
- **designer-critic (Phase 5.1):** judge the hero descent + the six-bay tour against Olivier Larose + Stripe, the directory + chrome against Linear + Klim, the kinetic titles against Aristide Benoist — with the explicit "not a razors-edge re-skin" gate (atrium = cool architectural light + six hues + multi-stage descent + six-bay sequence; razors-edge = warm brass + single blade-cut hero). Concrete defect list.

## designer-critic — Phase 5.1 review: recurring patterns for Phase 5.2+ (2026-06-09)

Full defect list in `docs/critique-5.1.md` (14 defects: 2 blocker, 4 high, 5 medium, 3 low).
Re-skin gate vs razors-edge PASSED. Patterns the frontend-engineer should pre-empt, not just
patch one-off:

- **An atmospheric "scene" component must DEPICT its subject, not approximate it with a
  gradient fill.** The colonnade (D-01) reads as flat venetian-blind stripes because it has no
  perspective (perspective:900px is set but no child is transformed in Z), no floor/horizon, and
  no inter-column gaps — so it is a striped fill, not a space. Whenever a CSS/SVG "architectural"
  surface is built, it needs real spatial cues (vanishing point, ground plane, gap rhythm) or it
  reads as texture. This will recur for any future light/depth surface — design the depth
  explicitly, do not assume layered gradients imply space.
- **Every scrub position of a pinned timeline must be a composition — the back half cannot be
  dead air (D-02).** This is the SAME lesson razors-edge's critic flagged (D-01: every
  intermediate frame is a composition; reduced-motion lands on a clean frame). atrium re-broke it
  by letting the wordmark finish at ~0.55 and pinning ~0.45 more viewport with no new event. Rule
  for all future pinned scrubs: the pin length must equal the choreography length, or a second
  beat fills the remainder. Match pin duration to content.
- **The light theme is a DESIGN, not an inversion — and this is a repeat-risk on every new
  surface (D-03).** atrium's light theme currently fails the explicit "architectural daylight,
  not a flipped dark site" criterion: the volumetric-light identity vanishes and hue-washes read
  as floating smudges on white. Every atmospheric layer (field, shaft, bay wash, threshold) needs
  a light-theme COMPOSITION authored in its own right, not just re-tuned tokens. Build/judge the
  light theme of each new surface separately from day one.
- **A "signature hue per X" system only shows range if the hue does real visual work AND the
  hues are well-separated (D-04 + D-05).** Carrying the hue on a 4px edge + an ordinal + a faint
  pool makes six items look identical; and picking three hues in the same temperature band
  (tape/apex/atlas all cool) defeats the "visible range" purpose. When a hue is meant to
  differentiate, it must LIGHT the surface (not trim it) and the palette must be spaced around the
  wheel — let evocation bend to separation, the same way ADR-003 already says it bends to contrast.
- **Primary content must out-weigh secondary panels in both type-weight and figure/ground
  (D-06).** A filled card (the wow-card) on an otherwise dark bay automatically wins the eye over
  unfilled type; and the bay title at wght 440 under a directory list at wght 600 is an inverted
  hierarchy. Keep the most important element the heaviest and/or the most-contrasted; do not let a
  supporting panel become the only filled surface next to the primary headline.

## frontend-engineer — Phase 5.2: must-fix tier + polish applied (2026-06-09)

All six must-fix defects (D-01/02 blocker, D-03/04/05/06 high) resolved; the reduced-motion /
FOUC / focus / signature-hue-contrast polish pass run; cheap should-fix D-11 + D-14 also taken.
`typecheck` / `lint` / `build` clean; verified under `next build && next start` (headless
Chromium, dark + light + reduced-motion + 320/360px). New verification shots: `docs/critique-shots/52-*`.

### What changed, per defect

- **D-01 (colonnade rebuilt as a real CSS-3D atrium).** `hero/colonnade.tsx` rewritten. The old
  version set `perspective:900px` but transformed no child in Z, so it was inert (flat stripes).
  Now: a `transform-style: preserve-3d` STAGE with `perspective: 1100px` + a low
  `perspective-origin: 50% 38%` (camera looks down the hall); a FLOOR plane (`rotateX(80deg)`)
  receding to the horizon with a warm light pool at the far end (the spatial anchor the critique
  said was missing); TWO colonnades (left + right) of individual standing columns, each pushed
  back by `translateZ(-rank·150px)` and narrowed toward centre (`xPercent = 50 − rank·4.6`) so they
  CONVERGE to a vanishing point with REAL inter-column GAPS; a clerestory glow at the vanishing
  point. Each depth rank is tagged `data-colonnade-plane` 1/2/3 for the staggered reveal. **Still
  CSS/SVG only — NO WebGL (ADR-001).** `aria-hidden`, server component. **GOTCHA for the
  reviewer/future-me:** the columns own a CSS-3D `transform` for their placement, so the descent
  must NOT animate their `transform`/`yPercent` (it would clobber the depth matrix — GSAP
  decomposes the computed matrix and loses the perspective meaning). The reveal is OPACITY-ONLY;
  the camera Z-travel on the STAGE provides all column motion. Tokens added: `--colonnade-lit /
-shadow / -edge` (the column light) + `--floor-pool / -mid / -far` (the floor), both themes.

- **D-02 (descent no longer stalls).** `hero/hero-descent.tsx` timeline re-choreographed so motion
  is CONTINUOUS across the whole 0→1 scrub. The spine is the CAMERA: `[data-colonnade-stage]`
  translateZ travels `0 → camZ` over `duration: 1` (the entire pin), so every scrub position
  composes. Phase A (wordmark scale/thicken/fade) now completes ~0.42 (was ~0.62) but the camera
  keeps travelling AND a `[data-colonnade-floor]` light-pool BLOOM runs 0.35→1.0 through the back
  half — the exact dead window the critique flagged is now the second beat. Plane reveals are
  depth-STAGGERED (far at 0.08, mid 0.24, near 0.42 — fixes the "all arrive together so they read
  flat" note). Pin shortened to 1.2vh desktop / 0.9vh mobile (matched to the choreography).
  **Traced under prod build:** stage translateZ 0→126→317→500→694→890→900 and floor opacity
  0.2→0.34→0.75→0.99→1.0 across scrollY 0→1080 — no static frame. Descent CLS 0.012–0.019 (< 0.1).
  `will-change` is now set on the stage too and cleared in `onLeave`/`onLeaveBack` (narrow +
  transient, the ADR-002 rule).

- **D-03 (light theme = architectural daylight, not a flipped dark site).** `.light` surface hooks
  re-keyed in `globals.css` + `atmosphere/light-field.tsx` re-composed. The field is now a daylit-
  top → limestone-floor gradient (not flat bone); a DIRECTIONAL clerestory skylight WEDGE rakes
  from the top with a visible falloff (`--shaft-core/-mid` strengthened on light); a warm floor
  wash anchors the ground; the colonnade columns are sunlit limestone with a real cast-shadow side
  (`--colonnade-shadow` is a warm grey at 0.62 alpha on light, not transparency). The volumetric-
  light identity now survives the theme and the colonnade reads as a sunlit hall.

- **D-04 (each bay's hue LIGHTS the room).** `bays/project-bay.tsx`: the single faint bottom wash
  replaced by a three-layer bay LIGHT-FIELD that carries the hue as illumination — (1) a directional
  coloured clerestory raking from the top-right (`var(--bay)` at 38% mix), (2) a soft hue shaft
  falling from the top-left, (3) a stronger hue floor pool the type stands in (36% mix). Plus the
  threshold INTO each bay now carries a stronger hue wash (`atmosphere/threshold.tsx`, opacity 0.25
  → 0.55, 60% mix) so the seam foreshadows the lit room. Each bay now reads as a distinctly-lit room
  on entry, not one dark room with coloured trim.

- **D-05 (six hues re-spaced for separation).** The cool cluster (tape 220 / apex 255 / atlas 175)
  is gone. New wheel, both themes: **meld 40 (warm orange) · razors 88 (gold) · pulse 150 (green) ·
  atlas 195 (teal) · tape 230 (cyan-blue) · apex 285 (indigo/violet)**. apex pushed off tape's cyan
  to a true indigo; atlas pulled off tape's band to a distinct teal. The tour now traverses
  warm → gold → green → teal → cyan → indigo — six clearly different temperatures.

- **D-06 (bay title is the focal point again).** `bays/project-bay.tsx`: the final `<h2>` title
  now resolves to the BOLD axis (`--display-wght` 440 → `--display-wght-bold` 600 — so it
  out-weighs the directory's 600 h3 by also being far larger), set at a new `--text-display-bay`
  size (clamp 2.75→5.5rem, between h1 and the wordmark) with a hue text-glow. The bay grid widened
  to `1.38fr / 0.62fr` (was 1.05/0.95) so the type column dominates. The wow-card DEMOTED from a
  filled `bg-surface/50` card (the only filled surface — it won the eye) to a quiet hue-ruled note
  (a left hairline + a hue caption, muted body) that supports rather than competes.

### Polish pass

- **Reduced-motion:** unchanged from Phase 4 in mechanism — the `matchMedia` `reduced` branches of
  the hero descent and the bays sequence still create NOTHING. Re-verified after the rework: 0
  pin-spacers, the colonnade sits at its CSS resting dim (no GSAP), every bay title resolved, no
  frozen mid-transition. The new colonnade's resting state is the calm faint hall (`[data-colonnade]
{ opacity: 0.5 }`, dimmed further at ≤560/≤380px — D-11), the columns at their per-rank inline
  opacity. Clean composed frame.
- **FOUC:** unchanged — dark-canonical `:root`, `suppressHydrationWarning`, `disableTransitionOnChange`,
  dark default. No new theme-dependent first-paint risk introduced. (Minor: the light `themeColor`
  meta is still the old `#f4f1ea`; harmless, left for the SEO phase that owns the metadata.)
- **Focus:** the global brand `:focus-visible` ring (2px `--color-light-text`, 2px offset,
  `!important`) is intact and covers every interactive element; no component added `outline:none`.
  Not touched in 5.2 (the critic confirmed it meets WCAG 2.2 — no defect).
- **Contrast:** all re-tuned hues re-measured (OKLCH→linear-sRGB→WCAG luminance) — table below.

### UPDATED signature-hue contrast table (after the D-04/D-05 re-tune)

Measured with the WCAG 2.1 relative-luminance formula. `-text` target ≥ 4.5:1, base (UI) ≥ 3:1.
Format: DARK (vs bg / vs surface) | LIGHT (vs bg / vs surface) for `-text`; base is vs bg.

| hue (angle)      | DARK -text (bg/surf) | LIGHT -text (bg/surf) | DARK base | LIGHT base |
| ---------------- | -------------------- | --------------------- | --------- | ---------- |
| meld (40)        | 11.20 / 10.23        | 5.54 / 6.05           | 8.62      | 4.26       |
| razors-edge (88) | 12.68 / 11.58        | 5.26 / 5.74           | 10.72     | 4.07       |
| pulse (150)      | 12.93 / 11.81        | 5.55 / 6.06           | 10.31     | 4.51       |
| atlas (195)      | 13.17 / 12.03        | 5.62 / 6.13           | 10.53     | 4.50       |
| tape (230)       | 11.75 / 10.73        | 5.10 / 5.57           | 8.64      | 4.14       |
| apex (285)       | 10.32 / 9.43         | 7.44 / 8.13           | 7.03      | 6.19       |

Every `-text` clears ≥ 4.5:1 and every base clears ≥ 3:1 in BOTH themes — contrast still wins over
evocation (ADR-003). The Phase-2 table is SUPERSEDED by this one for the bay hues.

### No ADR conflicts

The rebuild stayed inside every constraint: CSS/SVG light only (no WebGL — ADR-001), GSAP-only
transform/opacity/clip-path (no Motion — ADR-002), the typed `--bay-*` token seam unchanged in
NAME/mapping (only values re-tuned — ADR-003 explicitly allows re-tuning for contrast/separation),
no client-runtime Zod added, no new dependency. Nothing required a design call that conflicted with
the ADRs, so there is nothing to escalate to the architect.

## reviewer — Phase 5.3 code review (2026-06-09)

Verdict: **APPROVE**, 0 blockers. Full audit in `docs/review-5.3.md`. lint + typecheck +
build all re-run green (home First Load JS 149 kB, GSAP code-split off the 103 kB baseline;
4/4 static prerender; only the documented Windows EPERM standalone-symlink warning).

All seven 5.3 audit targets PASS:

- GSAP boundaries: SSR-safe memoised loadGsap(), useGsapEffect context.revert() cleanup,
  coordinator sort()-before-refresh() for the 7 pins, GSAP off the initial bundle, no
  ScrollTrigger in a Server Component.
- Single GITHUB_BASE seam: github.com only in the one site-config.ts placeholder; every
  repoUrl derived via repoUrlFor(); U2 disabled affordance is a non-navigating aria-disabled
  span, demo always a live anchor; flips on REPO_LINKS_LIVE.
- Zod data module: z.config jitless:true present at module top (the client-reachable parse via
  site-nav -> header/mobile-nav is the real path; the fix is correct and necessary). Schema
  strict + superRefine + length/order; parsed at module load.
- Outward links: all real focusable anchors, target=\_blank rel=noopener-noreferrer, disambiguated
  aria-labels; mailto correctly bare; disabled repo control is not a tab-stop.
- CSP: exact ADR-002 string, NO unsafe-eval, full header set; nothing in code needs eval.
- Prod-bundle hygiene: zero console/debugger; smoke + bays-placeholder confirmed deleted; no
  SMOKE/TODO/FIXME markers.
- General: zero any/ts-ignore/eslint-disable in src; chrome a11y solid (Radix Dialog drawer,
  real nav + aria-current, mount-guarded theme button, skip-link); CLS-safe transform pins;
  English-only, no emojis; .env.example committed.

Should-fix (NOT a 5.3 blocker, owed before deploy): the **SEO surface is still entirely absent**
(no sitemap.ts/robots.ts/opengraph-image/JSON-LD). PLAN lists these as ship-gating; they were
deliberately deferred out of Phases 3-5. Route a frontend/SEO pass before Phase 6 Lighthouse CI.

Nits (defer): GITHUB_BASE trailing-slash normalization asymmetry vs the placeholder (cosmetic);
useGsapEffect setup type is => void while bays-sequence returns a cleanup gsap.context() honours
(works, type could widen); layout themeColor light value is stale (metadata-phase cosmetic).

**Next subagent: `test-engineer` (Phase 6)** — Vitest on the schema/data + Playwright on the 12
links / reduced-motion / theme / keyboard / no-JS, then Lighthouse CI. The SEO pass is owed
separately before the Lighthouse-SEO criterion can pass.

## frontend-engineer — SEO surface (closes the Phase-5.3 should-fix) (2026-06-09)

The reviewer's one ship-gating should-fix (SEO surface entirely absent — PLAN lists it as a v1
ship gate; Lighthouse SEO ≥ 95 cannot pass without it) is now CLOSED, plus the two cheap nits.
Authored as the portfolio's PRIMARY metadata (atrium is the eventual root — AGENT_NOTES
"Cross-cutting"). `typecheck` / `lint` / `build` all clean; full surface verified under
`next build && next start` (headless Chromium via the store playwright-core). No new dependency
(OG image uses `next/og`, already transitively present via Next).

### What landed

- **`src/app/layout.tsx` — complete primary `metadata` + `viewport`.** `metadataBase: new URL(SITE_URL)`
  (canonical origin via `NEXT_PUBLIC_SITE_URL`, documented placeholder `https://atrium.fly.dev`).
  `title.default` = `"Atrium — The portfolio of Jan Antczak"`, `template` `"%s — Atrium"`.
  `description`, `applicationName`, `authors`/`creator`/`publisher` (Jan Antczak), a real `keywords`
  array, `category`, `alternates.canonical: '/'`, an explicit `robots`/`googleBot` index+follow with
  `max-image-preview: large`. Full **Open Graph** (`type: website`, url, title, description,
  `siteName`, `locale: en_GB`) and **Twitter** `summary_large_image` (title + description). The OG/
  Twitter IMAGE is auto-wired by Next from the `opengraph-image.tsx` file convention — verified the
  rendered HTML carries `og:image`, `og:image:alt`, `og:image:type`, and the matching `twitter:image:*`
  (no need to hand-list image URLs in `metadata`).
- **`src/app/opengraph-image.tsx` — the designed OG image (`next/og`, `runtime = 'nodejs'`).** The
  atrium wordmark-in-light composition: the ATRIUM specimen lit in warm light on a near-black warm
  field, a warm volumetric shaft raking from top-centre, a "THE PORTFOLIO OF JAN ANTCZAK" eyebrow with
  lit rules, and the "Six showcases · four backends · one quality bar" supporting line. Colours are
  sRGB-hex approximations of the sovereign OKLCH tokens (`--field-top/-bottom`, `--color-fg/-muted`,
  `--color-light/-strong`). Renders a valid **1200x630 PNG** (read it back to confirm on-brand).
  **Satori gotcha (cost me two build failures):** every element with MORE than one child node needs an
  explicit `display: flex|none`, AND a text node mixed with a `{expression}`/`&nbsp;` counts as
  multiple children — so an eyebrow `The portfolio of {AUTHOR_NAME}` and a `Six … &nbsp;·&nbsp; …`
  line both tripped it. Fix: collapse interpolated text to a single template string
  (`{`The portfolio of ${AUTHOR_NAME}`}`) and use plain `·` separators. Document this for anyone
  editing the OG comp.
- **`src/app/robots.ts` + `src/app/sitemap.ts` (Next file conventions).** robots = public/indexable,
  points at the sitemap, `host: SITE_URL`. sitemap = the single `/` route (the bays/about are in-page
  anchors, not URLs), fixed `lastModified` (frozen-clock determinism). Both verified resolving:
  `/robots.txt` and `/sitemap.xml` output correctly with the canonical origin.
- **`src/components/seo/portfolio-json-ld.tsx` — JSON-LD (mirrors the razors-edge `ShopJsonLd`
  injection pattern).** A single `<script type="application/ld+json">` in `<body>` carrying a
  `@graph` of: **`Person`** (Jan Antczak, email, `jobTitle`), **`WebSite`** (canonical, author/creator
  → Person `@id`), and **`CollectionPage`** with `mainEntity` = an **`ItemList`** of the six projects
  as **`SoftwareApplication`** entries (`@id` = `#bay-<slug>`, `url` = the real demo URL, `author` →
  Person, `keywords` = the stack), `position`-ordered + `itemListOrder: ItemListOrderAscending` in the
  canonical portfolio order. **Pulled from `PROJECTS` (the single source of truth) — zero re-hardcoded
  links/stacks.** Verified well-formed: parses, 6 items in order, every demo URL correct,
  `primaryImageOfPage` → `/opengraph-image`.
- **REPO_LINKS_LIVE gate honoured in the JSON-LD too:** while the placeholder `GITHUB_BASE` is in
  force, the Person `sameAs` (GitHub profile) and each app's `codeRepository` are OMITTED rather than
  emitting a structured-data link that resolves to a 404 — same U2 honesty as the UI affordance. The
  instant `NEXT_PUBLIC_GITHUB_BASE` flips, both appear automatically (single seam).

### CSP verification (the load-bearing check — strict no-`unsafe-eval`)

Headless probe under `next build && next start`: loaded `/` (JSON-LD + GSAP hydrated) and
`/opengraph-image`, listening for `securitypolicyviolation`. **Result: ZERO CSP violations**,
JSON-LD parses in the live DOM, OG route = 200 `image/png`, no page/console errors (favicon 404
noise excluded). JSON-LD is DATA, not executable script — `type="application/ld+json"` is never
parsed as JS, so it needs no `unsafe-eval` and raises no violation; confirmed empirically, not
just asserted. The OG route is a server-rendered PNG (nodejs runtime), never executes in the page.

### Cheap nits taken (from review-5.3)

- **`site-config.ts` GITHUB_BASE trailing-slash asymmetry:** `GITHUB_PLACEHOLDER` now passes through
  the same `.replace(/\/$/, '')` as `GITHUB_BASE`, so a trailing-slash placeholder env value can no
  longer accidentally read as `REPO_LINKS_LIVE` (both sides normalized before compare).
- **Stale light `themeColor`:** `layout.tsx` light `themeColor` moved from the old `#f4f1ea` to
  `#f6f3eb`, matching the current daylight-theme `--color-bg: oklch(0.96 0.009 85)`. Dark value also
  aligned to `--field-top` (`#1a1714`).
- The third nit (`useGsapEffect` setup type `=> void` vs the bays-sequence cleanup) was explicitly
  marked "correct as-is / optional" by the reviewer and is OUT of scope here — skipped to avoid
  touching the GSAP hook surface for a cosmetic type-widening with no behavioural change.

### For test-engineer / Lighthouse

- The SEO category should now clear ≥ 95 (canonical, meta description, robots, indexable, structured
  data all present). Worth E2E-asserting: `/robots.txt` + `/sitemap.xml` resolve; the homepage has
  exactly one `application/ld+json` script that `JSON.parse`s; `/opengraph-image` returns `image/png` 200. The OG image URL carries a Next cache-bust query (`?<hash>`) — assert the path, not an exact
  query string. NOTE the AGENT_NOTES "Phase 3" test-method gotcha still applies: on Windows kill the
  prior server with `taskkill //F //IM node.exe` (a bash `pkill` misses the PowerShell-spawned node)
  and the standalone `next start` warning is benign for probing.

## test-engineer — Phase 6 (tests: Vitest + Playwright + Lighthouse CI) (2026-06-09)

Tasks 6.1, 6.2, 6.3 complete. `pnpm -F atrium-web typecheck` / `lint` / `test` and
`pnpm -F atrium-e2e typecheck` all clean. Full suite verified GREEN locally against
`next build && next start` on :3080. Next = Phase 7 docs.

### 6.1 — Vitest unit suite (54 tests, all passing)

- **`vitest.config.ts`** added (mirrors the razors-edge shape: `@vitejs/plugin-react`, `@` →
  `./src` alias, jsdom, `globals: true`, `include` co-located `*.test.{ts,tsx}`). NOTE atrium-web
  pins **Vitest 4** (`^4.1.0`, the workspace security override) — not razors-edge's v3; the config
  shape is identical and works as-is.
- **`src/lib/schemas/project.test.ts`** — the `Project` Zod schema guard rails BITE: rejects an
  unknown slug, an extra key (`.strict()`), a non-URL `demoUrl`/`repoUrl`, an empty `name`/`stack`,
  a non-int `year`, an unknown `backend`; the category↔backend `superRefine` invariant (api-heavy
  must name a backend, web-only must be null); `accentToken` must equal `--bay-<slug>`; the
  collection contract (exactly six, canonical order, rejects fewer/more/wrong-order); and the enum
  exports stay aligned with the portfolio truth (six slugs, four backends, six `--bay-*` tokens).
- **`src/data/projects.test.ts`** — the real `PROJECTS` config: all six present in canonical order
  (tape→meld→razors-edge→pulse→apex→atlas); every `demoUrl` is the exact real Fly URL + a parseable
  https URL; every `repoUrl` is the R1 derivation `${GITHUB_BASE}/tree/main/projects/<slug>`; the
  4-api-heavy (Elysia/Bun · Hono · NestJS · Fastify) + 2-web-only split with correct per-project
  backend badges; `accentToken` matches slug; `REPO_LINKS_LIVE` is false while the placeholder is in
  force. **THE GUARD:** walks the whole `src/` tree and asserts `github.com` appears in **exactly
  one file — `lib/site-config.ts`** (the single seam). GOTCHA solved: two source files
  (`data/projects.ts`, `lib/schemas/project.ts`) legitimately mention "`github.com/...`" in DOC
  COMMENTS describing the rule itself — the guard **strips block/line comments before scanning** so
  prose does not trip it; it catches real link literals in code only. Also: `import.meta.url` is NOT
  a `file:` URL under Vitest — use `import.meta.dirname` (Node 22) for the tree walk, not
  `fileURLToPath(new URL(...))`. And Zod v4's thrown `.message` is a JSON-serialized issues array
  with escaped quotes, so `toThrow(/regex with literal quotes/)` is brittle — use
  `safeParse(...).error.issues` / `.message` substring checks instead.

### 6.2 — Playwright E2E (`projects/atrium/e2e/`, 18 tests, all passing)

- Harness mirrors razors-edge's (`atrium-e2e` workspace member, picked up by the `projects/*/e2e`
  glob): Zod-parsed env loader (`BASE_URL` ?? `ATRIUM_E2E_TARGET_URL` ?? `http://localhost:3080`),
  1 worker, chromium-only, dark `colorScheme`, `en-GB`/`Europe/Warsaw`, built+served surface only
  (NOT `next dev` — strict CSP). Helpers: `diagnostics.ts` (page-error/console-error/CSP-violation
  collector — atrium has **NO** allow-listed CSP violation, unlike razors-edge's D-CSP-1, because
  `z.config({ jitless:true })` closed the zod-eval risk), `projects.ts` (the six projects' E2E truth,
  re-stated independently of the app module so a spec is a genuine end-to-end check), `landing-page.ts`
  page object (role + accessible-name queries).
- **Specs:** `landing` (prod-surface smoke: hero `<h1>`, six bays, directory, GSAP hydrated, ZERO
  CSP/console/page errors); `links` (the 12 affordances — the directory carries exactly 6 live demo
  `<a>` to the real Fly URLs with `target=_blank` + `rel=noopener noreferrer`; each bay surfaces its
  demo anchor; the 6 repo affordances are the U2 disabled `aria-disabled` spans, NOT `role=link`,
  and there is ZERO live `github.com` href anywhere); `reduced-motion` (emulate
  `prefers-reduced-motion`: **0 `.pin-spacer`**, hero wordmark visible, every bay `<h2>` title
  resolved/visible, footer reachable at doc bottom — nothing frozen mid-transition); `theme-toggle`
  (must scroll past the hero to REVEAL the sticky header first — incremental scroll, not a teleport,
  per the Phase-3 IO gotcha — then toggle flips `<html>` class light↔dark, persists across reload,
  no CSP eval violation); `keyboard` (each of the 6 directory demo links is focusable with a
  discernible name; the 6 disabled repo spans are NOT tab stops; a forward-Tab traversal hits all 6
  demos in canonical order and NEVER lands on a disabled repo control); `no-js`
  (`javaScriptEnabled:false` → the complete directory in real server DOM: hero, six bay titles, six
  demo links to Fly URLs, six U2 repo spans, footer); `seo` (`/robots.txt` + `/sitemap.xml` resolve,
  `/opengraph-image` is `image/png` 200, exactly one parseable `application/ld+json` with the six
  demo URLs and NO `github.com`, plus canonical + meta description).
- **Selector gotchas solved (documented so they do not recur):** (1) the same `"<name> — live demo"`
  anchor renders in BOTH the bay AND the directory, so "exactly six" cardinality is asserted against
  the **directory** (`#directory`), where each project appears once. (2) Under the full cinema a
  bay's links start hidden (`data-bay-reveal`, opacity 0) until lock-in, so a `getByRole('link')`
  query (filters by a11y visibility) does NOT see them — assert the bay anchor by
  `a[href="<demoUrl>"]` + its `aria-label`, not by role. (3) `#directory li` counts 36 (the nested
  stack-chip `<ul>`s) — scope to `#directory > div > ul > li` for the six project rows.

### 6.3 — Lighthouse CI (≥ 95 ×4, NO scoped exception)

- **`projects/atrium/lighthouserc.json`** (mirrors razors-edge): `next start` on :3080, the landing
  `/`, median of 5, desktop preset. Assertions are **`error`** on all four categories ≥ 0.95 (NO
  scoped carve-out — unlike tape) + CWV: LCP < 2.5s, CLS < 0.1, **TBT ≤ 200ms as `error`** (the
  INP/TBT proxy; razors-edge had TBT as `warn` — atrium tightens it to `error` since it is the
  most-judged page and the budget holds with wide margin).
- **`.github/workflows/atrium-lighthouse.yml`** + **`atrium-e2e.yml`** authored from the
  razors-edge workflow shape (push-on-`projects/atrium/**` + workflow_dispatch; chromium-only;
  upload artifacts).
- **VERIFIED LOCALLY** against the prod build (Chrome at `/c/Program Files/Google/Chrome/...`):
  **Performance 99 · Accessibility 100 · Best Practices 96 · SEO 100**; **LCP 0.9s · CLS 0.009 ·
  TBT 10ms**. Clears every bar with wide margin — the SEO surface (Phase-5 pass) lands the SEO
  category at 100, so the no-scoped-exception requirement is met honestly.

### No product bugs surfaced

Every assertion passed against the shipped code on the first real run (after fixing only my own
test selectors). The U2 disabled-repo seam, the reduced-motion 0-pin floor, the no-JS directory,
the theme persistence, the SEO surface, and the 12-affordance keyboard contract all behave exactly
as ADR-003 specifies. Nothing to report to the engineer.

### Scripts wired

`atrium` umbrella gained `test:e2e` (`pnpm -F atrium-e2e test`) + `lighthouse`
(`lhci autorun --config=lighthouserc.json`) alongside the existing `test` (`pnpm -F atrium-web
test`, the Vitest unit run), consistent with the sibling harness conventions.

## doc-writer — Phase 7 (README + CHANGELOG + screenshots) (2026-06-09)

Phase 7 (7.1 + 7.2) complete. `README.md` + `CHANGELOG.md` authored in the razors-edge/apex house
style (badge-free; the "Portfolio root: ../../README.md" + MIT-license footer; the ADR summary block;
the production-surface run instructions). Root README updated. v1 is now complete through docs;
deploy is the only remaining work.

### Demo honesty (load-bearing — do NOT regress)

- **atrium is NOT deployed.** The README "Demo" section says so plainly and links the LOCAL prod
  surface (`pnpm -F atrium-web build && start` on :3080) — NO invented Fly URL. The root README demo
  cell is `local / not yet deployed` (the other six siblings keep their real Fly URLs).
- **The internal "Fly demos stopped to control cost" status is NOT surfaced** anywhere in atrium's
  public docs — only the project's own non-deployment is stated. The six siblings' demo links read
  as normal/live.
- On deploy: set `NEXT_PUBLIC_SITE_URL`, then remove "not yet deployed" from BOTH the README Demo
  section and the root README demo cell, and refresh the CHANGELOG `[Unreleased]` → a dated release.

### Screenshots — committed, reproducible

- **`e2e/capture-readme-screenshots.mjs`** (NEW, committed — the razors-edge/apex pattern): drives the
  BUILT + SERVED app on :3080 (headless Chromium via the Playwright store), writes a curated set into
  `docs/screenshots/` (a COMMITTED dir, distinct from the `docs/critique-shots/` review captures).
  12 shots: `hero-dark`, `descent-mid-dark`, `descent-late-dark`, `bay-{tape,razors-edge,atlas}-dark`,
  `directory-dark`, `hero-light`, `bay-tape-light`, `directory-light`, `hero-mobile-dark`,
  `bay-tape-mobile-dark`. Desktop 1440×900 @2x, mobile 390×844 @2x.
- **GOTCHA — bays must be OVER-SCROLLED to capture the RESOLVED frame.** Landing exactly on a bay's
  top catches the kinetic title mid-resolve (only the hue ghost shows, pitch/links not yet revealed).
  The capture helper over-scrolls ~0.45vh into each pin (`scrollToId(page, id, 0.45)`) so the bay is
  fully composed (title settled, pitch + stack + wow-card + both links visible). Use INCREMENTAL
  rAF-stepped scroll, never a teleport (the Phase-3 ScrollTrigger-scrub lesson).
- **NO GIF shipped.** The Playwright-bundled ffmpeg (`ms-playwright/ffmpeg-1011`) is a video-only
  build with NO PNG decoder — it cannot assemble a GIF from PNG frames ("Invalid data found when
  processing input" on a single PNG). This is the apex precedent: the README states the GIF was not
  assembled in this pass, the descent stills (hero + mid-descent) are the artifact, and the committed
  capture script regenerates them. If a GIF is wanted later, use a system ffmpeg with image2 support,
  or capture via CDP screencast / Playwright video, NOT the store ffmpeg.

### Root-doc updates done by doc-writer

- **Root `README.md`:** added the `atrium` row to the Projects table (pitch + `Next 15 + React 19 +
Tailwind v4 + GSAP (scroll) + Zod (web-only, no backend)` + `local / not yet deployed`); updated the
  Philosophy paragraph from "Six projects… four api-heavy… two web-only" → **"Seven projects… four
  api-heavy… three web-only (razors-edge, apex, atrium)"**, framing atrium as the front door (built,
  not yet deployed; the other six live).
- **Root `PROGRESS.md` — NOT edited by doc-writer; FLAGGED for the main thread.** The slot-7 TABLE
  ROW is already present (`| 7 | atrium | web-only (landing page) | — (none) |`), but the surrounding
  PROSE (lines ~7, ~57, ~79) still calls atrium "in planning" — it is now v1-complete. The main thread
  should refresh that prose (composition narrative is main-thread-owned, not a per-project file).

## frontend-engineer — strict ROOT eslint gate (the pre-commit reality) (2026-06-09)

- **atrium code must satisfy the STRICT, type-aware ROOT eslint, not just the lenient project
  `next lint`.** The pre-commit hook (lint-staged) lints every staged `*.{ts,tsx}` through the repo
  ROOT ESLint config via the catch-all `"*.{ts,...}": "eslint --fix --quiet"` rule. That root config
  is type-aware and far stricter than the project's `next/core-web-vitals` + `next/typescript`
  (`next lint`), so `pnpm -F atrium-web lint` can be GREEN while the commit is still blocked. This was
  a real gap that blocked a commit. **Always verify against the root command FROM THE REPO ROOT
  (`C:\portfolio`):**
  ```
  npx eslint --quiet "projects/atrium/web/**/*.{ts,tsx}" "projects/atrium/e2e/**/*.{ts,tsx}"
  ```
  It must end exit 0 with zero output before any commit.
- **Error classes that fired and how they were fixed (all mechanical — zero behaviour change):**
  `no-confusing-void-expression` → wrap void-returning arrow shorthands in braces
  (`() => doThing()` → `() => { doThing(); }`) — chrome/\*, hero-descent, bays-sequence, e2e specs;
  `restrict-template-expressions` → wrap interpolated `number`/union values in `String(...)`
  (colonnade, bays-sequence, hero-descent, schemas/project.ts) — rendered output identical;
  `no-deprecated` → Zod v4 forms: `z.string().url()` → `z.url(...)` and `z.ZodIssueCode.custom`
  → the raw `'custom'` string literal (schemas/project.ts, e2e/playwright.config.ts);
  `no-unnecessary-condition` + `prefer-string-starts-ends-with` → `textContent` is non-null in the
  evaluate context so the `?.`/`?? ''` were dropped, and `/ — live demo$/.test(x)` →
  `x.endsWith(' — live demo')` (keyboard.spec.ts);
  `no-empty-function` → the reduced-motion `mm.add` callbacks got an explanatory no-op comment body.
- **The `next.config.ts` "was not found by the project service" parsing error** was fixed by adding
  `next.config.ts` + `playwright.config.ts` to the web `tsconfig.json` `include` — mirroring apex's
  tsconfig EXACTLY (the strict type-aware lint needs the config files inside the TS project). The
  eslint config itself was NOT touched.
