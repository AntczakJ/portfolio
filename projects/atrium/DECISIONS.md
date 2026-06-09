# atrium — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour, animation library, design-token posture, and the typed project-data / link-placeholder strategy

**Status:** accepted
**Date:** 2026-06-09

### Context

`atrium` (brand display: **Atrium**) is the portfolio's **front door / lobby** — a single, scroll-driven cinematic landing page that presents the six existing showcase projects (tape, meld, razors-edge, pulse, apex, atlas) as a tour of the portfolio, and is itself the seventh portfolio piece. It is the page a recruiter or senior engineer is most likely to open first and to judge hardest, so its remit is explicitly "the strongest visual piece in the portfolio." The owner has fixed the load-bearing decisions; ADR-001 ratifies four of them so downstream agents work against a fixed footing:

1. **(a)** web-only vs api-heavy per `docs/conventions.md` § 10 — owner explicitly chose **web-only, pure frontend, no backend**;
2. **(b)** the single primary animation library per § 15 — owner explicitly chose **GSAP (ScrollTrigger)** for a scroll-driven cinematic experience;
3. **(c)** the design-token posture — sovereign per § 14 (no token reuse from any sibling project), with an atrium-local **six-signature-hue** strategy that makes the portfolio's range visible;
4. **(d)** the project-data model — a single typed, Zod-validated `src/data/projects.ts` with `demoUrl`s linked normally and `repoUrl`s derived from one `GITHUB_BASE` constant, because **the repo has no git remote yet** (CLAUDE.md § 10), so GitHub links must be a single flippable seam, not hardcoded broken inline URLs.

Portfolio-composition context that frames (a): the portfolio already contains **six complete projects, four of them api-heavy across four distinct backends** — tape (Elysia/Bun), meld (Hono/Node), pulse (NestJS), atlas (Fastify) — plus two web-only creative showcases (razors-edge, apex). The § 12 backend-variance constraint is satisfied with wide margin and the backend-variance story is complete (all four § 11 backends represented). `atrium` as slot 7 web-only does not threaten compliance and there is no open backend axis for it to fill.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (Next.js static-first; a typed in-repo data module; no backend).** None of the five § 10 api-heavy triggers fires: no WebSocket/SSE, no background jobs/queue/cron, no non-Next API consumer, no auth, and effectively no domain logic (the "data" is a fixed array of six project descriptors, shape-validated by Zod in `src/lib/`). **Picked (owner-confirmed).**
- **B. api-heavy with a backend (e.g., a CMS-backed projects API, or a "live demo status" service that pings each Fly app).** Buildable, but ceremony this brief does not need: the six entries are fixed and known at build time, and the internal Fly "stopped-to-control-cost" status is deliberately NOT surfaced publicly (the demos auto-start on URL hit; the public URLs stay normal per owner policy), so there is nothing to ping or display. A backend here would add a service that does not earn its keep and would not advance backend variance (all four backends are already represented). Forcing it would violate CLAUDE.md § 3 ("deviate only when the project genuinely requires it") in reverse. **Rejected on need grounds, not capability grounds.**

**Primary animation library (per § 15):**

- **A1. GSAP + ScrollTrigger.** The wow moment is a pinned, scrubbed, multi-stage scroll timeline: a hero descent through the wordmark into an atrium of light, handing off into a sequence of six pinned project "bays," each with a kinetic-type resolve and a threshold transition, choreographed against a single scroll progress with precise stage-to-stage hand-offs. This is the § 15 case for GSAP (scroll-driven timelines + many independently animated elements + mid-timeline state changes where "Motion's declarative model fights you"), and the exact pattern `razors-edge` already proved in this codebase (pinned hero + pinned sequence + the refresh-coordinator). **Picked (owner-confirmed).**
- **A2. Motion (primary).** Strong for React-state transitions, but `atrium` has no presence-heavy interactive surface (no wizard, no modals-as-the-point), and Motion's `useScroll` cannot cleanly drive a multi-stage pinned sequence. Retained at most as a **narrowly-scoped secondary** for small micro-interactions — but because there is no `AnimatePresence`-shaped need (unlike razors-edge's five-step wizard), the **preferred end state is GSAP-only with CSS for hover/theme**; the architect defaults to that in ADR-002. **Not the primary; likely dropped entirely.**
- **A3. React Three Fiber.** Rejected by § 15 explicitly — the atrium-of-light is 2D (CSS/SVG volumetric-light gradients + parallax planes), not WebGL/3D. R3F "is not for fancy 2D backgrounds." On the portfolio's most-judged, most-likely-first-opened page, a 3D runtime would also threaten the Lighthouse ≥ 95 mobile budget for no design payoff. **Rejected.**

**Design-token posture:**

- **D1. Sovereign tokens, built from scratch, with an atrium-local six-signature-hue strategy.** Required by § 14 (design tokens / theme variables / Tailwind preset never leave the project that owns them). The architectural near-black + volumetric-warm-light identity is unique to atrium. The six per-bay signature hues _evoke_ each sibling project (so the range is visible as you scroll a tour of differently-lit rooms) but are **defined as atrium-local tokens, hand-tuned to atrium's contrast/harmony rules — not imported from the sibling projects.** Importing razors-edge's brass or apex's palette would be exactly the § 14 violation, and would collapse the "variance is the point" thesis the page exists to prove. **Picked (mandated).**
- **D2. Reuse/extend a sibling's tokens, or literally import each project's palette for its bay.** Forbidden by § 14, and self-defeating for a page whose whole point is demonstrating range. **Rejected (policy).**

**Project-data model + the no-remote-yet link strategy:**

- **M1. One typed, Zod-validated `src/data/projects.ts`; `demoUrl` real + normal; `repoUrl` derived from a single `GITHUB_BASE` constant.** Six fixed entries read at build time, validated for shape safety. `demoUrl`s are the real public Fly URLs, linked normally (the internal "stopped to control cost" status is never surfaced — owner policy). `repoUrl`s are computed from one `GITHUB_BASE` constant (env-overridable, documented placeholder, since the repo has no remote yet — CLAUDE.md § 10), so **flipping one constant/env var makes all six repo links real the moment a remote exists**, with zero hardcoded broken `github.com/...` strings in components. **Picked (owner-confirmed).**
- **M2. Hardcode each demo/repo URL inline in components, or fetch from a CMS.** Inline-hardcoding scatters broken repo links across the tree and gives no single flip-point for the remote; a CMS is a backend the web-only thesis rejects for six fixed entries. **Rejected.**

### Decision

**Stack flavour: web-only.** **Primary animation library: GSAP 3.x + ScrollTrigger**, with **Motion permitted only as a narrowly-scoped secondary for small React-state micro-interactions if one provably earns it — the preferred and likely end state is GSAP-only with CSS for hover/theme** (no presence-heavy surface exists to justify Motion; the architect ratifies the exact split in ADR-002). **Design-token posture: sovereign — no reuse from any sibling project (`docs/conventions.md` § 14) — with an atrium-local six-signature-hue strategy that evokes each project without importing its tokens.** **Project-data model: one typed, Zod-validated `src/data/projects.ts` — `demoUrl`s real and linked normally (internal Fly status never surfaced), `repoUrl`s derived from a single documented `GITHUB_BASE` placeholder constant so the no-remote-yet GitHub links are one flippable seam, never hardcoded broken inline URLs.**

The four picks converge on one thesis: this slot's portfolio value is to be **the front door that proves the range and the craft in one scroll** — strongest-visual-piece ambition, honestly web-only (there is nothing to fetch or administer), GSAP for the cinematic scroll, sovereign tokens that _show_ the variance rather than collapsing it, and a typed link model that stays correct and unbroken even before a git remote exists.

**Two integration mechanisms are deliberately deferred** to the architect at implement kickoff, where they benefit from the razors-edge precedent rather than re-litigation: the precise animation split + GSAP-with-Next-App-Router integration posture (ADR-002 — reusing the `useGSAP` + `matchMedia` + refresh-coordinator + CSP lessons), and the project-data/`GITHUB_BASE` shape + the hero-descent → six-pinned-bays → directory scroll structure + the three-tier degradation contract (ADR-003).

### Consequences

- **Positive.**
  - The portfolio gains a real front door: one page that frames the six showcases, tells the range story (four backends + two creative web-only), and is itself the strongest visual piece — exactly the lobby the portfolio lacked.
  - Web-only is the honest flavour: a static typed index of six fixed projects has nothing to fetch and nothing to administer, so a backend would be pure ceremony; the deploy is trivial (Fly single-Machine Next standalone, the razors-edge pattern) and the performance budget is generous for the scroll cinema.
  - GSAP ScrollTrigger is the right tool for a multi-stage pinned descent + six-bay sequence, and the codebase already holds the hard-won integration lessons (`useGSAP`, `matchMedia`, the `sort()`-before-`refresh()` refresh-coordinator, the CSP-clean posture) from razors-edge — the frontend-engineer is not discovering them again.
  - Sovereign tokens + six atrium-local signature hues make the portfolio's range _visible_ (a tour of differently-lit rooms) without violating § 14 — the single strongest way to show variance instead of telling it.
  - The single `GITHUB_BASE` seam means the repo links are correct, centralised, and unbroken today, and become real with a one-constant change the instant a remote exists — no scattered broken inline URLs, no rework.
  - `demoUrl`s linked normally keep the public face clean while the internal Fly-stopped status stays internal (auto-start on URL hit covers the viewer experience).

- **Negative.**
  - The accepted GSAP overlap with `razors-edge` (owner's explicit call) creates a re-skin risk: two GSAP scroll showcases in one portfolio must read as visually distinct. Mitigation: atrium's motif (architectural descent through type into a colonnade of light + a six-bay tour), palette strategy (six signature hues vs one brass accent), and structure (sequential six-bay sequence vs a single hero cut) are deliberately different, and the designer-critic has an explicit "is this a razors-edge re-skin?" sign-off gate (PLAN Task 5.1).
  - GSAP + Next 15 App Router needs the same care razors-edge documented (SSR-safe `useGSAP` registration, low `'use client'` boundary, the multi-section refresh-coordinator + `ScrollTrigger.sort()` ordering so a pinned hero's pin-spacing is measured before the downstream bays, CLS-safe transform pinning, CSP without `unsafe-eval`). Mitigation: ADR-002 pins the integration pattern by reusing the proven razors-edge approach, with a Task 1.2 smoke test under `next build && next start`.
  - This is the most-judged page, so Lighthouse ≥ 95 ×4 with a six-bay pinned scroll is a real budget constraint. Mitigation: light/CSS surface (no WebGL, no heavy photography dependency), transform/opacity-only animation, rAF-driven scrub, the success criteria gate fps + CWV explicitly, and the directory floor keeps the page fast and complete even if the cinema is stripped.
  - The `prefers-reduced-motion` requirement is strict — the choreography must _fully_ neutralise to a static, readable directory page with nothing frozen mid-transition. Mitigation: the directory section is designed as the no-cinema/no-JS floor from the start, so reduced-motion is "render the floor, skip the pins," not a separate codebase.
  - Choosing web-only again (after razors-edge and apex) keeps the api-heavy ratio at 4/7 — still compliant with wide margin, and atrium genuinely has no backend need, so this is not drift; recorded so the next planning pass does not misread it.

- **Follow-up tasks.**
  - **ADR-002 (architect, implement-phase day 1):** ratify GSAP-only (or a narrowly-scoped Motion if one micro-interaction earns it), and pin the GSAP-with-Next-15-App-Router integration pattern (single `'use client'` registration module, `useGSAP()` universally, `gsap.matchMedia()`, the refresh-coordinator + `ScrollTrigger.sort()` ordering, SSR/CLS-safe pinning, CSP no-`unsafe-eval`) — reusing the razors-edge precedent.
  - **ADR-003 (architect):** the `Project` Zod schema + `src/data/projects.ts` field sourcing (pitches/stacks from the root README), the `GITHUB_BASE` constant + the monorepo-vs-split `repoUrl` shape + the no-remote-yet placeholder presentation, the atrium-local six-signature-hue token strategy, and the hero-descent → six-pinned-bays → directory scroll structure + the three-tier degradation contract.
  - **Engineering kickoff (gated on ADR-002 + ADR-003 acceptance):** `frontend-engineer` starts the Phase 1 scaffold (Task 1.1).

### References

- **`docs/conventions.md` § 10–16.** Web-only vs api-heavy (§ 10), backend choice (§ 11), portfolio composition (§ 12), the do-not-share black list incl. design tokens (§ 14), the animation-library policy (§ 15), the workflow (§ 16).
- **CLAUDE.md § 2, § 3, § 4, § 5, § 10.** English-only files / no emojis (§ 2); stack hard-defaults + "deviate only when genuinely required" (§ 3); the quality bar — theming, a11y, performance, SEO, security (§ 4); the wow-moment mandate (§ 5); the "repo has no remote" reality that forces the `GITHUB_BASE` placeholder (§ 10).
- **Root `README.md` (project table + Philosophy) and root `PROGRESS.md` (composition tracker).** The source of truth for the six projects' exact pitches/stacks/demo URLs that `src/data/projects.ts` encodes, and for the range statement the directory/about sections present.
- **`docs/inspirations.md`.** Olivier Larose (scroll-driven storytelling + sequential pinned reveals — the closest analogue to the descent + six-bay tour), Stripe (long-form scroll with a custom element justifying its bundle; type as a primary element), Aristide Benoist (kinetic/generative typography for the wordmark + per-bay title resolves), Linear + Klim (directory chrome restraint + display type as specimen).
- **razors-edge `DECISIONS.md` (ADR-002/003/004) + `AGENT_NOTES.md`.** The proven GSAP-with-Next-App-Router integration contract, the `useGSAP` + `matchMedia` discipline, the multi-section refresh-coordinator + `ScrollTrigger.sort()` ordering lesson, the CSP-clean GSAP posture (`script-src 'self' 'unsafe-inline'`, no `unsafe-eval`), and the Fly single-Machine deploy pattern atrium reuses. atrium shares the GSAP tool with razors-edge by the owner's explicit call; this ADR records the re-skin-avoidance obligation.

---

## ADR-002: Animation posture — single-library GSAP, and the GSAP / Next 15 App Router integration contract

**Status:** accepted
**Date:** 2026-06-09

### Context

ADR-001 fixed GSAP + ScrollTrigger as the primary animation library and left two things for this ADR: (1) ratify the exact library split — GSAP-only vs GSAP + a narrowly-scoped Motion — and (2) pin the GSAP-with-Next-15-App-Router integration pattern before the Phase 1 scaffold (Task 1.2 stands up a smoke ScrollTrigger and is gated here).

The decisive fact, recorded in `AGENT_NOTES.md` "Decisions to revisit": **atrium has no presence-heavy interactive surface.** Unlike razors-edge — whose five-step booking wizard mounts/unmounts a step panel on every Zustand `step` change and genuinely earned Motion's `AnimatePresence` exit-before-unmount — atrium is a long-form scroll page with no wizard, no modals-as-the-point, no list whose items animate in/out on state. Its only React-state transitions are a theme-toggle crossfade, hover/active states on directory cards and link buttons, a mobile-nav drawer, and a possible copy-email toast. None of those needs presence/layout tracking that CSS cannot express cleanly.

razors-edge already solved GSAP-in-Next-15-App-Router in this codebase and the integration source is directly reusable: a single `'use client'` registration module (`src/lib/gsap/register.ts`), a `useGsapEffect` hook wrapping `gsap.context()` with automatic scoped cleanup, a `gsap.matchMedia()` discipline for reduced-motion + responsive branches, and — load-bearing for a multi-pinned-section page — a refresh-coordinator that calls `ScrollTrigger.sort()` **before** `ScrollTrigger.refresh()`. atrium has a hero pin **plus six bay pins**, so the sort-before-refresh ordering rule matters here even more than it did in razors-edge (one hero pin + one gallery pin). We reuse the proven contract; we do not re-derive it.

### Options considered

**Library split:**

- **A. GSAP-only, with CSS for hover/active/theme-crossfade/drawer.** One library, one mental model, smallest dependency surface, the `docs/conventions.md` § 15 single-library default honoured literally. Hover/active and theme crossfade are CSS `transition` + `data-state`/`@media (prefers-reduced-motion)`; the mobile-nav drawer is a Radix/shadcn `data-state` + custom-keyframe sheet (exactly the razors-edge `sheet.tsx` pattern, which needs no Motion); a copy toast is a CSS-animated `data-state` element or shadcn `sonner`. Cost: a coordinated exit-before-unmount (animate-out, _then_ remove the node) is not natively expressible in pure CSS — but atrium has no surface that requires one.
- **B. GSAP + a narrowly-scoped Motion secondary.** The razors-edge posture. Justified there by the wizard; here it would buy a Motion bundle (~on top of GSAP+ScrollTrigger) for micro-interactions CSS already covers, on the portfolio's **most-judged, most-likely-first-opened page** where the Lighthouse ≥ 95 ×4 budget is tightest. No specific atrium micro-interaction was identified that provably needs `AnimatePresence`/`layout`.
- **C. GSAP + Motion _and_ something for the light surface (R3F).** Rejected upstream by ADR-001 / § 15 — the atrium-of-light is CSS/SVG gradients + 2D parallax planes, not WebGL. Not reconsidered here.

**GSAP integration mechanism (orthogonal to the split):**

- **P1. Reuse the razors-edge `loadGsap()` + `useGsapEffect` + refresh-coordinator modules** (dynamic-import code-split GSAP, register plugins once, `gsap.context()` scoped cleanup, the `sort()`-before-`refresh()` coordinator). Proven CSP-clean under `next build && next start` in this codebase, and code-splits ~110 kB of GSAP off the critical path — directly relevant to atrium's Lighthouse budget. Built as atrium-local copies (no shared package — § 13 has not fired; these are tiny, project-owned integration utilities, re-authored from the proven shape, not imported from razors-edge).
- **P2. `useGSAP()` from `@gsap/react` directly, statically imported.** The official hook; simpler, but it runs in a `useLayoutEffect` and pulls GSAP onto the critical render/parse path (the exact cost razors-edge's home-perf pass moved away from). For the most-judged page, the code-split `useGsapEffect` shape is the better default.

### Decision

**Single-library: GSAP 3.x + ScrollTrigger only. Motion is NOT installed in atrium (Option A).** All scroll/pin/scrub/timeline work is GSAP; all hover/active/theme-crossfade/drawer/toast micro-interaction is CSS (`transition`, `data-state`, `@media (prefers-reduced-motion: reduce)`, Radix `data-state` keyframes for the mobile sheet). This is the § 15 single-library ideal, honestly reachable here because no presence-heavy surface exists to justify a second library. The standing rule, verbatim, that the frontend-engineer and reviewer enforce mechanically:

> **GSAP owns everything scroll-, pin-, scrub-, and timeline-driven — 100% of it.** No scroll/pin/scrub/timeline work ever leaves GSAP.
> **Motion is not a dependency of this project.** If a future surface (v2) ever needs presence/layout tracking, adding Motion requires its own ADR (§ 15) naming the specific interaction — it is not a free reach.
> **Hover, active, theme crossfade, the mobile-nav drawer, and any toast are CSS** (`transition` / `data-state` / custom keyframes / `prefers-reduced-motion`), never JS animation.
> Binary scroll _state_ (header transparent→backdrop past the hero; `aria-current` on nav from the in-view section) is observed with `IntersectionObserver`, **not** GSAP — that is state observation, not scroll animation, and is not a violation of "scroll = GSAP" (the razors-edge header precedent).

**Integration contract (reuse the razors-edge proven shape as atrium-local modules under `src/lib/gsap/`):**

- **Single `'use client'` registration module** (`src/lib/gsap/register.ts`) exposing a memoised `loadGsap()` that dynamic-`import()`s `gsap`, `gsap/ScrollTrigger`, and `@gsap/react`, calls `gsap.registerPlugin(ScrollTrigger, useGSAP)` exactly once, and resolves the handles. GSAP is **code-split out of the initial bundle** and fetched after hydration — protecting the home-route TBT/main-thread budget on the most-judged page. ScrollTrigger is **never** imported into a Server Component.
- **All GSAP work runs through one hook** (`src/lib/gsap/use-gsap-effect.ts`): a `useEffect` (post-paint, not a layout effect) that `loadGsap()`s on demand and runs the section's setup inside a `gsap.context(() => {...}, scope.current)` — so selector text is scoped and every animation + ScrollTrigger it creates is reverted automatically on unmount/dep-change (the `useGSAP` cleanup guarantee, StrictMode-double-invoke-safe by construction). No raw `useLayoutEffect` + `gsap.context()` hand-rolling anywhere. The **hero scrub** uses the `{ idle: true }` variant (its scroll=0 state equals the composed resting frame, so a `requestIdleCallback`-deferred attach cannot flash); **bay scroll-reveals** that hide items (`opacity: 0`) use the non-idle variant so an in-view item does not flash visible-then-hidden.
- **`'use client'` boundary kept low** (§ 3). Only the animated leaves (the hero descent container, each bay's animated wrapper, the threshold/shaft transition) are client components. The hero wordmark text, every bay's title/pitch/links, and the directory are **real server-rendered DOM** regardless of whether GSAP ever runs — that is the no-JS floor ADR-003 builds the degradation contract on. GSAP only _enhances_ this floor; it never _creates_ content.
- **Reduced-motion + responsive via `gsap.matchMedia()` inside the setup callback** — one `mm.add({ reduced: '(prefers-reduced-motion: reduce)', desktop: '(min-width: 768px)', mobile: '(max-width: 767px)' }, ...)` per animated site; `matchMedia` contexts are reverted by the enclosing `gsap.context()`. This is the **single** mechanism for both the three-tier degradation _and_ the mobile-simplified bay choreography (Task 4.2's "collapse the pins to a clean vertical stack on small widths") — never an ad-hoc `window.matchMedia` read.
- **THE refresh-coordinator rule (load-bearing — atrium has 7 pins).** No section calls `ScrollTrigger.refresh()` in isolation. Every `useGsapEffect` setup calls `requestGlobalRefresh()` on completion (the hook does this for free), which debounces all calls into a single coordinated refresh on the next frame after the last section registers its triggers, and that coordinator calls **`ScrollTrigger.sort()` BEFORE `ScrollTrigger.refresh()`**. This is non-negotiable here: with a `{ idle: true }` hero pin frequently created _last_ (after the six bay pins) and ~1 viewport-plus of hero pin-spacer, a downstream bay that refreshed first would measure its `start: 'top top'` against a document missing the hero's spacer and pin too early (the razors-edge "gallery odpala się w trakcie services" bug, multiplied by six). `sort()` reorders triggers by `refreshPriority` then document position so every upstream pin's spacer is applied before each downstream bay is measured — order-independent of which GSAP chunk resolved first. The coordinator also refreshes on `window` `load` (fonts/images settled) and on a debounced `resize`.
- **SSR / hydration / CLS safety.** Pinned sections reserve their layout footprint in CSS so first paint matches the pinned state and the pin does not shift layout (CLS < 0.1, a success criterion). Pin via **transform** — no pinned section animates `width`/`height`/`top`/`left`/`margin`; transforms and opacity only. The hero wordmark occupies its resting layout at first paint (it _is_ the LCP candidate — type/CSS, not an image), so the pin measures a stable layout.
- **Performance contract (binds every scroll site).** Transform/opacity only; `will-change` applied **narrowly and transiently** (added at scrub start, removed on completion) — never blanket on the large dark gradient surfaces, to avoid compositor-memory blowups on mid-tier mobile; the scrub is rAF-driven by ScrollTrigger (no manual scroll listeners, no long tasks) so INP < 200 ms and 60 fps hold. The volumetric-light background and anti-banding grain are CSS/SVG, not WebGL, tuned to be invisible to the budget.

**CSP posture (confirmed from razors-edge's verified result, set in Task 1.1, verified in Task 1.2):** GSAP core + ScrollTrigger + `@gsap/react` do **not** use `eval`/`new Function` — they run clean with **no `unsafe-eval`**. The production CSP is the razors-edge-proven string:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`script-src 'unsafe-inline'` is required (a bare `script-src 'self'` blocks Next 15's unhashed inline bootstrap scripts + the next-themes flash-guard and kills hydration — verified in razors-edge, not theoretical). `style-src 'unsafe-inline'` is required and accepted (Next/Tailwind inject inline styles; GSAP writes inline `style` transforms during scrubs, which cannot be nonce'd). **No `unsafe-eval`.** Full header set ships too: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. **atrium has no zod-on-the-client validator firing at runtime in render paths** (the only Zod parse runs at module load, build-time — ADR-003), so the razors-edge `D-CSP-1` zod-`new Function` eval-probe defect does **not** apply here; still, verify the smoke ScrollTrigger fires **zero** CSP violations under **`next build && next start`** (NOT `next dev` — `next dev` cannot run under a CSP forbidding `unsafe-eval`). The v1.1 nonce-hardening debt (drop both inline grants via per-request nonce middleware) is the same carried debt razors-edge noted.

**Kinetic typography — free GSAP core only, no Club plugins.** The wordmark descent and the per-bay title resolves use **real-DOM type + CSS + GSAP transforms** — the razors-edge no-SplitText technique: real text in the DOM (sharp at every width, SEO/SR/no-JS-complete), with the kinetic resolve driven by variable-font `font-variation-settings` (weight/width settle), `clip-path` wipes, and GSAP transform/opacity. SplitText/MorphSVG (Club GreenSock) are **out**; introducing one requires its own ADR (PLAN out-of-scope).

### Consequences

- **Positive.**
  - Single-library is the § 15 ideal, and atrium reaches it honestly — one mental model, the smallest dependency surface, no Motion bundle on the most-judged page. The reviewer audits "is all motion GSAP or CSS?" with a binary rule.
  - Reusing the razors-edge `loadGsap()` + `useGsapEffect` + refresh-coordinator shape means the frontend-engineer inherits a proven, CSP-clean, code-split, leak-free GSAP integration instead of rediscovering it — and the `sort()`-before-`refresh()` rule (which atrium needs _more_ than razors-edge did) arrives pre-solved.
  - Code-splitting GSAP off the initial bundle directly protects the Lighthouse ≥ 95 ×4 budget the page is judged hardest on; the no-JS floor + transform-only + transient `will-change` discipline are engineered in at the design level, not as a cleanup pass.
  - CSP posture is fixed before the scaffold from a _verified_ string, so meld's `next dev`-vs-CSP surprise cannot recur.

- **Negative.**
  - Seven sequential pins (hero + six bays) is a real performance and correctness load. Mitigation: the refresh-coordinator `sort()` rule makes pin ordering correct; the `matchMedia` mobile branch collapses the bay pins to a clean vertical stack on phones; and the planner's flagged spike (verify six pins hold 60 fps on a mid-tier laptop _and_ mobile, `AGENT_NOTES.md`) is carried into Task 4.2 — if six full pins are too heavy, the documented fallback is fewer/lighter pins (pin the hero, scroll-reveal the bays) since the "tour" reading matters more than literally pinning all six.
  - Single-library means a v2 surface that genuinely needs presence tracking would require adding Motion under a new ADR rather than it already being present — an accepted, documented cost of honouring § 15 now rather than pre-provisioning.
  - `script-src`/`style-src 'unsafe-inline'` are weaker than a nonce policy, but unavoidable given Next/Tailwind inline styles + GSAP inline transforms; the v1.1 nonce-hardening debt is recorded, same as razors-edge.

- **Follow-up tasks.**
  - **Task 1.1 (frontend-engineer):** set the production CSP string above + the full security-header set in `next.config.ts` `headers()`.
  - **Task 1.2 (frontend-engineer):** author atrium-local `src/lib/gsap/{register,use-gsap-effect,refresh-coordinator}.ts` from the proven razors-edge shape; stand up a smoke ScrollTrigger via `useGsapEffect` + `gsap.matchMedia()`; verify cleanup-on-unmount, StrictMode double-invoke safety, and **zero CSP violations** under `next build && next start`; record the verified CSP string in `AGENT_NOTES.md`; remove the smoke before Phase 3. Do **not** install Motion.
  - **Task 4.2 (frontend-engineer):** wire the six bay pins through the coordinator (the `sort()`-before-`refresh()` ordering); run the six-pins-at-60fps spike on desktop + mobile before over-investing; collapse to the documented lighter-pin fallback if the budget fails.
  - **Phase 5 (reviewer):** audit that all GSAP is inside `useGsapEffect` with a scope, no `window.matchMedia` ad-hoc reads, no layout-property animation, `will-change` transient, no Motion dependency, and `ScrollTrigger.refresh()` is never called outside the coordinator.

### References

- **razors-edge `web/src/lib/gsap/{register,use-gsap-effect,refresh-coordinator}.ts`** — the proven code-split `loadGsap()` + `gsap.context()`-cleanup hook + the `sort()`-before-`refresh()` coordinator atrium re-authors locally. **razors-edge `AGENT_NOTES.md`** — the verified production CSP string (Phase 1 entry), the GSAP-clean-under-CSP proof, the "Gallery early-pin bugfix — the GSAP refresh-order rule" entry, the `D-CSP-1` zod-eval note (does not apply to atrium), and the `IntersectionObserver`-header-is-not-a-violation precedent.
- **razors-edge `DECISIONS.md` ADR-002 / ADR-004** — the `useGSAP` integration contract, the CSP posture, the no-Club-plugin wordmark-split technique atrium reuses for its kinetic titles.
- **`docs/conventions.md` § 3** (low `'use client'` boundary), **§ 15** (one animation library default; second library needs an ADR), **§ 13** (no premature `packages/*` extraction — the GSAP utils stay atrium-local).
- **CLAUDE.md § 4** (CSP / Lighthouse ≥ 95 / reduced-motion / CWV), **§ 5** (wow moment).
- **ADR-001** — ratified GSAP primary + deferred this split + integration decision here.

---

## ADR-003: Project-data model, GITHUB_BASE strategy, signature-hue tokens, scroll architecture, and the three-tier degradation contract

**Status:** accepted
**Date:** 2026-06-09

### Context

ADR-001 fixed the typed-`projects.ts` model, the `GITHUB_BASE` placeholder, sovereign tokens, and the six-signature-hue strategy in principle, and deferred the concrete shapes to this ADR (Task 0.2). This ADR pins, concretely enough for the frontend-engineer to build Phases 2–4 against: (1) the `Project` Zod schema + `src/data/projects.ts` field set and the six canonical entries' sourcing; (2) the `GITHUB_BASE` repo-URL shape and the no-remote-yet presentation; (3) the atrium-local six-signature-hue token **names** + per-project mapping + contrast obligations (actual OKLCH values are Task 2.1); and (4) the hero-descent → six-pinned-bays → directory scroll architecture + the three-tier degradation contract.

The data is six fixed, hand-authored entries, validated by Zod at module load (build time) — there is nothing to fetch or administer (the web-only thesis, ADR-001). The repo has **no git remote** (CLAUDE.md § 10), so repo links must be one flippable seam, never scattered broken inline URLs. The six pitches/stacks/demo-URLs are sourced verbatim from the root `README.md` project table.

### Options considered

**`GITHUB_BASE` repo-URL shape:**

- **R1. Monorepo deep-link: `${GITHUB_BASE}/tree/main/projects/<slug>`.** Matches the actual repository layout today (one monorepo, six `projects/<slug>` folders). The instant a remote exists, flipping one env var makes all six links real and _correct_ (they deep-link to each project's folder). **Picked.**
- **R2. Split-repo: `${GITHUB_BASE}-<slug>`** (one repo per project). Only correct if the owner later publishes per-project repos — not the current reality. Recorded as the documented migration: if the owner splits repos, change the single `repoUrl` derivation, not six call sites.

**No-remote-yet presentation (how the repo affordance looks before `GITHUB_BASE` is real):**

- **U1. Live `<a>` to the computed placeholder URL.** Honest-looking but **dishonest in fact** — it navigates to a 404 / a non-existent `github.com/<owner>/<repo>` the moment a viewer clicks. On the portfolio's most-judged page, a recruiter clicking "GitHub" and hitting a 404 is the worst possible signal. **Rejected.**
- **U2. A disabled / `aria-disabled` "repo" affordance with a tooltip.** Renders the repo control as present but non-navigating, with an accessible explanation ("Source link available on request" / "Repository link coming soon"), `aria-disabled="true"`, removed from the tab/navigation contract as a link (it is not an `<a href>` to nowhere). Honest, never a broken click, and the single `GITHUB_BASE` seam still drives it: when the env var flips from the placeholder to a real base, the affordance _becomes_ a live `<a>` automatically (a `REPO_LINKS_LIVE = GITHUB_BASE !== PLACEHOLDER` boolean gates render vs disabled). **Picked.**
- **U3. Hide the repo control entirely until a remote exists.** Cleanest but loses the "every project has demo + repo, twelve links" IA the PLAN specifies and the affordance-becomes-live seam. **Rejected** — U2 keeps the IA honest and the seam visible.

**Project-data model:** M1 (one typed Zod-validated module) was fixed in ADR-001; not re-litigated. This ADR only fixes the field set + schema.

### Decision

**`Project` Zod schema (`src/lib/schemas/project.ts`) and `src/data/projects.ts`.** The schema, the contract validated at module load (a malformed entry fails the build loudly):

- `slug: z.enum(['tape','meld','razors-edge','pulse','apex','atlas'])` — fixed set, also the canonical order key.
- `name: z.string()` (display name), `tagline: z.string()` (a tight ≤~8-word label for the bay), `pitch: z.string()` (the recruiter-facing one/two-line description, **sourced verbatim from the root `README.md` project table**).
- `category: z.enum(['api-heavy','web-only'])`.
- `backend: z.enum(['Elysia (Bun)','Hono (Node)','NestJS','Fastify']).nullable()` — non-null only for the four api-heavy projects; `null` for razors-edge/apex.
- `stack: z.array(z.string()).min(1)` — the key stack chips (sourced/condensed from the README Stack column; the bay shows a curated subset, not the full string).
- `accentToken: z.string()` — the CSS custom-property _name_ of the bay's signature hue (e.g. `'--bay-tape'`); the atrium-local token, never a sibling import.
- `wowMoment: z.string()` — the one-line "what holds you for five seconds" per project (authored from each project's own wow, e.g. tape's live footprint chart, atlas's 60 fps glide between 1 Hz ticks, apex's WebGL configurator, meld's sub-100 ms presence, pulse's self-driving incident state machine, razors-edge's blade-sweep hero).
- `demoUrl: z.string().url()` — the **real public Fly URL**, linked **normally** (the internal "Fly stopped to control cost" status is **never** surfaced — no "may be sleeping" wording; auto-start on URL hit covers the viewer). The six: `https://tape-demo.fly.dev`, `https://meld-demo.fly.dev`, `https://razors-edge-demo.fly.dev`, `https://pulse-demo-web.fly.dev`, `https://apex-rentals.fly.dev`, `https://atlas-ops.fly.dev`.
- `repoUrl: z.string().url()` — **derived**, never inline: `repoUrl: \`${GITHUB_BASE}/tree/main/projects/${slug}\``. The schema validates the derived value is a URL.
- `previewImage: z.string().optional()` — optional AVIF thumbnail (Task 4.5, non-blocking; bays read complete without it; never the LCP).
- `year: z.number().int()` — a **fixed** field, not `new Date()`-computed (determinism — no `Date.now()`/`Math.random()` in render).

`src/data/projects.ts` exports `PROJECTS: readonly Project[]` in the canonical order **tape → meld → razors-edge → pulse → apex → atlas** (root README/PROGRESS slots 1–6), each entry `Project.parse(...)`-validated at module load (or one `z.array(Project).parse(...)` over the literal). Unit tests (Phase 6) assert all six present, in order, valid demo URLs, repo URLs derived from `GITHUB_BASE`, correct category/backend badges, and no inline `github.com` string outside `GITHUB_BASE`.

**`GITHUB_BASE` constant + no-remote presentation.** In `src/lib/site-config.ts`:

```
const GITHUB_PLACEHOLDER = 'https://github.com/janantczak/portfolio'; // documented placeholder — no remote exists yet (CLAUDE.md § 10)
export const GITHUB_BASE = process.env.NEXT_PUBLIC_GITHUB_BASE ?? GITHUB_PLACEHOLDER;
export const REPO_LINKS_LIVE = GITHUB_BASE !== GITHUB_PLACEHOLDER;
```

Repo-URL shape is **R1 (monorepo deep-link)**: `${GITHUB_BASE}/tree/main/projects/<slug>`. Presentation is **U2**: while `REPO_LINKS_LIVE` is false, the repo affordance renders as a **disabled, `aria-disabled="true"`, non-navigating control** (not an `<a href>` to a 404) with an accessible tooltip/label ("Repository link available once published"); the **demo** link is always a real live `<a>`. The instant `NEXT_PUBLIC_GITHUB_BASE` is set to a real base, `REPO_LINKS_LIVE` flips true and every repo affordance becomes a live `<a href={repoUrl}>` with **no other code change** — the single seam. (Split-repo R2 is the documented migration if the owner later publishes per-project repos: change only the `repoUrl` derivation.) `.env.example` documents `NEXT_PUBLIC_GITHUB_BASE` (and `NEXT_PUBLIC_SITE_URL`); the placeholder owner/repo slug is recorded in `AGENT_NOTES.md` for the owner to confirm/correct.

**Six signature-hue token names + per-project mapping (atrium-local, § 14 — names + mapping fixed here; OKLCH values are Task 2.1).** Each bay borrows a single hue that _evokes_ its project, defined as an atrium-local token (NOT imported from the sibling), hand-tuned to atrium's contrast/harmony. Token names + evocation mapping:

| `accentToken`       | Project     | Evokes                                                   |
| ------------------- | ----------- | -------------------------------------------------------- |
| `--bay-tape`        | tape        | slate / cyan (orderflow terminal, live Canvas tape)      |
| `--bay-meld`        | meld        | collaborative warm (multi-user presence, warm paper)     |
| `--bay-razors-edge` | razors-edge | brass / warm amber (dark-luxe metallic edge)             |
| `--bay-pulse`       | pulse       | status green / amber (uptime / incident states)          |
| `--bay-apex`        | apex        | premium chrome / cool blue (configurator, premium metal) |
| `--bay-atlas`       | atlas       | control-room green (geospatial ops console)              |

Each hue ships as a small token set (a base, a text-safe variant, and an on-color where used as a fill — the razors-edge brass/brass-text two-treatment lesson) so a hue used as **text** clears **≥ 4.5:1** and as a **UI/accent** boundary clears **≥ 3:1**, in **both** the dark canonical theme **and** the intentional light "architectural daylight" theme. **Contrast wins over literal evocation** — if a literal hue fails light-theme contrast, it is re-tuned (the razors-edge brass-vs-contrast precedent); the goal is "reads as evoking the project" within atrium's harmony, not a pixel-match of the sibling's palette. atrium's own chrome stays near-monochrome (light-on-near-black + one neutral warm accent for the wordmark/threshold); the six hues are the _per-bay_ accents only.

**Scroll architecture: hero-descent → six pinned bays → directory.** The single long-form route, in DOM/scroll order, with the stage hand-offs:

1. **Hero / threshold (pin 0).** First paint = the `ATRIUM` wordmark in the warm shaft of light (the LCP candidate — type/CSS, never an image). One pinned, scrubbed **descent**: the wordmark scales/parallaxes as the viewer "drops through" it, the single shaft opening into the atrium-of-light colonnade (CSS/SVG gradients + layered parallax planes, no WebGL). **Hand-off:** the descent _resolves into_ the first bay — the scroll never stalls on a finished animation; the descent _is_ the transition into the gallery. The wordmark text is real DOM (no-JS/SR/SEO floor).
2. **Six pinned bays (pins 1–6), one per `PROJECTS[i]` in canonical order.** Each bay pins; as it locks into frame its kinetic title **resolves** (variable-font weight/width settle + a `clip-path` wipe from the bay's signature hue into legible title type — real-DOM type, no Club plugin); the pitch reveals, a stack ribbon + an `api-heavy · <backend>` / `web-only (creative)` badge + the wow-moment line animate in, the optional preview still and the **two unmissable outward links** (Live demo / GitHub-or-disabled-affordance) settle into a fixed, discernible-named position. Each bay carries its `accentToken` hue. The bay-to-bay connective tissue is the recurring **threshold / shaft-of-light** transition (one reusable component) — the scroll reads as moving from one lit bay to the next. All seven pins are choreographed through the **refresh-coordinator** (ADR-002's `sort()`-before-`refresh()` ordering — load-bearing with this many pins).
3. **Directory (arrival) — the resolution and the load-bearing floor.** A calm, fully-legible grid/list of all six projects (name, pitch, category badge, both links) + the portfolio range statement (root README Philosophy + PROGRESS composition tracker: "six showcases, four api-heavy across four distinct backends — Elysia/Bun, Hono, NestJS, Fastify — plus two creative web-only showcases; one quality bar"). This section is **built first to first-class quality** (planner flag): it is simultaneously the no-cinema reachable index, the reduced-motion render target, and the no-JS render target — all twelve outward links present and reachable here without scrolling the cinema.
4. **About/author + contact**, then **the designed footer** (wordmark, compact six-link repeat, `mailto:` + profile link once `GITHUB_BASE` is real, `lucide-react` social icons, credits) — per PLAN IA.

**Three-tier degradation contract** (all via `gsap.matchMedia()` + a real-DOM floor; every tier is the same single codebase — "render the floor, add the cinema," never a second build):

- **Tier 1 — full cinema (JS on, motion OK):** the pinned hero descent + six pinned bays + threshold transitions above, all transform/opacity, rAF-scrubbed, 60 fps.
- **Tier 2 — `(prefers-reduced-motion: reduce)`:** **no pin, no scrub, no descent, no parallax — and nothing frozen mid-transition.** The page renders as the **static directory** top-to-bottom: the hero shows its composed _resting_ frame (wordmark legible in the shaft, idle drift disabled), each bay shows its _resolved_ final composition (title legible, pitch + links shown) in a clean vertical stack, the directory floor fully present. The `reduced` branch of each `gsap.matchMedia()` simply **does not create** the pin/scrub; it lands on the composed frame. Critically — every tier lands on a CLEAN composed frame (the razors-edge "never freeze mid-transition" lesson, which its designer-critic flagged as D-07).
- **Tier 3 — no-JS / failed hydration:** the page renders server-side as the **complete directory** — the hero wordmark + one-liner, all six bays' titles/pitches/badges/wow-lines, and all twelve outward links (demo live `<a>`; repo as the U2 disabled affordance until `REPO_LINKS_LIVE`) in real DOM, plus the directory section and footer. Because all content is server-rendered real DOM and GSAP only enhances it, screen readers and crawlers always get the full page regardless of JS. The cinema is purely additive over a directory that always works.

### Consequences

- **Positive.**
  - One typed, Zod-validated `projects.ts` is the single source of truth — links, pitches, stacks, accents are never inline; a seventh project is a one-array-entry edit; a malformed entry fails the build, not the UI.
  - The single `GITHUB_BASE` seam + the U2 disabled-affordance means **no viewer ever clicks a broken GitHub link** on the most-judged page, the IA still shows "demo + repo per project," and one env var flips all six repo links live with zero other changes the instant a remote exists.
  - The six signature-hue tokens (names + mapping fixed, values deferred to the contrast pass) make the portfolio's range _visible_ as a tour of differently-lit rooms — the strongest way to show variance — without a single § 14 sibling-token import.
  - The directory-as-floor design makes Tier 2 (reduced-motion) and Tier 3 (no-JS) "render the floor, skip the cinema," not a second codebase — and makes the page's accessibility + SEO + no-JS surface first-class, not a fallback stub.
  - All content real-DOM + frozen `year` field + no runtime randomness keeps Playwright/Lighthouse/screenshots reproducible.

- **Negative.**
  - The U2 disabled repo affordance must be visibly intentional ("coming soon"), not look like a _broken_ button — a small design call carried to Task 4.1 / the designer-critic; whatever the styling, it must never read as a failed link.
  - The placeholder `GITHUB_BASE` owner/repo slug is a guess until the owner confirms it — recorded in `AGENT_NOTES.md` for confirmation; wrong-but-placeholder is harmless because U2 never navigates to it.
  - Sourcing pitches verbatim from the root README couples atrium's copy to that table — if a sibling's README pitch changes, atrium's entry must be updated (acceptable: six fixed strings, and the README is the deliberate single source of truth).
  - Six resolving kinetic titles + six signature hues contrast-verified in both themes is real Task 2.1/4.1 work; mitigated by the two-treatment token set per hue and the "contrast wins over evocation" rule.

- **Follow-up tasks.**
  - **Task 2.1 (frontend-engineer):** author the six `--bay-*` token sets (base/text/on-color) in `globals.css`, contrast-verified ≥ 4.5:1 text / ≥ 3:1 UI in both themes; document the OKLCH values + per-bay mapping in `AGENT_NOTES.md`.
  - **Task 2.3 (frontend-engineer):** author `src/lib/schemas/project.ts` (the schema above) + `src/lib/site-config.ts` (`GITHUB_BASE` / `REPO_LINKS_LIVE`, R1 shape) + `src/data/projects.ts` (six entries, pitches/stacks verbatim from root README, real demo URLs, derived repo URLs, `accentToken`s, fixed `year`), `z.array(Project).parse`-validated at module load; `.env.example` with `NEXT_PUBLIC_GITHUB_BASE` + `NEXT_PUBLIC_SITE_URL`.
  - **Task 4.1 (frontend-engineer):** the reusable bay component — render from a `Project`, the U2 disabled-vs-live repo affordance gated on `REPO_LINKS_LIVE`, both links with discernible names ("tape — live demo" / "tape — GitHub repo") + `rel="noopener noreferrer"` `target="_blank"`; record the final repo-affordance styling decision in `AGENT_NOTES.md`.
  - **Task 4.2 (frontend-engineer):** the six pins through the coordinator (ADR-002); the `matchMedia` mobile/reduced branch collapsing pins to the vertical stack.
  - **Task 4.3 (frontend-engineer):** the directory floor (built first-class — it is the Tier-2/Tier-3 target).
  - **Task 3.3 (frontend-engineer):** wire the three-tier contract — the reduced-motion `matchMedia` branch landing on the composed frame, the no-JS real-DOM directory.
  - **Task 6.1/6.2 (test-engineer):** Vitest on the schema/data (six in order, valid demo URLs, derived repo URLs, no inline `github.com`); Playwright on the twelve links, the reduced-motion static-directory path (no pin, nothing frozen), theme toggle, keyboard reachability, the no-JS render.

### References

- **Root `README.md` (project table + Philosophy)** — the verbatim source for the six pitches/stacks/categories/backends/demo URLs and the directory range statement. **Root `PROGRESS.md`** — the composition tracker (4 api-heavy / 4 backends / 2 web-only) the range statement and JSON-LD `ItemList` encode; and the internal (do-not-surface) Fly-stopped status.
- **ADR-001** — the typed-`projects.ts` / `GITHUB_BASE` / sovereign-token / six-hue strategy this ADR makes concrete. **ADR-002** — the GSAP integration + refresh-coordinator the seven-pin scroll architecture runs on, and the no-Club-plugin kinetic-title technique.
- **razors-edge `AGENT_NOTES.md` / `DECISIONS.md` ADR-004** — the two-treatment accent-token + contrast lesson (brass/brass-text, "contrast wins"), the `NEXT_PUBLIC_SITE_URL` placeholder pattern, and the "reduced-motion must land on a clean composed frame, never a frozen mid-transition" (D-07) lesson the Tier-2 contract honours.
- **`docs/conventions.md` § 14** (sovereign tokens — the six hues are atrium-local), **§ 5** (Zod schemas in `src/lib/schemas/`), **§ 3** (server components — the directory/content is server-rendered real DOM). **CLAUDE.md § 4** (a11y / SEO / no-JS / contrast), **§ 10** (no remote → the `GITHUB_BASE` placeholder).
- **`docs/inspirations.md`** — Olivier Larose (the descent + six-bay sequential pinned tour), Stripe (long-form scroll + type as a primary element), Aristide Benoist (kinetic title resolves), Linear + Klim (directory chrome restraint + display type as specimen).

---
