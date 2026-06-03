# razors-edge — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour, animation library, design-token posture, and booking-mock architecture

**Status:** accepted
**Date:** 2026-06-03

### Context

`razors-edge` is a cinematic dark-luxe marketing website for an upscale barbershop / men's grooming studio (brand display: **Razor's Edge**), with a fully mocked but delightful multi-step booking flow as its centerpiece interaction. It takes slot 3 in the portfolio composition. The brief is owner-confirmed on the load-bearing decisions, and ADR-001 ratifies four of them so downstream agents work against a fixed footing:

1. **(a)** web-only vs api-heavy per `docs/conventions.md` § 10 — owner explicitly chose **web-only with a mocked booking flow**;
2. **(b)** the single primary animation library per § 15 — the dark-luxe, photo-forward, scroll-driven brief points at **GSAP**;
3. **(c)** the design-token posture — sovereign per § 14 (no reuse from `tape` or `meld`);
4. **(d)** the booking-mock architecture — client-side wizard state + seeded deterministic availability, no backend.

Portfolio-composition context that frames (a): slots 1 and 2 (`tape` on Elysia/Bun, `meld` on Hono/Node) already satisfy the § 12 backend-variance requirement (two distinct frameworks) and put the portfolio at 2 of the required 2–3 api-heavy projects. The owner's deliberate call is that slot 3 is a **web-only creative / marketing showcase** that demonstrates a different axis of range (art direction + scroll choreography) the two systems projects do not, and that the open **NestJS api-heavy slot stays reserved** for a later project (the planned slot-4 AI agentic tool). This ADR records that the web-only call is intentional and compliant, not drift.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (Next.js static-first + route handlers / server actions for the mocked submit).** None of the five § 10 api-heavy triggers fires: no WebSocket/SSE, no background jobs/queue/cron, no non-Next API consumer, no heavy auth flow, and the only "domain logic" (deterministic availability-slot generation + wizard state transitions) is small, pure, and tests perfectly in isolation in `src/lib/` with Vitest — it does not benefit from a separate service. **Picked (and owner-confirmed).**
- **B. api-heavy with a real booking backend (e.g., NestJS + Drizzle + Postgres, real availability + persistence).** Technically buildable and would advance the NestJS variance slot, but it is ceremony this brief does not need — the showcase value here is motion + art direction + a believable client-side flow, not a CRUD booking service. Forcing a backend would violate CLAUDE.md § 3 ("deviate only when the project genuinely requires it") in reverse. Reserved as the explicit v2 path (README notes "wire a real booking API"), and the NestJS slot is preserved for a project that genuinely needs enterprise backend patterns. **Rejected for v1 on need grounds, not capability grounds.**

**Primary animation library (per § 15):**

- **A1. GSAP + ScrollTrigger.** The wow moment is a pinned, scrubbed, multi-element scroll timeline (blade sweep, two wordmark halves at different parallax rates, brass edge tracking, photo Ken-Burns, mid-timeline type-split state change, hand-off into the next section). The recurring blade-sweep dividers and the pinned horizontal-scroll gallery are the same shape. This is the § 15 case for GSAP: scroll-driven timelines + SVG choreography + many independently animated elements where "Motion's declarative model fights you". **Picked.**
- **A2. Motion (primary).** Excellent for the React-state component transitions (wizard steps, dialogs, hovers) and `useScroll` can drive single-value scroll springs, but the pinned multi-element scrub with a mid-timeline state change is awkward and verbose in Motion. Retained as a **scoped secondary** for component-state transitions only — a deliberate, bounded two-library posture (no scroll work in Motion, no React-state transitions in GSAP), which the architect ratifies or collapses to single-library in ADR-002. **Not the primary.**
- **A3. React Three Fiber.** Rejected by § 15 explicitly — the cinematic grain + parallax surface is 2D (CSS/SVG noise + transforms), not WebGL/3D. R3F "is not for fancy 2D backgrounds". Adding a 3D runtime would also threaten the Lighthouse ≥ 95 mobile performance budget for no design payoff. **Rejected.**

**Design-token posture:**

- **D1. Sovereign tokens, built from scratch.** Required by § 14 (design tokens / theme variables / Tailwind preset never leave the project that owns them). The dark-luxe brass-on-near-black identity is unique to this project and must not borrow tape's slate/cyan or meld's warm-paper/OKLCH-user palette. **Picked (mandated).**
- **D2. Reuse/extend tape or meld tokens.** Forbidden by § 14 — a shared theme collapses the portfolio into one repeated identity. **Rejected (policy).**

**Booking-mock architecture:**

- **M1. Client-side wizard (Zustand) + seeded deterministic availability + mocked submit.** Wizard machine in Zustand; per-step forms in react-hook-form + Zod; mock data fetched via TanStack Query against a local seeded source (with artificial latency for realistic loading states); availability derived by a pure `getAvailability` function over seeded working hours / days off / pre-bookings against a frozen `now`; submit validated by the shared Zod schema in a thin route handler / server action returning a deterministic confirmation + client-side `.ics`. Feels real, persists nothing, reproducible for tests and screenshots. **Picked.**
- **M2. `localStorage`/server-persisted "real" bookings.** Out of scope — introduces state that complicates determinism and pulls toward a backend the web-only thesis rejects. The back/forward survival question (in-memory vs `sessionStorage` for the wizard draft) is a smaller sub-decision deferred to ADR-003. **Rejected for v1.**

### Decision

**Stack flavour: web-only.** **Primary animation library: GSAP 3.x + ScrollTrigger**, with **Motion permitted only as a scoped secondary for React-state component transitions** (a bounded two-library posture, ratified/tightened by the architect in ADR-002, with single-library as the preferred end state if achievable without fighting the tooling). **Design-token posture: sovereign — no reuse from `tape` or `meld` (`docs/conventions.md` § 14).** **Booking architecture: fully client-side mocked — Zustand wizard machine + react-hook-form/Zod steps + TanStack Query over a seeded local source + a pure deterministic `getAvailability` over a frozen `now` + a mocked submit returning a deterministic confirmation and a client-side `.ics`.**

The four picks converge on the same thesis: this slot's portfolio value is **range** — proof the author can carry a single arresting art direction across a complete marketing site and a multi-step interactive flow at production quality, without leaning on a backend to look impressive. Web-only is the honest flavour for that thesis; GSAP is the honest tool for a scroll-driven cinematic hero; sovereign tokens are mandatory; and a believable client-side booking flow demonstrates product polish (TanStack Query ergonomics, RHF/Zod forms, Zustand machine, accessible widgets) without inventing a service that does not earn its keep.

**Three integration mechanisms are deliberately deferred** to the architect at implement kickoff, where they benefit from a brief prototype spike rather than premature lock-in: the precise animation split + GSAP-with-Next-App-Router integration posture (ADR-002), the booking-mock state/persistence/fetch/submit details (ADR-003), and the hero technical layer contract + three-tier degradation (ADR-004).

### Consequences

- **Positive.**
  - The portfolio gains a clear range signal: a motion- and art-direction-led web-only showcase alongside two systems-heavy api-heavy projects. The § 12 constraint stays satisfied at the 3-project mark (2 api-heavy, 2 distinct backends) and the NestJS variance slot is preserved for a project that genuinely needs it.
  - GSAP ScrollTrigger is the right tool for the wow moment, the section dividers, and the pinned gallery — the frontend-engineer is not fighting a declarative model to choreograph a pinned multi-element scrub.
  - Sovereign tokens force a fresh, ownable visual identity (dark-luxe brass-on-near-black + an intentional editorial light theme) — exactly the per-project personality § 14 exists to protect.
  - The mocked booking flow is fully deterministic (seeded faker + frozen `now`), so screenshots, Playwright runs, and the availability grid are reproducible — and nothing real is persisted, so there is no PII or security surface to defend beyond input sanitization and CSP.
  - No backend means a trivial deploy (static-first Next on a CDN/edge host) and a generous performance budget to spend on the hero animation while still hitting Lighthouse ≥ 95.

- **Negative.**
  - Two animation libraries (GSAP + scoped Motion) is a deliberate exception to the one-library default. Mitigation: the architect ratifies a hard boundary in ADR-002 (no scroll work in Motion; no React-state transitions in GSAP) and may collapse to single-library; the bundle cost is watched against the Lighthouse budget.
  - GSAP + Next 15 App Router needs care: SSR-safe registration, a low `'use client'` boundary for ScrollTrigger, cleanup on route change, and CSP compatibility without `unsafe-eval` (the meld CSP lesson applies). Mitigation: ADR-002 pins the integration pattern with a smoke test before Phase 3 commits.
  - A mocked booking flow can read as "fake" if the confirmation pretends to be real. Mitigation: the confirmation copy is gracefully honest ("demo booking — nothing was actually scheduled") without breaking the luxe tone; the README states the mock boundary and the v2 real-backend path.
  - Choosing web-only here means the five-project constraint must be watched: if the brief after this one is also web-only, the planner must flag it and recommend an api-heavy / NestJS brief so the 2–3 api-heavy / variance target stays reachable.
  - The cinematic hero's quality bar is high and the wow is the spine of the design — if the scrub cannot hit 60 fps within the performance budget, the design loses its anchor. Mitigation: ADR-004 fixes the layer model and the LCP/CLS-safe approach up front, and the success criteria gate fps explicitly.

- **Follow-up tasks.**
  - **ADR-002 (architect, implement-phase day 1):** ratify or tighten the GSAP-primary + Motion-scoped split (or collapse to single-library), and pin the GSAP-with-Next-15-App-Router integration pattern (registration, `'use client'` boundary, SSR-safe pinning, cleanup on route change, CSP no-`unsafe-eval` check).
  - **ADR-003 (architect):** booking-mock architecture — Zustand wizard store shape + persistence boundary (in-memory vs `sessionStorage`), the deterministic availability model (frozen `now`, seeded pre-bookings, the pure `getAvailability` contract), the TanStack Query mock-fetch layer (keys, artificial latency, source location), the mocked submit surface (route handler vs server action + shared Zod schema + `.ics`), and the single-service-vs-combo scope call.
  - **ADR-004 (architect):** hero technical contract — the layer model, the no-Club-plugin wordmark-split technique, the LCP (`priority` AVIF portrait) + CLS-safe pin strategy, and the three-tier degradation contract (full scrub / reduced-motion crossfade / no-JS static frame).
  - **Engineering kickoff (gated on ADR-002 + ADR-003 acceptance):** `frontend-engineer` starts the Phase 1 scaffold (Task 1.1) and proceeds through the phased task list.

### References

- **`docs/conventions.md` § 10–16.** Hard rules on web-only vs api-heavy (§ 10), backend choice (§ 11), portfolio composition (§ 12), the do-not-share black list incl. design tokens (§ 14), the animation-library policy (§ 15), and the workflow (§ 16). Every razors-edge decision traces to these.
- **CLAUDE.md § 3, § 4, § 5.** Stack hard-defaults + "deviate only when genuinely required"; the quality bar (theming, a11y, performance, SEO, security); the wow-moment mandate.
- **`docs/inspirations.md`.** Olivier Larose (scroll-driven storytelling + photographic art direction — the closest analogue to the hero and gallery), Stripe (long-form scroll with a custom element justifying its bundle; type as a primary element), Aristide Benoist (kinetic transitions / generative typography for the wordmark), Klim Type Foundry (display type as specimen), Linear (chrome restraint + micro-interaction bar for the booking flow).
- **tape `DECISIONS.md` ADR-001 (Elysia/Bun) + meld `DECISIONS.md` ADR-001 (Hono/Node).** The two api-heavy slots whose backend variance lets slot 3 be web-only without breaching § 12.
- **meld CSP lesson** (strict CSP forbids `unsafe-eval`; `next dev` cannot run under it). razors-edge must verify GSAP runs under strict CSP — carried as the ADR-002 / Task 1.3 compatibility check.

---

## ADR-002: Animation architecture — GSAP + scoped Motion, and the GSAP / Next 15 App Router integration contract

**Status:** accepted
**Date:** 2026-06-03

### Context

ADR-001 selected **GSAP 3.x + ScrollTrigger** as the primary animation library and left Motion as a _contested_ scoped secondary, explicitly tasking this ADR to either ratify the two-library posture or collapse to single-library (PLAN.md Task 0.1; `AGENT_NOTES.md` "Decisions to revisit" flags the two-library posture as "the most contestable call in ADR-001"). It also deferred the GSAP-with-Next-15-App-Router integration mechanics to a prototype-informed decision rather than premature lock-in.

Three forces converge here and must be pinned before the Phase 1 scaffold (Task 1.3 stands up a smoke ScrollTrigger and is gated on this ADR):

1. **Library boundary.** CLAUDE.md § 3 and `docs/conventions.md` § 15 forbid stacking three libraries and default to one. We are proposing two. That requires either a justified, hard, non-overlapping boundary or a collapse to GSAP-only.
2. **App Router / React 19 integration.** GSAP is a DOM-mutating, imperative, browser-only library. Next 15 renders Server Components by default and runs effects twice in dev StrictMode. ScrollTrigger pins by mutating layout. All of this must be made SSR-safe, hydration-safe, double-invoke-safe, and clean on route change — once, as a contract, so the frontend-engineer never improvises it per-component.
3. **CSP.** meld shipped a strict CSP and learned that `unsafe-eval` breaks `next dev`. We must confirm GSAP's CSP posture up front so the security baseline (CLAUDE.md § 4) is set correctly from Task 1.1, not retrofitted.

### Options considered

**Library boundary:**

- **A. GSAP-only (collapse to single-library).** Author every animation — scroll scrubs, dividers, the gallery, _and_ the wizard step transitions, dialog/popover mounts, hovers — in GSAP. One library, one mental model, smallest dependency surface, the § 15 default honoured literally. Cost: React-state-driven enter/exit (a step panel mounting/unmounting as Zustand `step` changes, a shadcn dialog opening) is awkward in GSAP — you hand-wire `gsap.fromTo` into mount effects and manage exit animations before unmount yourself, re-implementing what Motion's `AnimatePresence` gives for free. CSS transitions + `data-state` attributes (shadcn primitives already expose these via Radix) cover most of it, but coordinated exit-before-unmount and layout transitions are the rough edge.
- **B. GSAP primary + Motion scoped secondary, hard boundary.** GSAP owns 100% of scroll/pin/scrub/timeline/SVG. Motion owns _only_ React-state component transitions where `AnimatePresence` / `layout` earn their keep — wizard step enter/exit, modal/popover mount where a CSS `data-state` transition is insufficient. Two libraries, but provably non-overlapping. Cost: ~a Motion bundle on top of GSAP, and a discipline risk (an engineer reaching for the wrong tool).
- **C. GSAP primary + CSS-only for component transitions (no Motion).** Like B but the secondary is plain CSS `@keyframes` / `transition` driven by `data-state`/`data-step` attributes and `prefers-reduced-motion` media queries, with shadcn/Radix's built-in `data-state` animation conventions. Zero extra runtime. Cost: coordinated exit animations (animate-out _then_ unmount) require either keeping the node mounted during exit by hand, or accepting instant unmount on exit. For a wizard where steps slide in/out, a pure-CSS exit is achievable by animating the _outgoing_ and _incoming_ panel in a shared container keyed by step, without true presence tracking.

**GSAP integration pattern (orthogonal to the boundary choice):**

- **P1. `useGSAP()` from `@gsap/react`.** Official React hook; wraps `gsap.context()` + `useLayoutEffect` + automatic cleanup (reverts all GSAP animations and ScrollTriggers created in its scope on unmount/dep-change), and is StrictMode-double-invoke safe by design. Tiny, GSAP-maintained.
- **P2. Hand-rolled `useLayoutEffect` + `gsap.context()` + manual `ctx.revert()`.** No extra dependency, full control. Cost: re-implements exactly what `useGSAP` already does, and is the place double-invoke / cleanup bugs hide.

### Decision

**Ratify the two-library posture: GSAP primary + Motion scoped secondary (Option B), with a hard, written boundary — but with a standing instruction to collapse to GSAP-only if Motion fails to earn its bundle during Phase 4.** The boundary, verbatim, is the rule the frontend-engineer works against:

> **GSAP owns everything scroll-, pin-, scrub-, timeline-, and SVG-driven.** Zero React-state-driven component enter/exit animation is authored in GSAP.
> **Motion owns only React-state-driven component transitions** — wizard step enter/exit (`AnimatePresence`), and modal/popover/sheet mount where a `data-state` CSS transition is insufficient. **Zero scroll-driven animation, zero `ScrollTrigger`-adjacent work, and zero pinning is authored in Motion.** Motion's `useScroll`/`useTransform` are **banned** in this project — scroll is GSAP's exclusive territory.
> Hover/active micro-interactions and theme crossfade default to **CSS** (`data-state`, `transition`, `@media (prefers-reduced-motion)`), not Motion, unless a specific interaction provably needs presence/layout tracking.

Rationale for keeping two rather than collapsing now: the wizard is a five-step machine where each step panel mounts/unmounts on a Zustand `step` change, and `AnimatePresence` exit-before-unmount is the idiomatic, accessible, low-bug way to do that — hand-rolling it in GSAP (Option A) or accepting CSS's no-true-exit limitation (Option C) trades a small bundle for hand-wired lifecycle code in the project's most interaction-dense surface. That is the § 15 "Motion's declarative model is the right tool" case in miniature, mirror-imaged: GSAP for scroll, Motion for state. The posture stays _contestable_: per `AGENT_NOTES.md`, if during Phase 4 the step transitions prove cleanly expressible in CSS + GSAP and Motion earns its bundle nowhere else, the frontend-engineer raises it and we collapse to GSAP-only — single-library remains the preferred end state, this ADR just declines to force it before the wizard exists to judge.

**Integration pattern: `useGSAP()` from `@gsap/react` (Option P1), universally.** No raw `useLayoutEffect` + `gsap.context()` hand-rolling anywhere in the project. The integration contract, pinned:

- **Registration happens once, client-side.** A single `'use client'` module (`src/lib/gsap/register.ts` or equivalent) imports `gsap`, `ScrollTrigger`, and `useGSAP`, calls `gsap.registerPlugin(ScrollTrigger, useGSAP)`, and is imported only by client components that animate. ScrollTrigger is never imported into a Server Component.
- **`'use client'` boundary kept low** (`docs/conventions.md` § 3). Animated leaves (the hero, the gallery strip, a blade-sweep divider) are client components; their server parents pass already-fetched data and rendered children down. The hero's _content_ (wordmark text, portrait `<img>`, positioning copy) is real server-rendered DOM so it is present for SEO, screen readers, and the no-JS frame regardless of whether GSAP ever runs (this is the floor ADR-004 builds on).
- **All GSAP work lives inside `useGSAP(() => { ... }, { scope, dependencies })`.** The `scope` is a `useRef` on the animated container so selector text is scoped and cleanup is automatic; `useGSAP` reverts every animation and ScrollTrigger created in its callback on unmount and on dependency change, which is what makes route changes and StrictMode double-invokes safe without manual bookkeeping.
- **Reduced-motion and responsive branching via `gsap.matchMedia()` inside the `useGSAP` callback.** One `mm.add({ reduced: '(prefers-reduced-motion: reduce)', desktop: '(min-width: 768px)', ... }, (ctx) => { ... })` per animated site; `matchMedia` contexts are reverted automatically by the enclosing `useGSAP` scope. This is the single mechanism for the three-tier degradation (full / reduced) at every scroll site — never an ad-hoc `window.matchMedia` read.
- **SSR / hydration / CLS safety.** Pinned sections reserve their layout footprint in CSS so first paint matches the pinned state and ScrollTrigger's pin does not shift layout (CLS < 0.1, a success criterion). `ScrollTrigger.refresh()` is left to GSAP's own load/resize handling; we do not pin before fonts/images settle in a way that reflows — the hero portrait is `priority` and sized (ADR-004) precisely so the pin measures a stable layout. No pinned section animates `width`/`height`/`top`/`left` — transforms and opacity only (performance contract below).
- **Next scroll restoration coexistence.** The marketing page is a single long route; in-page anchor nav uses GSAP/ScrollTrigger-aware scrolling (or native smooth scroll that ScrollTrigger observes), and we keep Next's default scroll restoration. The `/book` route is a separate route with no pinned scroll, so scroll-restoration interplay is confined to the marketing route and verified by the Task 1.3 smoke test before Phase 3.

**CSP posture (confirmed, set from Task 1.1):** GSAP 3 core + ScrollTrigger + `@gsap/react` do **not** use `eval`/`new Function` in normal operation — only the GSAP `gsap.utils.toArray` / general API, none of which need `unsafe-eval`. The free plugins this project uses (ScrollTrigger only in v1; no Club plugins) are CSP-clean. **Production CSP target:** `script-src 'self'` (with a per-request nonce for Next's inline bootstrap if needed; `'unsafe-inline'` for scripts avoided where the framework allows, matching meld's strict posture) and explicitly **no `unsafe-eval`**. `style-src` will likely need `'unsafe-inline'` (Next/Tailwind inject inline styles; GSAP also writes inline `style` attributes for transforms, which CSP `style-src` governs via `'unsafe-inline'` — GSAP cannot use nonces for the inline styles it writes, so `style-src 'unsafe-inline'` is expected and acceptable). This is recorded so the frontend-engineer sets `style-src 'unsafe-inline'` deliberately, not as a surprise. Task 1.3 verifies the smoke ScrollTrigger runs under the production CSP in a `next build && next start` context (the meld lesson: `next dev` cannot be the CSP test surface).

**Performance / reduced-motion contract (binds every scroll site):**

- Animate **transform and opacity only** — no animation of layout-affecting properties (`width`, `height`, `top`/`left`, `margin`). The blade sweep, wordmark-half parting, parallax, and Ken-Burns are all `transform`/`opacity`.
- `will-change` is applied narrowly and transiently (added at scrub start, removed on completion) — never blanket on large surfaces, to avoid compositor-memory blowups that hurt mid-tier mobile.
- Every scroll site has a `(prefers-reduced-motion: reduce)` branch in its `gsap.matchMedia()` that degrades to a non-pinned, non-parallax crossfade/static state (the hero's reduced path is specified in ADR-004).
- The scrub is rAF-driven by ScrollTrigger (no manual scroll listeners, no long tasks during scrub) so INP stays < 200 ms and the hero holds 60 fps — both success criteria.

### Consequences

- **Positive.**
  - One unambiguous rule ("scroll = GSAP, state-transition = Motion, hover = CSS") the frontend-engineer and reviewer can enforce mechanically; no per-component re-litigation.
  - `useGSAP()` eliminates the entire class of GSAP-in-React bugs (StrictMode double-invoke, missing cleanup on route change, leaked ScrollTriggers) by construction — the reviewer audits "is all GSAP inside `useGSAP` with a scope?" rather than chasing leaks.
  - CSP posture is fixed before the scaffold: `script-src 'self'` / no `unsafe-eval`, with `style-src 'unsafe-inline'` consciously accepted for GSAP's inline transforms and Next/Tailwind. meld's `next dev`-vs-CSP surprise does not recur because Task 1.3 tests under `next build && next start`.
  - The transform/opacity + narrow `will-change` + `matchMedia` discipline protects the Lighthouse ≥ 95 budget and the 60 fps / CWV targets at the design level, not as a cleanup pass.

- **Negative.**
  - Two animation libraries remain a deliberate exception to the § 15 single-library default; the bundle cost (Motion on top of GSAP+ScrollTrigger) must stay inside the performance budget, and the boundary depends on discipline. Mitigation: the verbatim rule above, the reviewer audit, the standing collapse-to-GSAP-only instruction if Motion underdelivers in Phase 4.
  - `style-src 'unsafe-inline'` is weaker than a fully nonce-based style policy, but is unavoidable given GSAP's inline-transform writes and Next/Tailwind's inline styles; it is an accepted, documented trade rather than an oversight.
  - `useGSAP`/`@gsap/react` is a small additional dependency over raw GSAP, justified by the bug-class it removes.

- **Follow-up tasks.**
  - **Task 1.3 (frontend-engineer):** stand up the smoke ScrollTrigger using `useGSAP()` + `gsap.matchMedia()`, behind the low `'use client'` boundary, and verify (a) cleanup on unmount/route-change, (b) StrictMode double-invoke safety, (c) CSP-clean execution under `next build && next start` with `script-src 'self'`, no `unsafe-eval`, `style-src 'unsafe-inline'`. Record the verified CSP string in `AGENT_NOTES.md`. Remove the smoke section before Phase 3.
  - **Task 1.1 (frontend-engineer):** set the production CSP in `next.config.ts` `headers()` per the posture above (mirroring the header set meld's reviewer flagged: CSP, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
  - **Phase 4 (frontend-engineer):** when building the wizard (Task 4.5), evaluate whether Motion earns its bundle; if not, raise the collapse-to-GSAP-only in `AGENT_NOTES.md` for the architect.
  - **Phase 5 (reviewer):** audit that all GSAP is inside `useGSAP` with a scope, no Motion `useScroll`/`useTransform` exists, no layout-property animation, and `will-change` is transient.

### References

- **`@gsap/react` `useGSAP()`** — official React integration; `gsap.context()` + `useLayoutEffect` + auto-revert cleanup, StrictMode-safe.
- **`docs/conventions.md` § 3** (low `'use client'` boundary, server-by-default), **§ 15** (one animation library default; the documented exception process for a second).
- **CLAUDE.md § 4** (CSP / security baseline; Lighthouse ≥ 95; reduced-motion).
- **meld `AGENT_NOTES.md` / `REVIEW-PHASE-4.2.md`** — strict-CSP-vs-`next dev` lesson and the security-header set (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`) the razors-edge `headers()` block mirrors.
- **ADR-001** — ratified GSAP primary + Motion scoped, and deferred this integration/boundary decision here.

---

## ADR-003: Booking mock architecture — domain model, deterministic availability, wizard state machine, and the mocked submit surface

**Status:** accepted
**Date:** 2026-06-03

### Context

The booking flow is the centerpiece interaction (PLAN.md), fully client-side over seeded deterministic mock data, with no backend (ADR-001 web-only thesis). ADR-001 deferred the concrete state/persistence/fetch/submit mechanics and three sub-decisions to this ADR. **The owner has since resolved all three** that `AGENT_NOTES.md` flagged as undecided, and this ADR bakes those resolutions in:

1. **Combos: YES.** A service can be a combo (e.g. cut + beard) occupying a single longer slot; the availability model and the wizard must support a service `durationMin` that drives slot length. (This overrides the PLAN.md "v1 may scope to single-service" hedge — combos are in.)
2. **Wizard draft persistence: YES, via `localStorage`** (Zustand `persist`), surviving a refresh, with a versioned key and a clear/expiry policy. (This overrides the ADR-001 "in-memory vs `sessionStorage`" framing — `localStorage` is the call.)
3. **Gallery: horizontal pinned scroll** — recorded here only as a cross-reference; it is a GSAP/ADR-002 concern, not a booking concern.

The whole flow must be deterministic for tests, Playwright runs, and screenshots — which forces a frozen reference `now` and seeded mock data (the discipline tape and meld already established).

### Options considered

**Wizard draft persistence (the owner-resolved call, options recorded for the trail):**

- **A. In-memory Zustand only.** Simplest, most deterministic; loses the draft on any reload. Rejected by the owner — a real mobile client who fat-fingers a reload mid-booking loses everything.
- **B. `sessionStorage`.** Survives reload within a tab session, clears on tab close. Middle ground.
- **C. `localStorage` via Zustand `persist`. Picked (owner).** Survives reload and tab close; needs an explicit version + expiry + reconciliation policy (below), which is the cost of the durability.

**Mocked submit surface:**

- **S1. Next.js server action.** Idiomatic App Router mutation, co-located, no route plumbing, runs the shared Zod schema server-side. Picked.
- **S2. Route handler (`app/api/book/route.ts`).** Also valid; more ceremony for a same-page mutation. Server actions are preferred for same-origin mutations per `docs/conventions.md` § 3. Rejected in favour of S1, though either honours the shared-schema contract.

**`.ics` generation:**

- **I1. Hand-rolled minimal VEVENT string + `Blob` download.** ~30 lines, zero dependency, full control over the single event shape we emit. Picked.
- **I2. `ics` npm library.** Robust, but a dependency for one trivial deterministic event. Rejected on bundle-for-value grounds.

### Decision

**Domain model + Zod schemas (`src/lib/schemas/`, the shared contract per `docs/conventions.md` § 5):**

- **`Service`** — `{ id, slug, name, category: 'cut' | 'beard' | 'shave' | 'combo', description, durationMin, priceCents, currency, popular?: boolean }`. Fixed hand-curated menu; faker fills only flavor copy. **`durationMin` is the single driver of slot length** — combos simply carry a larger `durationMin` (e.g. cut 45, cut+beard 75). There is no separate "combo composition" model in v1: a combo is one `Service` row with a long duration and `category: 'combo'`. This keeps the availability model uniform — every booking, single or combo, is "find a contiguous free block of `durationMin`".
- **`Barber`** — `{ id, slug, name, title, bio, specialties: ServiceCategory[], portraitSrc, workingHours: WeeklySchedule, daysOff: ISODate[], lunch?: { startMin, durationMin } }`. A barber offers a service if `service.category ∈ barber.specialties`. Optional daily lunch break carves a hole in availability.
- **`WeeklySchedule`** — per-weekday `{ open: 'HH:mm', close: 'HH:mm' } | null` (null = closed).
- **`Booking`** (seeded pre-bookings) — `{ id, barberId, date: ISODate, startMin, durationMin }`. Seeded set per barber so the grid has realistic gaps.
- **`AvailabilitySlot`** — derived: `{ startMin, available: boolean }` (with an optional `reason` for disabled slots, surfaced as accessible labelling).
- **`BookingDraft`** (Zustand state, also a Zod schema for the persisted-shape guard and the submit projection) — `{ step, serviceId?, barberId?, date?, startMin?, contact?: { name, phone, email, notes? } }`.
- **`ContactDetails`** and **`Testimonial`** schemas as PLAN.md § "Mock data shape".
- **`ConfirmedBooking`** — the submit return: `{ reference, service, barber, date, startMin, durationMin, priceCents, currency, isDemo: true }`.

**Deterministic availability — the pure contract:**

- **Frozen `now`.** `src/lib/clock.ts` exports a single frozen reference time (a fixed ISO instant, e.g. a chosen weekday midday) used by the availability generator, the date-strip "next 14 days", the UI, and all tests. **No `Date.now()` / `new Date()` / `Math.random()` in render or in the generator** — same discipline as tape/meld. A documented escape hatch (env or a test-only override) may advance the clock for manual exploration, but the default is frozen.
- **`getAvailability({ barberId, serviceDurationMin, date }): AvailabilitySlot[]`** in `src/lib/availability.ts` — pure, deterministic, no React, Vitest-covered (Phase 6). Algorithm: take the barber's `workingHours` for that weekday (null → empty, day is closed); subtract `daysOff` (date in set → empty); generate candidate start times on a fixed grid (e.g. every 15 min) from `open` to `close − serviceDurationMin`; for each candidate, mark `available` only if the half-open interval `[startMin, startMin + serviceDurationMin)` overlaps **no** seeded `Booking` for that barber/date **and** does not intersect the `lunch` break **and** ends at or before `close`. **Combo duration consumes a longer contiguous block** purely by passing the larger `serviceDurationMin` — the same function, no special case. Candidates whose block would collide are emitted as `{ available: false }` (not omitted) so the grid renders disabled slots with accessible reasons rather than silently hiding them.

**Wizard state machine (Zustand + `persist`):**

- **Five steps:** `service → barber → date-time → details → confirmation`, modelled as a `step` discriminant plus the accumulated draft.
- **Step-guard rules:** cannot advance to `barber` without `serviceId`; cannot advance to `date-time` without `barberId`; cannot advance to `details` without `date` + `startMin`; cannot submit without a valid `contact`. Guards are pure selectors on the store, enforced by the step shell and unit-tested.
- **Barber filtering:** step `barber` shows only barbers whose `specialties` include the chosen `service.category`, plus an "Any available barber" option (resolves to the first barber with a free slot at selection time).
- **Deep-link seeding:** `/book?service=…&barber=…` pre-seeds `serviceId`/`barberId` (validated against the mock catalog; unknown params are ignored, not errored) and advances `step` past the satisfied stages.
- **`persist` configuration:** Zustand `persist` middleware, `storage: localStorage`, **key `razors-edge:booking-draft`**, **`version: 1`** with a `migrate` stub, and a **TTL of 24 h** stamped via a `savedAt` field — on rehydrate, if `now − savedAt > 24h` the draft is discarded and the wizard starts clean. `contact` PII is persisted only as the user typed it locally (no network, no real PII leaves the device — consistent with the "no real PII" cross-cutting note); a "Start over" control clears the persisted draft.
- **Refresh-reconciliation rule (the owner-flagged reconciliation question).** On rehydrate, if the draft holds a `date` + `startMin`, the wizard **re-runs `getAvailability` for the persisted `(barberId, serviceDurationMin, date)` and re-validates the held slot.** Because `now` is frozen and the mocks are seeded, availability is stable across reloads, so in the normal demo the slot is still free and the draft restores exactly. The reconciliation path exists for two real cases: (a) the seed/clock is advanced via the escape hatch, or (b) a future change makes mocks time-relative — in either, if the held slot is no longer `available`, the wizard **keeps `serviceId`/`barberId`/`date`, clears `startMin`, drops the user back on the `date-time` step, and shows a non-blocking notice ("Your held time is no longer available — please pick another"),** rather than silently confirming a stale slot or wiping the whole draft. This rule is unit-tested with a forced-stale fixture.

**TanStack Query over the mock source (no network):** mock data is fetched through TanStack Query against an **in-memory seeded source** (`src/mocks/*` + `getAvailability`) wrapped in async functions with a small deterministic artificial latency, **not `fetch`** — so loading/error/`isPending` ergonomics, query keys, and cache behaviour are idiomatic and real while the source is local. Query keys: `['services']`, `['barbers']`, `['availability', barberId, serviceId, date]`. This is stated explicitly so no one wires a real endpoint: there is no network in v1.

**Mocked submit surface:** a **Next.js server action** (`bookAppointment`) that re-validates the `BookingDraft` projection with the **shared Zod schema** (the same `src/lib/schemas` file the form steps use), waits a realistic beat, and returns a deterministic `ConfirmedBooking` with a generated `reference` (deterministic from the draft, e.g. a short hash, so screenshots are stable) and `isDemo: true`. Nothing persists server-side; a reload of the _confirmation_ starts a fresh booking (the persisted draft is cleared on successful confirm).

**Confirmation `.ics`:** **hand-rolled** — a minimal RFC-5545 VEVENT string built from the `ConfirmedBooking` (DTSTART/DTEND from `date` + `startMin` + `durationMin` against the frozen clock's timezone, SUMMARY = service + barber, LOCATION = studio address) emitted as a `text/calendar` `Blob` download, in `src/lib/ics.ts`. No `ics` dependency.

### Consequences

- **Positive.**
  - One uniform availability model handles single services and combos with zero branching — combos are "a `Service` with a bigger `durationMin`", so `getAvailability` stays a single pure tested function.
  - `localStorage` + versioned key + 24 h TTL + the explicit reconciliation rule means a real mobile client survives an accidental reload, _and_ the demo stays deterministic, _and_ a stale held slot degrades gracefully instead of confirming a lie — all three resolved, not hand-waved.
  - TanStack Query over a local seeded source gives idiomatic data-fetching ergonomics (the recruiter audience sees real query/loading patterns) with no network and full determinism for Playwright/Lighthouse.
  - The shared Zod schema is the single contract for the form steps and the server-action submit, honouring § 5 even without a separate backend.
  - Frozen `now` + seeded mocks make the date strip, the availability grid, and the generated booking reference reproducible across runs and screenshots.

- **Negative.**
  - Persisting `contact` fields (name/phone/email) to `localStorage`, even locally and never transmitted, is a minor privacy footprint; mitigated by the 24 h TTL, the explicit "Start over" clear, the clear-on-confirm, and the demo-honesty copy. The reviewer confirms nothing is transmitted.
  - The reconciliation path is mostly dormant under the frozen clock, so it must be exercised by a deliberate forced-stale unit-test fixture or it will rot untested. Carried as a Phase 6 test requirement.
  - A combo as "one long service row" cannot express "barber A does the cut, barber B does the beard" — a real-world combo nuance — but that is out of scope for v1 and the uniform model is the right simplification; noted for a v2 README line.
  - A hand-rolled `.ics` must get timezone/line-folding right for broad calendar-client compatibility; mitigated by keeping the event minimal and testing the output against the frozen clock.

- **Follow-up tasks.**
  - **Task 2.3 (frontend-engineer):** author the Zod schemas above, including `durationMin` on `Service`, the `lunch` field on `Barber`, the `BookingDraft` persisted-shape guard, and `ConfirmedBooking`.
  - **Task 2.4 (frontend-engineer):** seed the fixed service menu (with combo rows carrying long `durationMin`), the barber roster (with `specialties`, `workingHours`, `daysOff`, optional `lunch`), pre-bookings, testimonials, and `src/lib/clock.ts` frozen `now`.
  - **Task 2.5 (frontend-engineer):** implement the pure `getAvailability` per the algorithm above (combo = larger `serviceDurationMin`, contiguous-block check, disabled-slot emission with reasons).
  - **Task 4.5 (frontend-engineer):** Zustand `persist` with key `razors-edge:booking-draft`, `version: 1`, 24 h TTL via `savedAt`, the step guards, deep-link seeding, and the rehydrate reconciliation rule.
  - **Task 4.7 (frontend-engineer):** the `bookAppointment` server action (shared-schema re-validate, deterministic `reference`, `isDemo`), clear-draft-on-confirm, and `src/lib/ics.ts` hand-rolled `.ics`.
  - **Task 6.1 (test-engineer):** Vitest for `getAvailability` (closed days, days off, lunch holes, pre-booking gaps, combo long-block sizing, frozen-`now` determinism) and the wizard machine (guards, deep-link seeding, persist rehydrate + the forced-stale reconciliation, submit-payload projection).

### References

- **`docs/conventions.md` § 5** (shared Zod schemas in `src/lib/schemas/`), **§ 6** (`faker.seed` determinism), **§ 3** (server actions preferred for same-page mutations).
- **PLAN.md** — "Booking flow" and "Mock data shape" sections (the field shapes this ADR fixes).
- **ADR-001** — web-only thesis (no backend) and the deferral of these mechanics here.
- **tape / meld determinism discipline** — seeded mocks + frozen reference time for reproducible screenshots and E2E.

---

## ADR-004: Hero "blade-sweep" technical contract

**Status:** accepted
**Date:** 2026-06-03

### Context

The scroll-driven blade-sweep hero is the wow moment and the spine of the design (PLAN.md), and the hero portrait is the LCP surface — so the cinema must not cost the performance budget (Lighthouse ≥ 95, LCP < 2.5 s, CLS < 0.1). ADR-001 deferred the precise layer model, the no-Club-plugin wordmark-split technique, the LCP/CLS-safe approach, and the three-tier degradation contract to this ADR. It builds directly on ADR-002's integration contract (`useGSAP` + `matchMedia` + transform/opacity-only). This ADR pins it precisely enough for the frontend-engineer to build (Task 3.2 / 3.3) and the designer-critic to judge against Olivier Larose + Stripe (Task 5.1).

### Options considered

**Wordmark-split technique (no Club GSAP plugin — SplitText is out per PLAN.md / `AGENT_NOTES.md`):**

- **W1. Two pre-composed masked halves of the wordmark.** Render the full wordmark text twice in the real DOM (both copies present for SEO/SR/no-JS), each in a container clipped by `clip-path` to its half (upper above the diagonal cut line, lower below). GSAP translates the two clipped containers apart. Sharp at any resolution (real text, not an image), trivially responsive, no plugin. **Picked.**
- **W2. SVG `<text>` with two `clipPath` halves.** Similar, in SVG; gives precise diagonal masking but complicates responsive type sizing and variable-font rendering vs DOM text. Rejected — DOM text + CSS `clip-path` is simpler and keeps the variable-font weight hooks (PLAN.md type system) intact.
- **W3. Pre-rendered PNG/AVIF of the wordmark, split as images.** Sharpness/scaling and theming (light/dark) problems, and loses the real-text SEO/SR/no-JS floor. Rejected.

**Blade element:**

- **B1. Inline SVG razor** with a brushed-metal `linearGradient` and a bright specular edge stop; the amber edge-glow is a separate SVG/`filter` layer (or a CSS gradient sliver) translated to track the blade's leading point. Scales sharp, themeable, animatable via transforms. **Picked.**
- **B2. PNG razor.** Rejected on sharpness/scaling/theming, same as W3.

### Decision

**Layer model (back to front), all within one pinned hero client component under the low `'use client'` boundary (ADR-002):**

1. **Background field** — near-black/charcoal CSS gradient (themed token).
2. **Portrait layer** — the cinematic `next/image` portrait, AVIF, `priority`, with a blur placeholder; initially masked/occluded by the wordmark, revealed in the gap as the halves part; a slow Ken-Burns `scale` push during reveal. **This is the LCP element.**
3. **Wordmark upper half** and **wordmark lower half** — two real-DOM copies of "RAZOR'S EDGE", each `clip-path`-clipped to its side of the diagonal cut line (technique W1), in the chosen variable display face, with the brass baseline highlight.
4. **Blade layer** — inline SVG razor (B1) that sweeps diagonally across the wordmark.
5. **Brass edge-glow** — a thin amber sliver/`filter` glow translated to track the blade's leading point.
6. **Grain overlay** — a single tiled SVG/CSS noise layer spanning the whole hero (and reused site-wide), at a fixed low opacity, so type-over-photo composites read as one cinematic frame. `pointer-events: none`, `aria-hidden`.

**Scroll timeline (GSAP `ScrollTrigger`, pinned + scrubbed, authored inside `useGSAP` + `gsap.matchMedia` per ADR-002):**

- **Pin length:** ~**150–200 vh** of scroll mapped to the pinned timeline (the hero pins for roughly 1.5–2 viewport-heights of scroll, then releases into the positioning section). Final value tuned in Task 3.2 against feel; the contract is "pinned, single-screen, scrubbed, then clean hand-off — the scroll never stalls on a finished animation".
- **`scrub`:** numeric smoothing (`scrub: 1`-ish) so the blade tracks scroll with a slight ease rather than 1:1 jitter.
- **Phase choreography (transform/opacity only):**
  1. **Sweep (0 → ~0.45):** blade translates diagonally across the wordmark; brass edge-glow tracks its leading point; portrait and wordmark static.
  2. **Cut / split (~0.45 → ~0.5):** at the instant the blade edge crosses the type, the two clipped wordmark halves begin to part — the mid-timeline state change that PLAN.md/ADR-001 named as the reason GSAP beats Motion here.
  3. **Part + reveal (~0.5 → ~0.85):** upper/lower halves translate apart at **different rates (parallax)**; the portrait becomes visible in the widening gap and begins its Ken-Burns `scale` push; grain stays continuous across both layers.
  4. **Hand-off (~0.85 → 1):** the composed frame settles and the pin releases into the positioning statement so the cut _is_ the transition into the site.
- **Easing:** entrance/curve in the Stripe/Linear register referenced in `docs/inspirations.md` (e.g. `cubic-bezier(0.16, 1, 0.3, 1)`-family for the part, not a `linear` curve) — the designer-critic judges the exact timing against Olivier Larose + Stripe.

**Responsive / sharpness (320 px up):** the wordmark is real variable-font DOM text scaled with the type scale, so it is sharp at any width; the blade and edge-glow are SVG, sharp at any width; the diagonal `clip-path` cut line is defined relationally so the split reads correctly from 320 px to 1920 px. On small widths the pin length and parallax offsets reduce (a `matchMedia` desktop/mobile branch) so the effect stays legible and cheap on phones.

**Three-tier degradation contract (all via `gsap.matchMedia` + a no-JS floor):**

- **Tier 1 — full (JS on, motion OK):** the pinned, scrubbed timeline above.
- **Tier 2 — `(prefers-reduced-motion: reduce)`:** **no pin, no scrub, no parallax.** A short scroll-linked or simple **crossfade** from the composed wordmark state to the portrait-forward state; the brass highlight is **static** (no idle shimmer). Authored as the `reduced` branch of the hero's `matchMedia`. The content is identical; only the motion is removed.
- **Tier 3 — no-JS / failed hydration:** the hero renders server-side as a **static composed final frame** — wordmark (both real-DOM halves in their resting, legible position) over the portrait with the brass edge and grain — fully on-brand, legible, and SEO/SR-complete. Because the wordmark text and portrait `alt` are real DOM regardless of JS, screen readers and crawlers always get the content. GSAP only _enhances_ this floor; it never _creates_ the content. The blade/split is purely additive over a frame that already works.

**Asset strategy:** the portrait(s) are `next/image`, **AVIF**, `priority` (it is the LCP element), correctly `sizes`-d for the cinematic crop, with a **blur placeholder** to avoid a flash. v1 uses **seeded, royalty-clear placeholder photography** (documented provenance per `AGENT_NOTES.md`) — the README notes the swap-for-real path. **Art-direction slots to define:** (a) a desktop cinematic landscape/portrait crop (the gap reveal), (b) a mobile-tall crop (`<picture>`/`sizes` art direction so the 320 px reveal is composed, not a center-crop of the desktop frame), (c) optional gallery hero candidates. The frontend-engineer fills these with placeholders initially against the defined slots.

**Hero performance budget (it is the LCP surface):**

- **LCP < 2.5 s:** portrait is `priority` AVIF, sized to its rendered box, blur placeholder; no webfont blocks the portrait paint (the wordmark text may use `font-display: swap`); the hero's critical CSS reserves the pinned layout so first paint is the composed frame.
- **CLS < 0.1:** the pin reserves layout via transform-based pinning and a reserved footprint — no layout shift when ScrollTrigger pins (ADR-002's CLS-safe pin rule). The wordmark halves occupy their resting layout at first paint.
- **INP < 200 ms / 60 fps:** transform/opacity-only animation, rAF-driven scrub, transient narrow `will-change` on the moving layers only (blade, two halves, portrait), removed on completion. No long tasks during the scrub.
- Grain is a single lightweight tiled SVG/CSS noise layer, not WebGL, tuned to be invisible to the performance budget.

### Consequences

- **Positive.**
  - The wordmark-split is achieved with real-DOM text + CSS `clip-path` + GSAP transforms — **no Club GSAP plugin**, sharp at every width, and SEO/SR/no-JS-complete by construction (the floor is real content, the wow is additive).
  - The three tiers are defined precisely, so reduced-motion and no-JS are first-class spec, not afterthoughts, and the designer-critic and test-engineer have concrete behaviours to verify.
  - The LCP/CLS/INP budget is engineered into the layer model and the transform-only choreography up front, protecting Lighthouse ≥ 95 and CWV on the project's most demanding surface.

- **Negative.**
  - Pixel-precise alignment of the diagonal `clip-path` cut line across two DOM copies, at every breakpoint, with the blade's leading point, is fiddly and is the highest-risk piece of the build. Mitigation: relational `clip-path` geometry, a `matchMedia` breakpoint branch, and the designer-critic review gate.
  - Real-DOM duplicate wordmark copies must be kept visually identical (same variable-font settings) or the seam shows; mitigated by sharing one type token/component for both halves.
  - The pin-length and easing values are left to be tuned in Task 3.2 (not numerically frozen here), so the designer-critic's timing critique is load-bearing — intentional, since feel is judged against references, not asserted in an ADR.

- **Follow-up tasks.**
  - **Task 3.2 (frontend-engineer):** build the Tier-1 pinned scrub per the layer model and phase choreography; portrait `priority` AVIF as LCP; CLS-safe transform pin; tune pin length/easing against Olivier Larose + Stripe.
  - **Task 3.3 (frontend-engineer):** the Tier-2 reduced-motion crossfade (no pin/parallax, static highlight) and the Tier-3 no-JS static composed frame; verify both are on-brand and legible and that the wordmark/`alt` are real DOM in all tiers.
  - **Task 2.2 (frontend-engineer):** pick the variable display face (licensed for public web embedding — `AGENT_NOTES.md` open item) the two wordmark halves share.
  - **Task 2.4 / design phase (frontend-engineer):** source royalty-clear placeholder portraits for the defined art-direction slots (desktop crop, mobile-tall crop), documented provenance, README swap-for-real note.
  - **Task 5.1 (designer-critic):** judge the hero timing/choreography against Olivier Larose + Stripe, zero pochwał.
  - **Task 6.2 (test-engineer):** Playwright assertion of the reduced-motion hero path (no pin, crossfade) and the no-JS composed frame.

### References

- **PLAN.md** — the wow-moment spec (first paint, sweep, split, reveal, hand-off, the three-tier fallback).
- **ADR-002** — `useGSAP` + `gsap.matchMedia` integration, transform/opacity-only, CLS-safe pin, CSP.
- **`docs/inspirations.md`** — Olivier Larose (scroll-driven storytelling + photographic art direction), Stripe (long-form scroll with a custom element justifying its bundle; type as primary), Aristide Benoist (kinetic transitions for the wordmark), Klim (display type as specimen) — the references the timing and composition are judged against.
- **CLAUDE.md § 4, § 5** — Lighthouse ≥ 95 / CWV / reduced-motion / `next/image` AVIF; the wow-moment mandate.
- **`AGENT_NOTES.md`** — open items this ADR routes: the variable display face licensing (Task 2.2) and the mock-photography provenance (Task 2.4).

---

## ADR-005: Production deploy posture — Fly.io single-machine Next standalone, web-only, no secrets

**Status:** accepted
**Date:** 2026-06-03

### Context

v1 is feature-complete, reviewed, tested, and documented; the only
remaining work is the deploy itself. razors-edge is **web-only**
(ADR-001) — a single Next.js 15 App Router app with `output:
'standalone'`, server actions, a dynamic `opengraph-image`, `sitemap.ts`
/ `robots.ts`, and JSON-LD/metadata, over a fully mocked in-memory
booking flow (ADR-003). It has no backend service, no database, no
migrations, and no runtime secrets. This ADR ratifies the deploy posture
so the deploy artifacts (`Dockerfile`, `fly.toml`, `.dockerignore`,
`DEPLOY.md`) sit on a recorded footing consistent with the ADR-001..004
trail, and so it is clear the simplicity is a deliberate consequence of
the web-only thesis, not an omission.

### Options considered

- **A. Fly.io, single Machine, single Node process (the Next standalone
  server), region `fra`. Picked.** Mirrors the portfolio's existing Fly
  posture (tape, meld) for host consistency, but strips meld's
  three-stage / entrypoint-fan-out / migration complexity that a
  web-only app does not need. One process = one health check on `/`, the
  simplest logs, the smallest image.
- **B. Static export to a CDN/edge host (e.g. Cloudflare Pages,
  Vercel static).** Tempting for a "static-ish" marketing site, but
  **rejected**: the app genuinely needs the Node runtime — server
  actions (`app/book/actions.ts`), the dynamic `opengraph-image`
  (satori render), and `sitemap.ts` / `robots.ts` as runtime route
  handlers are not expressible as a pure static export without losing
  behaviour. `output: 'standalone'` is the honest runtime.
- **C. Vercel (the Next-native host).** Valid and zero-config, but the
  portfolio's deploy story is Fly across the board (tape/meld), and
  keeping razors-edge on Fly demonstrates the same Docker/standalone
  competence rather than offloading it to a managed Next host.
  **Rejected for portfolio consistency**, not capability.

### Decision

**Deploy to Fly.io as a single Machine in `fra` running one process —
the Next.js standalone Node server on internal port 3000, behind Fly's
443 TLS terminator.** Multi-stage Dockerfile (deps install → Next
standalone build → slim `node:22-bookworm-slim` runtime, non-root
`node` user), with **`NEXT_PUBLIC_SITE_URL=https://razors-edge-demo.fly.dev`
baked at BUILD time** (Next inlines `NEXT_PUBLIC_*` at build; the
canonical/OG/sitemap/robots/JSON-LD URLs depend on it — the meld lesson
that a wrong baked `NEXT_PUBLIC_*` silently ships). **No entrypoint
script, no migrations, no secrets** — `CMD` execs `server.js` directly.
The one-hop `outputFileTracingRoot` (web/next.config.ts) nests the
bundle as `web/.next/standalone/web/server.js`, so the runtime layout is
`/app/web/web/server.js` with `.next/static` + `public` as siblings
(verified by a local `docker build` + `docker run` smoke). HTTP health
check on `/` (a 200 is the liveness signal — there is no separate
`/health` route). `auto_stop_machines = 'stop'` + `min_machines_running
= 1` keep one Machine warm so the showcase loads without a cold start
before the blade-sweep wow moment. VM shared-cpu-1x / 256 MB (web-only
is light).

### Consequences

- **Positive.** Cheapest deploy in the portfolio (~$2-5/mo — no backend,
  no database). Single process = trivial ops (one health check, one log
  stream, no migration gate). Host-consistent with tape/meld (Fly +
  Docker standalone). The baked `NEXT_PUBLIC_SITE_URL` makes every
  absolute URL correct from the first request. No secret surface to
  defend (consistent with the "no PII, persists nothing" cross-cutting
  note).
- **Negative.** A single Machine has no redundancy — a crash drops the
  demo until Fly restarts it (acceptable for a portfolio demo; the
  warm-floor + auto-start covers the common case). The warm floor costs
  ~$2-3/mo at idle versus a true scale-to-zero; deliberate, to protect
  the five-second first impression. 256 MB is comfortable but not
  generous for the OG satori render under a burst — the documented
  bump-to-512 path covers it without an ADR.

### References

- **ADR-001** — web-only thesis (no backend, no secrets) this posture
  flows from.
- **meld `DECISIONS.md` ADR-006 + `Dockerfile` / `fly.toml` / `DEPLOY.md`**
  — the Fly single-Machine pattern + the `[http_service]` single-block
  shape + the one-hop standalone-path nesting lesson this deploy mirrors
  (minus the server/migration complexity meld needs and razors-edge does
  not).
- **`web/next.config.ts`** — `output: 'standalone'` +
  `outputFileTracingRoot` (the source of the `web/.next/standalone/web/
server.js` nesting) + the CSP/security-header set served at runtime.
- **CLAUDE.md § 4** — performance / security baseline (the warm floor
  serves the Lighthouse-grade first paint; no secret surface).

---
