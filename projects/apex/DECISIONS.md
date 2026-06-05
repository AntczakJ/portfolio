# apex — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour, animation/3D library posture, design-token posture, reservation-mock architecture, and the portfolio-composition flag

**Status:** accepted
**Date:** 2026-06-04

### Context

`apex` is a premium-modern / EV-flavoured marketing website for a car **rental** company (brand display: **APEX**; not a sales dealership), with two centerpieces: an interactive **3D car configurator** (the wow) and a fully mocked but delightful multi-step **rental reservation** flow (the centerpiece interaction). It is built on the **razors-edge structural foundation** — same web-only Next 15 posture, same per-project file discipline, same sovereign-token + frozen-clock + shared-Zod-schema + four-tier-degradation patterns — and deviates from razors-edge on exactly one load-bearing axis: it adds **React Three Fiber + drei** for a genuine WebGL 3D scene. The brief is owner-confirmed on the load-bearing decisions, and ADR-001 ratifies five of them so downstream agents work against a fixed footing:

1. **(a)** web-only vs api-heavy per `docs/conventions.md` § 10 — owner explicitly chose **web-only with a mocked reservation flow**;
2. **(b)** the animation/3D library posture per § 15 — a genuine 3D centrepiece points at **R3F + drei**, plus **GSAP + ScrollTrigger** for scroll choreography (a deliberate two-library posture; **Motion is explicitly excluded by default**);
3. **(c)** the design-token posture — sovereign per § 14 (no reuse from `tape`, `meld`, `razors-edge`, or `pulse`), with a **light canonical default theme** (the deliberate contrast with razors-edge's dark-canonical identity);
4. **(d)** the reservation-mock architecture — client-side wizard state + seeded deterministic availability + a pure price function, no backend, inheriting razors-edge's ADR-003 shape;
5. **(e)** the **portfolio-composition flag** — apex is the second consecutive web-only project and this ADR records that this is the owner's deliberate, § 12-compliant call.

Portfolio-composition context that frames (a) and (e): per root `PROGRESS.md`, the portfolio currently stands at four projects — `tape` (Elysia/Bun, api-heavy), `meld` (Hono/Node, api-heavy), `razors-edge` (web-only creative), `pulse` (NestJS, api-heavy). That is **3 api-heavy across three distinct backends + 1 web-only**, which already **satisfies § 12 with margin** (the 2–3 api-heavy minimum and the ≥2-backends — here three — variance requirement are both met). apex takes **slot 5** as a _second_ web-only creative showcase. razors-edge's PLAN raised a standing flag: "If the brief after this one is also web-only, the planner must flag it and recommend an api-heavy / NestJS brief to keep the five-project constraint reachable." This ADR discharges that flag: the NestJS slot razors-edge worried about was _subsequently filled by `pulse`_, so the constraint is no longer at risk; apex being web-only does **not** breach § 12 even at the five-project mark. The flag is recorded as discharged, with a forward-looking note (below) rather than a block.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (Next.js static-first + a server action for the mocked submit).** None of the five § 10 api-heavy triggers fires: no WebSocket/SSE, no background jobs/queue/cron, no non-Next API consumer, no heavy auth flow, and the only "domain logic" (deterministic date-range availability + a pure price quote + wizard/configurator state transitions) is small, pure, and tests perfectly in isolation in `src/lib/` with Vitest. **Crucially, the 3D configurator does not change this:** WebGL is a _client_ concern; every § 10 trigger is a _server_ concern. A genuine-3D project is a frontend-complexity signal (it changes the animation stack — ADR-002), not a backend signal. **Picked (and owner-confirmed).**
- **B. api-heavy with a real rental backend (e.g. Fastify or NestJS + Drizzle + Postgres, real fleet/availability/pricing + persistence).** Technically buildable and would advance the one unused § 11 backend (Fastify), but it is ceremony this brief does not need — the showcase value here is the 3D configurator + art direction + scroll choreography + a believable client-side flow, not a CRUD rental service. Forcing a backend would violate CLAUDE.md § 3 ("deviate only when the project genuinely requires it") in reverse. Reserved as the explicit v2 path (README notes "wire a real rental API"). **Rejected for v1 on need grounds, not capability grounds.**

**Animation / 3D library posture (per § 15):**

- **A1. R3F + drei (primary, the configurator) + GSAP + ScrollTrigger (scroll choreography).** The configurator is genuine WebGL/3D (orbit + live material/mesh swaps + studio lighting) — exactly the § 15 case for R3F ("only when the project actually uses WebGL / 3D", "not for fancy 2D backgrounds"). The scroll-hero, the hand-off into the configurator, and the gallery scroll-reveal are pinned/scrubbed/timeline scroll work — exactly the § 15 case for GSAP. Two libraries, each owning a clearly distinct surface (R3F = inside the canvas; GSAP = scroll/pin/timeline/SVG/DOM-state outside it). **Picked.**
- **A2. R3F + GSAP + Motion (three libraries).** razors-edge admitted Motion as a _scoped secondary_ for its wizard step transitions. apex's two libraries are already R3F + GSAP, so adding Motion would be a **third** — forbidden by CLAUDE.md § 5 ("do not stack three"). The wizard step transitions here default to **GSAP timelines and/or CSS `data-state` transitions** instead. **Rejected as default;** Motion is admissible only by a later, explicit, bounded ADR if CSS + GSAP genuinely cannot express a needed transition (the escape hatch, default = not included).
- **A3. R3F only (collapse scroll work into R3F / scroll-rig).** Possible (drei `ScrollControls`), but the marketing page is mostly DOM (hero type, fleet, gallery, locations, footer) with one WebGL section; driving DOM scroll choreography through an R3F scroll-rig would be the wrong tool for the 90% that is not 3D, and would entangle the whole page in the WebGL lifecycle. GSAP is the right tool for DOM scroll. **Rejected.**

**Design-token posture + canonical theme:**

- **D1. Sovereign tokens, built from scratch, light canonical default.** Required by § 14 (tokens never leave the project that owns them). The premium-modern/EV identity is unique to apex and must not borrow tape's slate/cyan, meld's warm-paper/OKLCH, razors-edge's brass-on-near-black, or pulse's palette. **Light canonical** is the deliberate counterpoint to razors-edge's dark-canonical identity (strengthening the portfolio's range signal) and is the natural EV-product register (bright studio light). Dark ships as an intentional "night drive / charging-bay" register, not an inversion. **Picked (mandated tokens; light-default recommended, architect may revisit in an ADR).**
- **D2. Reuse/extend another project's tokens, or default dark like razors-edge.** Reuse is forbidden by § 14. Defaulting dark would weaken the contrast-with-razors-edge range signal and fights the EV-light idiom. **Rejected.**

**Reservation-mock architecture:**

- **M1. Client-side wizard (Zustand) + seeded deterministic availability + a pure price function + mocked submit, inheriting razors-edge ADR-003.** Wizard machine in Zustand (persisted to `localStorage`, versioned key + TTL + a date-range reconciliation rule on rehydrate); per-step forms in react-hook-form + Zod; mock data via TanStack Query over a local seeded source (artificial latency); availability via a pure `getRangeAvailability` over seeded blackouts/bookings against a frozen `now`; price via a pure `priceQuote`; submit validated by the shared Zod schema in a server action returning a deterministic confirmation + a client-side `.ics` over the rental range. Feels real, persists nothing, reproducible. **Picked.**
- **M2. A real or `localStorage`-"persisted" booking ledger.** Out of scope — pulls toward a backend the web-only thesis rejects and complicates determinism. **Rejected for v1.**

### Decision

**Stack flavour: web-only.** **3D/animation posture: React Three Fiber + drei (primary, the configurator) + GSAP + ScrollTrigger (scroll choreography) — a deliberate, bounded two-library posture; Motion is explicitly NOT included by default** (the wizard transitions use GSAP/CSS; Motion is admissible only by a later bounded ADR). **Design-token posture: sovereign — no reuse from `tape`, `meld`, `razors-edge`, or `pulse` (§ 14) — with light as the canonical default theme and an intentional dark "night drive" register.** **Reservation architecture: fully client-side mocked — Zustand wizard + configurator machine, react-hook-form/Zod steps, TanStack Query over a seeded local source, a pure deterministic `getRangeAvailability` and a pure `priceQuote` over a frozen `now`, and a mocked server-action submit returning a deterministic confirmation + a client-side `.ics`.**

The five picks converge on one thesis: this slot's portfolio value is **range plus a genuine 3D capability** — proof the author can ship a real, performant WebGL configurator inside a complete, art-directed marketing site and a multi-step interactive flow, at production quality, in a _light, technological_ register that is the deliberate opposite of razors-edge's dark-luxe — and all of it without leaning on a backend to look impressive. Web-only is the honest flavour; R3F is the honest tool for a real configurator; GSAP is the honest tool for DOM scroll choreography; sovereign light-canonical tokens are mandatory and range-bearing; and a believable client-side reservation flow demonstrates product polish without inventing a service that does not earn its keep.

**The single new risk this project introduces over razors-edge is WebGL inside a Lighthouse-≥-95-on-mobile budget.** That is why ADR-002 must pin the performance strategy as a contract (static-render LCP, `next/dynamic ssr:false` + Suspense + code-split, draco/meshopt-compressed budgeted model, capped `dpr` + `frameloop="demand"` + adaptive quality, and a device-tier/no-WebGL gate that routes mid-tier mobile to a **pre-baked-render fallback**), and why ADR-004 must pin the hero→configurator hand-off seam and the four-tier degradation precisely. razors-edge's GSAP/Next integration (`useGSAP()` + `gsap.matchMedia()` + transform/opacity-only + strict-CSP-clean) is **inherited wholesale** and is not re-litigated.

**Three integration mechanisms are deliberately deferred** to the architect at implement kickoff, where they benefit from a brief prototype spike rather than premature lock-in: the R3F/Next integration + the WebGL performance strategy + the GSAP↔R3F boundary + the no-Motion ratification (ADR-002); the reservation-mock state/persistence/availability/price/submit details (ADR-003); and the hero→configurator hand-off + the pre-baked-render matrix + the four-tier degradation contract (ADR-004). A deploy-posture ADR (mirroring razors-edge ADR-005) lands at Phase 8.

### Portfolio-composition flag (planner enforcement, `docs/conventions.md` § 12)

**apex is the second consecutive web-only project (razors-edge slot 3, apex slot 5).** This is recorded explicitly so the next planning pass does not mistake it for drift:

- **§ 12 is satisfied with margin and apex does not breach it.** With apex, the portfolio is **5 projects: 3 api-heavy (`tape` Elysia/Bun, `meld` Hono/Node, `pulse` NestJS) across three distinct backends, + 2 web-only (`razors-edge`, `apex`)**. The 2–3 api-heavy minimum and the ≥2-backends (here three) variance requirement are both met. The constraint is evaluated at the five-project mark and it passes.
- **The razors-edge standing flag is discharged.** razors-edge worried that a following web-only brief could keep the NestJS/api-heavy slot from being filled; `pulse` subsequently filled exactly that NestJS slot, so the worry no longer applies. apex being web-only is safe.
- **Forward-looking note (not a block):** the api-heavy/backend-variance target is met, so any _sixth_ project is unconstrained on this axis. If the portfolio grows and the owner wants to keep the backend-variance story fresh, **Fastify is the one § 11 backend not yet used** — a future api-heavy brief is the natural place to add it. This is a recommendation for later, not a requirement for apex, and it is the owner's deliberate call that slot 5 is web-only.

### Consequences

- **Positive.**
  - The portfolio gains a **genuine 3D capability signal** — a real, performant WebGL configurator inside a marketing site — that none of the other four projects demonstrate, alongside a _second_ axis of range: a light, technological premium-modern register that is the deliberate opposite of razors-edge's dark-luxe.
  - R3F is the right tool for the configurator and GSAP for the DOM scroll; the two-library posture is honestly inside § 5 (two, not three) and the surfaces are cleanly separable (inside-canvas vs scroll/DOM), making the boundary mechanically enforceable.
  - Sovereign light-canonical tokens force a fresh, ownable identity and strengthen the range story.
  - The mocked reservation flow inherits razors-edge's proven deterministic discipline (seeded faker + frozen `now`), so screenshots, Playwright runs, the date-range availability, and the price quote are reproducible — and nothing real is persisted, so there is no PII or security surface beyond input sanitization and CSP.
  - No backend means a trivial deploy (static-first Next on Fly, mirroring razors-edge ADR-005) and a generous budget — _but_ see the negative on WebGL.

- **Negative.**
  - **WebGL is the real risk to the Lighthouse-≥-95-on-mobile budget.** A live three.js scene can wreck Performance and INP on mid-tier mobile. Mitigation: ADR-002 makes the performance strategy a contract (static-render LCP, code-split/lazy canvas, compressed budgeted model, capped `dpr` + on-demand render loop + adaptive quality, and a **pre-baked-render fallback** that means the heavy scene simply does not load on mid-mobile) and the mobile Lighthouse run measures the fallback path. This is the single most-watched item of the build.
  - **The hero→configurator hand-off is the highest-risk integration** (a GSAP-driven scroll seam revealing a lazily-loaded WebGL canvas without a flash or CLS, and with the LCP never being the canvas). Mitigation: ADR-004 fixes the seam, the reveal-when-ready rule, and the reserved-layout/CLS approach up front; the success criteria gate it.
  - **Two animation/3D libraries** is a deliberate (allowed) posture, but discipline-dependent. Mitigation: the clean inside-canvas/outside-canvas boundary, the reviewer audit, and the explicit no-Motion-by-default rule keep it from sliding into three.
  - **3D-model IP/licensing** must be royalty-clear (no badged manufacturer car). Mitigation: documented provenance + license in `AGENT_NOTES.md`/README (mirroring razors-edge's photography `CREDITS.md`) and a stated swap-for-real path.
  - **A mocked reservation flow can read as "fake"** if the confirmation pretends to be real. Mitigation: gracefully honest copy ("demo reservation — no car was actually booked") and a README that states the mock boundary + the v2 real-backend path.
  - **Second consecutive web-only** could _look_ like drift in a glance at the tracker. Mitigation: the composition flag above records that § 12 passes with margin (pulse filled the NestJS slot), so this is compliant and deliberate, not drift.

- **Follow-up tasks.**
  - **ADR-002 (architect, implement-phase day 1):** ratify the R3F + GSAP two-library posture + the no-Motion-by-default rule (+ the admit-by-ADR escape hatch); pin the R3F-with-Next-15-App-Router integration (`next/dynamic ssr:false` Canvas, Suspense + drei `<Loader>`, low `'use client'` boundary, `frameloop="demand"`, capped `dpr`, `AdaptiveDpr`/`PerformanceMonitor`, the device-tier/no-WebGL capability gate); pin the GSAP↔R3F boundary + the WebGL performance strategy; confirm the strict-CSP posture (no `unsafe-eval`; verify three.js + drei + GSAP run under it); inherit razors-edge's `useGSAP()` + `gsap.matchMedia()` pattern.
  - **ADR-003 (architect):** reservation-mock architecture — the Zustand wizard + configurator store shape + `localStorage` persistence (versioned key + TTL + the **date-range reconciliation rule** on rehydrate); the pure `getRangeAvailability` + `priceQuote` contracts over a frozen `now`; the insurance-tier modelling; the TanStack Query mock-fetch layer; the server-action submit + shared Zod schema + the `.ics` over the rental range.
  - **ADR-004 (architect):** the hero→configurator hand-off seam + the four-tier degradation contract + the pre-baked render matrix (colour × wheel) generation/wiring + the configurator's accessible DOM-control model + the screen-reader text alternative.
  - **ADR-005-equivalent (architect, Phase 8):** deploy posture mirroring razors-edge ADR-005 (Fly single-Machine Next standalone, web-only, no secrets, `NEXT_PUBLIC_SITE_URL` baked at build, warm floor).
  - **Engineering kickoff (gated on ADR-002 + ADR-003 acceptance):** `frontend-engineer` starts the Phase 1 scaffold (Task 1.1) and proceeds through the phased task list.

### References

- **`docs/conventions.md` § 10–16.** Web-only vs api-heavy (§ 10), backend choice (§ 11 — Fastify is the unused one), portfolio composition (§ 12), the do-not-share black list incl. design tokens (§ 14), the animation-library policy (§ 15 — one library default; R3F only for genuine 3D; the documented exception for a second), and the workflow (§ 16).
- **CLAUDE.md § 3, § 4, § 5.** Stack hard-defaults + "deviate only when genuinely required"; the quality bar (theming, a11y, performance ≥ 95, SEO, security); the wow-moment mandate + "do not stack three libraries".
- **`docs/inspirations.md`.** Bruno Simon + Stripe/Vercel ship pages (the production-WebGL configurator bar), Olivier Larose (scroll-driven storytelling + photographic art direction — hero + gallery), Stripe (long-form scroll with a custom element justifying its bundle; type as primary), Linear + Vercel (premium-modern restraint with energy — the chrome/type register), Klim (display type as specimen).
- **razors-edge `DECISIONS.md` ADR-001..ADR-005 + `PLAN.md` + scaffold.** The structural foundation apex inherits: the web-only thesis, the GSAP/Next integration (`useGSAP` + `matchMedia` + transform/opacity-only + strict CSP, no `unsafe-eval`), the booking-mock determinism (seeded faker + frozen `now` + shared Zod schema + `localStorage` persistence + reconciliation), the four-tier degradation discipline, and the Fly single-Machine standalone deploy posture. apex's one deviation (R3F) is recorded in ADR-002.
- **tape / meld / pulse `DECISIONS.md` ADR-001.** The three api-heavy slots (Elysia/Bun, Hono/Node, NestJS) whose backend variance lets slots 3 and 5 be web-only without breaching § 12.
- **razors-edge CSP lesson** (strict CSP forbids `unsafe-eval`; faker + zod's JIT had to be neutralised). apex must verify three.js + drei + GSAP run under strict CSP — carried as the ADR-002 / Task 1.4 compatibility check.

---

## ADR-002: Animation/3D posture, R3F-with-Next-15 integration, the WebGL performance contract, the GSAP↔R3F boundary, and the strict-CSP posture

**Status:** accepted
**Date:** 2026-06-04

### Context

ADR-001 selected the **R3F + drei (configurator) + GSAP + ScrollTrigger (scroll choreography)** two-library posture, declared **Motion excluded by default**, and deferred the integration mechanics to a prototype-informed decision. This ADR (Task 0.1) pins them so the Phase 1 scaffold (Tasks 1.3 GSAP smoke, 1.4 R3F smoke Canvas — both gated on this ADR) builds against a fixed contract rather than improvising per-component. apex adds exactly one load-bearing axis over razors-edge — a genuine WebGL scene — and the single new risk it introduces is **WebGL inside a Lighthouse-≥-95-on-mid-tier-mobile budget**. razors-edge's GSAP/Next integration (`useGSAP()` + `gsap.matchMedia()` + transform/opacity-only + the lazy `loadGsap()` code-split + the verified CSP) is **inherited wholesale and not re-litigated** (razors-edge ADR-002); this ADR concentrates on the R3F surface, the boundary where GSAP scroll touches the canvas, and the performance/fallback contract. The `AGENT_NOTES.md` "Decisions to revisit" flags three items routed here: the GSAP↔R3F coupling at the seam (the seam mechanism itself is pinned in ADR-004), the WebGL performance heuristic, and whether to admit Motion.

Four forces converge and must be fixed before scaffold:

1. **Library boundary + the no-Motion ratification.** CLAUDE.md § 5 forbids stacking three. We run two (R3F + GSAP). The boundary must be hard and non-overlapping, and the no-Motion-by-default rule must be ratified with a single bounded escape hatch.
2. **R3F-with-Next-15-App-Router integration.** three.js is a heavy, browser-only, WebGL-context-owning runtime. Next renders Server Components by default and double-invokes effects in dev StrictMode. The Canvas must be SSR-excluded, code-split out of the initial bundle, Suspense-wrapped, mounted into a layout-reserved box, and torn down cleanly on unmount/route-change — once, as a contract.
3. **The Lighthouse-≥-95-on-mobile performance budget.** A live three.js scene is the single biggest threat to Performance and INP on mid-tier mobile. The strategy must be a contract (static-render LCP, lazy/split canvas, compressed budgeted model, capped `dpr`, on-demand render loop, adaptive quality, and a capability gate routing mid-tier mobile to the pre-baked fallback), with a concrete capability heuristic.
4. **CSP.** razors-edge shipped `script-src 'self' 'unsafe-inline'` (no `'unsafe-eval'`) and neutralised faker's `new Function` + zod's JIT. apex must confirm three.js + drei + GSAP add no `eval` path and pin the WebGL-specific CSP additions (`blob:`/`data:` for the GLB, textures, decoder workers).

### Options considered

**Library boundary:**

- **A. R3F + GSAP, hard inside-canvas/outside-canvas boundary (the two-library posture). Picked.** R3F owns 100% of what is inside the WebGL `<Canvas>` (scene graph, camera, materials, meshes, orbit/presentation controls, lighting/environment, contact shadows, the per-frame loop). GSAP owns 100% of scroll/pin/scrub/timeline/SVG/DOM-state outside the canvas (the scroll-hero, the gallery scroll-reveal, the track-line dividers, the section reveals, and the DOM-side wizard step transitions). The two surfaces are physically separable (a DOM region vs a GPU canvas), so the boundary is mechanically enforceable by the reviewer.
- **B. R3F + GSAP + Motion (three libraries).** Forbidden by CLAUDE.md § 5; razors-edge's Motion-for-wizard-steps precedent does not transfer because apex's two slots are already spent on R3F + GSAP. Rejected as default; admissible only via the bounded escape hatch below.
- **C. R3F-only with drei `ScrollControls` driving the whole page.** Possible but wrong-tooled: the marketing page is ~90% DOM (hero type, fleet, gallery, locations, footer) with one WebGL section. Routing DOM scroll choreography through an R3F scroll-rig entangles the entire page in the WebGL lifecycle and forfeits the no-JS/SEO floor for the non-3D sections. Rejected (re-confirms ADR-001 A3).

**R3F integration with Next 15:**

- **P1. `next/dynamic(..., { ssr: false })` Canvas in a Suspense boundary, code-split, lazy-mounted on approach. Picked.** The Canvas (three.js + drei + the GLB) is never server-rendered (no WebGL on the server), is in its own chunk out of the initial bundle, shows a drei `<Loader>` / `useProgress` affordance while loading, and mounts only when the configurator section is approached. This mirrors razors-edge's `loadGsap()` lazy-import philosophy applied to the heavier WebGL runtime.
- **P2. Statically imported Canvas with a `typeof window` guard.** Pulls three.js into the initial bundle (kills the hero's first-load JS budget) and is brittle against SSR. Rejected.

**WebGL capability / tiering heuristic (the most-watched decision; `AGENT_NOTES.md` flag):**

- **H1. A layered capability gate — static signals first, runtime monitor second. Picked.** A small synchronous probe decides Tier-1-eligibility before the Canvas ever mounts; a runtime `PerformanceMonitor` downgrades quality (and, at the floor, falls back) if the live scene underperforms. Concrete signals below.
- **H2. UA-string / device-model sniffing.** Brittle, unmaintainable, privacy-poor. Rejected.
- **H3. Always mount the live scene, rely only on adaptive `dpr`.** Fails the budget on the weakest devices and on no-WebGL contexts (no canvas at all). Rejected — adaptive `dpr` is a Tier-1 refinement, not a substitute for the gate.

### Decision

**1. Ratify the two-library posture (Option A) with a hard, written boundary. Motion is NOT admitted by default.** The boundary, verbatim, is the rule the frontend-engineer and reviewer enforce mechanically:

> **R3F + drei own everything inside the WebGL `<Canvas>`** — the scene graph, camera, lighting, `Environment`, `ContactShadows`, the car model's materials (paint) and meshes (wheels), the orbit/presentation controls, and the per-frame render loop. No GSAP tween runs inside the canvas; no three.js object is animated by GSAP.
> **GSAP + ScrollTrigger own everything outside the canvas that is scroll-, pin-, scrub-, timeline-, or SVG-driven, and all DOM-side state transitions** — the scroll-hero, the hero→configurator reveal, the gallery scroll-reveal, the track-line dividers, section reveals, and the wizard step enter/exit. No GSAP `ScrollTrigger` mutates the canvas's internal scene; GSAP may animate the canvas _wrapper element_ (opacity/transform of the DOM `<div>`) at the seam — that is DOM, not scene, animation.
> **The one sanctioned coupling point is the hero→configurator seam**, where a GSAP-driven scroll-progress value is _read_ by the R3F scene to drive camera/intro state. The coupling is one-directional and value-passing only (GSAP writes a number; R3F reads it inside its own loop) — the two libraries never both write the same property. The exact seam mechanism is pinned in **ADR-004**.
> **Motion is banned by default.** Wizard step transitions use **GSAP timelines and/or CSS `data-state`/`data-step` transitions** (driven by Radix/shadcn `data-state` where applicable). Hover/active micro-interactions and theme crossfade default to **CSS**.

**Escape hatch (burden of proof on adding Motion):** if, during the wizard build (Task 5.4), a needed React-state component transition (e.g. exit-before-unmount of a step panel) proves genuinely unexpressible cleanly in CSS + GSAP, the frontend-engineer **raises it in `AGENT_NOTES.md` and stops** — Motion is admitted only by an explicit follow-up ADR that bounds it exactly as razors-edge ADR-002 bounded it (Motion owns _only_ React-state component transitions; zero scroll work; `useScroll`/`useTransform` banned). The default ships without Motion. Unlike razors-edge (which started with Motion admitted and could collapse to GSAP-only), apex starts **without** Motion and may only add it by ADR — the stricter direction, because apex's two slots are already full.

**2. R3F-with-Next-15 integration contract (Option P1), pinned:**

- **The `<Canvas>` and everything it imports (three.js, drei, the GLB loader) are `next/dynamic`-imported with `ssr: false`.** A single client module (e.g. `src/lib/r3f/configurator-canvas.tsx`, mirror of razors-edge's `loadGsap` philosophy) is the only place three.js is imported; it is never imported into a Server Component. The dynamic import gives the code-split chunk that Task 1.4 must verify is out of the initial bundle.
- **Suspense + drei `<Loader>` / `useProgress`.** The dynamic Canvas mounts inside a Suspense boundary with a drei progress affordance; `useGLTF`/`useTexture` suspend until assets resolve. The fallback occupies the reserved box so there is no CLS at mount.
- **`'use client'` boundary kept low** (`docs/conventions.md` § 3). The configurator _section_ is a server component that renders the static render, the accessible DOM swatch controls, and the screen-reader text alternative as real server-rendered DOM (the no-JS/SEO floor — Tier 4, ADR-004); only the Canvas leaf is the client island. The swatch controls drive Zustand state (ADR-003), and the live scene reads that state — controls are real DOM, never canvas-only (a11y, ADR-004).
- **Render loop is on-demand: `frameloop="demand"`.** The scene renders on interaction (orbit, swatch change, the seam intro) and explicit `invalidate()` calls — not continuously — so an idle configurator costs zero GPU/main-thread and battery (a mobile-customer concern). The seam intro and any damped orbit inertia call `invalidate()` per frame while active, then stop. Auto-orbit (Tier-1 idle flourish, if any) is the only continuous driver and is disabled under reduced-motion (ADR-004).
- **Capped `dpr` + adaptive quality.** `Canvas dpr={[1, 2]}` clamped (and lower — `[1, 1.5]` — on the mobile/`matchMedia` branch), plus drei `<AdaptiveDpr pixelated={false} />`, `<AdaptiveEvents />`, and `<PerformanceMonitor>` to step `dpr`/quality down under sustained load and, at the floor, trigger the fallback (below).
- **Cleanup.** R3F disposes its renderer/scene on Canvas unmount; the dynamic wrapper unmounts the Canvas when the configurator section leaves the tree (route change to `/reserve`), releasing the WebGL context. The reviewer audits that no detached WebGL context leaks across route changes.
- **GSAP integration is inherited wholesale from razors-edge ADR-002** — `useGSAP()` from `@gsap/react`, the lazy `loadGsap()` code-split module, `gsap.matchMedia()` for reduced-motion/responsive branching, transform/opacity-only, transient narrow `will-change`, CLS-safe pinning, rAF-driven scrub. apex does **not** re-derive these; it copies the _pattern_ (not the files — apex builds its own `src/lib/gsap/*`).

**3. The WebGL performance contract (binds Phase 4; the Lighthouse-≥-95-on-mobile claim rests on it):**

- **The hero LCP is never the canvas.** The hero's LCP element is the static `next/image` AVIF product render — `priority`, sized to its box, blur placeholder. The Canvas hydrates and the model loads _after_ first paint and _after_ LCP, behind the static render; the seam (ADR-004) reveals the live canvas only once it is ready. The Canvas mounts into a layout-reserved box (CLS < 0.1).
- **Code-split + lazy.** three.js + drei + the GLB are out of the initial bundle (P1) and load on approach (intersection/scroll-proximity), not on page load. Task 1.4 verifies the split with a bundle inspection.
- **Compressed, budgeted model.** The GLB is **draco- or meshopt-compressed**; the decoder is loaded from a self-hosted path (CSP, below). Budget (fixed here as the contract, tuned within in Phase 4): **≤ ~150k triangles** for the hero car, **textures ≤ 2K, KTX2/basis-compressed where it helps**, total **GLB ≤ ~3–4 MB** transferred. Environment lighting uses a **small baked HDRI or a drei lightweight preset**, not a heavy EXR. Provenance/license documented in `CREDITS.md` + README (royalty-clear, no badged manufacturer car — `AGENT_NOTES.md` Phase-4 item).
- **On-demand + adaptive** as in the integration contract (`frameloop="demand"`, capped `dpr`, `AdaptiveDpr`/`AdaptiveEvents`/`PerformanceMonitor`).
- **The capability gate routes mid-tier mobile and no-WebGL to the Tier-3 pre-baked fallback** (next item), so the heavy scene **does not load** on those clients — that is how the mobile Lighthouse run hits ≥ 95 honestly. The mobile Lighthouse profile measures the fallback path.

**4. The capability / tiering heuristic (Option H1), concrete:**

A small synchronous client probe runs before the Canvas is allowed to mount and returns a tier. Tier-1 (live scene) requires **all** of:

- **A successful WebGL2 context probe** — create a throwaway `canvas.getContext('webgl2')`; if null (blocked/unavailable) → Tier 3. (`webgl` is not sufficient; the scene targets WebGL2.)
- **`navigator.hardwareConcurrency >= 4`** (cores) **and** — where the signal exists — **`navigator.deviceMemory >= 4`** (GB). `deviceMemory` is absent on some browsers (notably Safari/Firefox); when absent it is **not** treated as a failure (do not penalise the missing signal) — the decision then leans on the WebGL2 probe + cores + the coarse-pointer/viewport check.
- **Not a constrained mobile profile** — a coarse heuristic combining `matchMedia('(pointer: coarse)')` **and** a small-viewport check: a coarse-pointer device below a width threshold (the `matchMedia` mobile branch, e.g. `< 768px`) defaults to Tier 3 _even if the GPU probe passes_, because the brief's explicit position is "a 3D scene that melts a mid-tier phone is a worse first impression than a crisp static render" (PLAN.md audience 2). Tablets (coarse pointer, large viewport) that pass the GPU/memory probe are Tier-1-eligible.
- **`prefers-reduced-data` is honoured** — if `matchMedia('(prefers-reduced-data: reduce)')` matches → Tier 3 (do not pull a multi-MB GLB on a data-saver client).

`prefers-reduced-motion` does **not** force Tier 3 by itself: ADR-004 keeps the configurator interactive on direct user input under reduced-motion (drag-to-orbit, tap-a-swatch are user-initiated, not auto-motion) and only disables auto-orbit + converts the seam to a crossfade. The reduced-motion-to-Tier-3 question is finally resolved in ADR-004; this ADR's gate treats reduced-motion as orthogonal to the device-capability tier.

After mount, the **runtime `PerformanceMonitor`** downgrades `dpr`/quality on sustained low fps and, if it cannot recover above a floor, swaps the live scene for the Tier-3 pre-baked stills (a runtime demotion, not just a load-time gate) — so a device that _passed_ the static probe but still chokes degrades gracefully rather than staying janky. The exact fps thresholds are tuned in Phase 4 against the deployed mobile profile and recorded in `AGENT_NOTES.md`.

The probe lives in `src/lib/r3f/` as a pure-ish client function (`detectWebglTier()`), unit-testable by mocking the `navigator`/`matchMedia`/context signals.

**5. CSP posture (carry razors-edge's verified reality forward, plus the WebGL additions):**

razors-edge landed at `script-src 'self' 'unsafe-inline'` (Next's hydration bootstrap + the `next-themes` flash-guard are unhashed inline scripts; the strict `'self'`-only form requires per-request nonce middleware — deferred there as v1.1 debt). apex **inherits that exact posture** — the load-bearing guarantee is **no `'unsafe-eval'`**, not the absence of `'unsafe-inline'` for scripts. Verified facts to confirm in Task 1.4 under `next build && next start` (NOT `next dev`):

- **three.js + drei + R3F do not use `eval`/`new Function`** in normal operation (shader compilation is GPU-side, not JS `eval`). The Task 1.4 smoke Canvas must run with **zero CSP violations** with the live scene hydrated. If a transitive dependency pulls an `eval` path, neutralise it the razors-edge way (bake/strip) rather than relaxing the `'unsafe-eval'` ban — the ban does not move.
- **The two known eval sources from razors-edge still apply** — faker (`new Function`) → bake mock data to a static seeded file build-time; zod JIT → `z.config({ jitless: true })` set globally and early. apex hits both (it uses faker + zod) and applies the same two fixes.
- **WebGL-specific CSP additions:** the draco/meshopt **decoder is loaded as a Web Worker / WASM** — keep it **self-hosted** so `worker-src 'self' blob:` and `script-src` cover it (do NOT load decoders from a CDN, which would force a CSP allowlist entry and a third-party request against the budget). `img-src 'self' data: blob:` (already present for AVIF/`.ics`) also covers canvas `toDataURL`/texture blobs. The GLB + KTX2 + HDRI are same-origin static assets, so `connect-src 'self'` (already present, since there is no network in v1) covers the `fetch` for them. WASM instantiation needs `script-src` to permit WASM — modern CSP treats `'self'` WASM as allowed under `script-src 'self'` without `'unsafe-eval'` in current Chromium, but if a `'wasm-unsafe-eval'` requirement surfaces for the decoder, add **`'wasm-unsafe-eval'`** (which is narrowly WASM and does NOT re-admit JS `eval`) rather than `'unsafe-eval'` — record the outcome in `AGENT_NOTES.md` from the Task 1.4 smoke.
- `style-src 'self' 'unsafe-inline'` remains required (Next/Tailwind inline styles + GSAP inline transforms + R3F's inline canvas styles).

### Consequences

- **Positive.**
  - One unambiguous rule ("inside the canvas = R3F; scroll/DOM = GSAP; one read-only value at the seam") the frontend-engineer and reviewer enforce mechanically, with no per-component re-litigation.
  - The performance strategy is a _contract_ engineered into the architecture (static-render LCP, code-split lazy canvas, budgeted compressed model, on-demand + adaptive, capability gate to the pre-baked fallback), not a Phase-6 cleanup pass — protecting the Lighthouse-≥-95-on-mobile claim by construction.
  - The capability heuristic is concrete and testable (WebGL2 probe + cores + `deviceMemory`-when-present + coarse-pointer/viewport + `prefers-reduced-data`, plus a runtime `PerformanceMonitor` demotion), so "the gate works" is verifiable, not asserted.
  - apex starts _without_ Motion and can only add it by ADR — the stricter direction than razors-edge — keeping it honestly inside "do not stack three".
  - The CSP posture is fixed before scaffold with the WebGL additions named (self-hosted decoders, possible `'wasm-unsafe-eval'` narrowly, the `'unsafe-eval'` ban that does not move), so the security baseline is set from Task 1.1, not retrofitted.

- **Negative.**
  - Two libraries plus a heavy WebGL runtime is a real bundle/complexity cost; mitigated by the hard boundary, the code-split (three.js never in the initial bundle), the reviewer audit, and the no-Motion default.
  - The capability gate is the single most-watched item: a wrong threshold either melts a phone (too permissive) or denies a capable device the wow (too strict). Mitigated by the runtime `PerformanceMonitor` demotion (recovers from a too-permissive gate) and by tuning thresholds against the _deployed_ mobile profile in Phase 4, recorded in `AGENT_NOTES.md`.
  - `deviceMemory` is unavailable on Safari/Firefox, so the gate leans more on the WebGL2 probe + cores + viewport there; accepted (the missing signal is not penalised) and noted for the test-engineer to cover the absent-signal branch.
  - `script-src 'unsafe-inline'` (inherited) is weaker than a nonce policy; carried as the same v1.1 hardening debt razors-edge recorded, and the `'unsafe-eval'` ban — the part that proves three.js needs no eval — does not relax.

- **Follow-up tasks.**
  - **Task 1.3 (frontend-engineer):** GSAP + ScrollTrigger smoke via the inherited `useGSAP()` + lazy `loadGsap()` + `gsap.matchMedia()` pattern (apex's own `src/lib/gsap/*`), CSP-clean under `next build && next start`.
  - **Task 1.4 (frontend-engineer):** the `next/dynamic ssr:false` smoke Canvas (trivial primitive + `OrbitControls`, capped `dpr`, `frameloop="demand"`, `detectWebglTier()` stub), verify code-split out of the initial bundle, verify zero CSP violations with the scene hydrated under `next build && next start`, and record the verified CSP string + the WASM/`'wasm-unsafe-eval'` outcome in `AGENT_NOTES.md`.
  - **Task 1.1 (frontend-engineer):** set the CSP/security headers in `next.config.ts` per the posture above (mirror razors-edge's header set + the self-hosted-decoder `worker-src`/`img-src blob:` additions).
  - **Phase 4 (frontend-engineer):** tune the `PerformanceMonitor` fps thresholds and the final `dpr` caps against the deployed mobile profile; record in `AGENT_NOTES.md`. Source + budget + compress the GLB per the model budget; document provenance in `CREDITS.md`.
  - **Phase 6 (reviewer):** audit the boundary (no GSAP inside the canvas, no scene mutation by ScrollTrigger, no Motion present), the code-split (three.js out of the initial bundle), the capability gate, and the WebGL-context teardown on route change.

### References

- **razors-edge `DECISIONS.md` ADR-002 + `web/src/lib/gsap/register.ts` + `web/next.config.ts`.** The inherited GSAP/Next integration (`useGSAP()`, lazy `loadGsap()` code-split, `gsap.matchMedia()`, transform/opacity-only, CLS-safe pin) and the _verified-in-production_ CSP string (`script-src 'self' 'unsafe-inline'`, no `'unsafe-eval'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`) apex carries forward, plus the v1.1 nonce-hardening debt.
- **`docs/conventions.md` § 3** (low `'use client'` boundary), **§ 15** (R3F only for genuine 3D; one-library default + the documented exception process). **CLAUDE.md § 4, § 5** (Lighthouse ≥ 95 / a11y / CSP; "do not stack three").
- **R3F / drei** — `next/dynamic ssr:false`, `Suspense`, `useGLTF` (draco/meshopt), `Environment`, `ContactShadows`, `OrbitControls`/`PresentationControls`, `AdaptiveDpr`, `AdaptiveEvents`, `PerformanceMonitor`, `<Loader>`/`useProgress`.
- **ADR-001** — the two-library posture + the no-Motion default this ADR ratifies and bounds. **ADR-004** — the seam mechanism (the one sanctioned GSAP↔R3F coupling point) and the final reduced-motion-to-tier resolution.
- **razors-edge CSP lesson** — faker `new Function` (bake to static seed) + zod JIT (`z.config({ jitless: true })`); the `next build && next start` (not `next dev`) verification surface.

---

## ADR-003: Reservation-mock architecture — domain model, deterministic availability + pricing, the Zustand wizard + configurator store, persistence/reconciliation, the TanStack Query mock layer, and the mocked submit

**Status:** accepted
**Date:** 2026-06-04

### Context

The reservation flow is the centerpiece interaction (PLAN.md), fully client-side over seeded deterministic mock data, no backend (ADR-001 web-only thesis). This ADR (Task 0.2) fixes the concrete state/persistence/availability/pricing/fetch/submit mechanics and resolves the open modelling questions `AGENT_NOTES.md` routed here: insurance-tier modelling, same-or-different pickup/return (+ surcharge), and the date-range reconciliation rule on rehydrate. apex **inherits razors-edge ADR-003's shape wholesale** — Zustand wizard + `localStorage` `persist` (versioned key + TTL + reconciliation), per-step RHF/Zod forms, TanStack Query over an in-memory seeded source with artificial latency, a pure availability function over a frozen `now`, a server-action submit re-validating the shared Zod schema, and a hand-rolled `.ics` — and adapts it to apex's two differences: **(a)** availability is over a **date _range_** (not a single time slot), and **(b)** the wizard carries a **configurator selection** (colour/wheels) as the spine thread, deep-linkable from the configurator.

### Options considered

**Insurance-tier modelling (`AGENT_NOTES.md` flag):**

- **I-A. Insurance as a separate single-choice field on the draft (`insuranceTier: 'basic' | 'plus' | 'premium'`), distinct from the multi-select `extras: string[]`. Picked.** Insurance is exactly-one-of (a tier ladder), structurally different from extras (zero-or-more add-ons). Modelling it as its own field makes the step-3 UI honest (a radio group for insurance + checkboxes for extras), keeps `priceQuote` clean (one tier lookup + a sum over extras), and keeps the Zod schema precise (an enum vs an array). The tier definitions + per-day prices still live in mock data as `Extra` rows with `kind: 'insurance'` so the catalog is uniform, but the _draft_ holds a single `insuranceTier` id, not an entry in `extras`.
- **I-B. Insurance as an `Extra` subtype inside the `extras` array.** Uniform array, but loses the exactly-one constraint (nothing structurally stops two insurance tiers being selected), forces runtime guards, and muddies the price function. Rejected.

**Same-or-different pickup/return + surcharge (`AGENT_NOTES.md` flag):**

- **R-A. Support different pickup/return with a flat different-location surcharge that feeds `priceQuote`. Picked.** A different-return-location fee is a realistic premium-rental detail and a cheap, believable pricing input. The draft holds `pickupLocationId` + `returnLocationId`; when they differ, `priceQuote` adds a fixed `oneWayFeeMinor` (a mock constant in the pricing config). When equal, no fee. This makes the locations step meaningful to the live price (not just metadata) and is a small, tested branch.
- **R-B. Different pickup/return supported but with no surcharge.** Simpler but less believable and makes the return selector feel inconsequential. Rejected (the surcharge is a one-line pricing branch with real narrative value).

**Configurator carry-over (the spine thread, apex-specific):**

- **C-A. The configurator selection lives in the same wizard store as a `config` field, seeded from the configurator's "Reserve this configuration" CTA and from the deep-link query. Picked.** One store owns the whole reservation draft including `config: { colorId, wheelId }`; the configurator writes `config` (and `vehicleId` = the hero car) when the user clicks "Reserve this configuration", and the vehicle step reflects it. Deep-link `/reserve?vehicle=…&color=…&wheels=…` seeds the same fields (validated against the catalog; unknown params ignored, not errored — the razors-edge rule).
- **C-B. A separate configurator store + a hand-off copy into the wizard store.** Two stores to keep in sync at the seam; more surface for drift. Rejected — one draft store is simpler and the configurator's _live scene_ state (current orbit/material) is ephemeral UI state that does not belong in the persisted draft anyway; only the _chosen_ `{colorId, wheelId}` is persisted.

(Persistence = `localStorage`, submit = server action, `.ics` = hand-rolled are all inherited from razors-edge ADR-003 without re-litigation; options recorded there.)

### Decision

**Domain model + Zod schemas (`src/lib/schemas/`, the shared contract per § 5):**

- **`Vehicle`** — `{ id, slug, name, tier: 'compact' | 'sedan' | 'suv' | 'performance', rangeKm, accel0to100, seats, dailyPriceMinor, currency, heroRenderSrc, configurable?: boolean }`. A fixed hand-curated fleet; faker fills only flavour copy. Exactly one vehicle has `configurable: true` (the hero car with the GLB + colour/wheel options + the live R3F scene); the rest use static renders. `dailyPriceMinor` is the single driver of the base price.
- **`ConfiguratorOption`** — for the configurable hero vehicle: `{ vehicleId, colors: { id, name, hex, materialName }[], wheels: { id, name, previewSrc }[], renderMatrix: Record<\`${colorId}:${wheelId}\`, string> }`where`renderMatrix`maps each`(colorId, wheelId)` to a pre-baked AVIF still (the Tier-3 fallback source — ADR-004). Fixed hand-curated; the matrix is kept small (a handful of colours × 2–3 wheels — PLAN.md out-of-scope).
- **`Location`** — `{ id, slug, name, kind: 'airport' | 'city' | 'depot', address, lat, lng, staticMapSrc }`. Small fixed set; drives the pickup/return selectors and the locations section.
- **`Extra`** — `{ id, name, kind: 'gps' | 'child-seat' | 'additional-driver' | 'insurance', priceMinor, pricing: 'per-day' | 'flat', tier?: 'basic' | 'plus' | 'premium' }`. Fixed hand-curated. Insurance rows carry `kind: 'insurance'` + a `tier`; non-insurance extras are the multi-select add-ons. (The _draft_ holds insurance separately — see below.)
- **`VehicleBooking`** (seeded pre-bookings / blackouts) — `{ id, vehicleId, fromISODate, toISODate }` (half-open `[from, to)` date ranges), seeded per vehicle so each car has realistic gaps. Deterministic from the seed.
- **`ReservationDraft`** (Zustand state + a Zod schema for the persisted-shape guard and the submit projection) — `{ step, vehicleId?, config?: { colorId, wheelId }, range?: { fromISODate, toISODate }, pickupLocationId?, returnLocationId?, extras: string[], insuranceTier?: 'basic' | 'plus' | 'premium', driver?: { name, phone, email, licenceNo, notes? }, savedAt }`. **`insuranceTier` is a separate single-choice field (decision I-A); `extras` is the multi-select array.**
- **`Driver`**, **`Testimonial`**, **`Shop`** (the rental business: name, locations ref, hours, support — drives the footer + `AutoRental` JSON-LD) schemas as PLAN.md.
- **`PriceQuote`** (derived) — `{ base, extrasTotal, insuranceTotal, oneWayFee, discount, total, currency }`.
- **`ConfirmedReservation`** (submit return) — `{ reference, vehicle, config?, range, rentalDays, pickup, return, extras, insuranceTier, quote, isDemo: true }`.

**Deterministic availability — the pure contract (over a date range):**

- **Frozen `now`.** `src/lib/clock.ts` exports a single frozen reference instant (a fixed ISO date, e.g. a chosen weekday) used by `getRangeAvailability`, `priceQuote`, the date-range window ("the next ~60 days"), the UI, and all tests. **No `Date.now()` / `new Date()` / `Math.random()` in render or in the pure functions** (the tape/meld/razors-edge discipline). A documented test-only override may advance the clock; the default is frozen.
- **`getRangeAvailability({ vehicleId, fromISODate, toISODate }): { available: boolean; conflicts: VehicleBooking[] }`** in `src/lib/availability.ts` — pure, deterministic, no React, Vitest-covered (Phase 7). A requested half-open range `[from, to)` is available iff it lies within the bookable window (`now ≤ from`, `to ≤ now + 60d`, `from < to`, and `rentalDays` within min/max) **and** overlaps **no** seeded `VehicleBooking` for that vehicle (interval overlap on half-open ranges: `from < booking.to && booking.from < to`). Conflicts are returned (not just a boolean) so the UI can explain _why_ a range is unavailable (accessible reasons, not silent disabling).
- **`getDisabledRanges({ vehicleId }): { fromISODate, toISODate }[]`** — a helper that returns the vehicle's blackout/booked ranges within the window so the date-range picker can disable/grey them. Pure, derived from the same seeded data.

**Deterministic pricing — the pure contract:**

- **`priceQuote({ vehicle, rentalDays, extras, insuranceTier, oneWay }): PriceQuote`** in `src/lib/pricing.ts` — pure, deterministic, Vitest-covered. `base = vehicle.dailyPriceMinor × rentalDays`; `extrasTotal = Σ over selected non-insurance extras of (pricing === 'per-day' ? priceMinor × rentalDays : priceMinor)`; `insuranceTotal = insuranceTier ? (its Extra row, per-day) × rentalDays : 0`; `oneWayFee = oneWay ? ONE_WAY_FEE_MINOR : 0` (decision R-A; a mock constant); `discount` = an optional mock multi-day discount (e.g. ≥7 days → a small % off `base`, kept simple and tested at the boundary); `total = base + extrasTotal + insuranceTotal + oneWayFee − discount`. `rentalDays` is computed from the range as whole days (`to − from`), the single driver alongside `dailyPriceMinor`.

**Zustand wizard + configurator store (`persist`):**

- **Five steps:** `vehicle → dates-locations → extras → driver → confirmation`, a `step` discriminant + the accumulated `ReservationDraft`.
- **Step-guard rules (pure selectors, unit-tested):** cannot advance past `vehicle` without `vehicleId`; cannot advance past `dates-locations` without a `range` that passes `getRangeAvailability` **and** `pickupLocationId` + `returnLocationId`; cannot advance past `extras` (extras/insurance optional, so this guard is a no-op pass-through but the step is still navigable); cannot submit without a valid `driver`.
- **Configurator carry-over (decision C-A):** the configurator's "Reserve this configuration" writes `vehicleId` (the hero car) + `config: { colorId, wheelId }` into the store and routes to `/reserve` at the `dates-locations` step (vehicle already chosen). The vehicle step + the summary rail reflect the carried config (the spine thread). The live scene's transient orbit/material state is **not** persisted — only the chosen `{colorId, wheelId}`.
- **Deep-link seeding:** `/reserve?vehicle=…&color=…&wheels=…` pre-seeds `vehicleId`/`config` (validated against the catalog; unknown/invalid params ignored, not errored) and advances `step` past satisfied stages. A plain `/reserve` starts at `vehicle`.
- **`persist` configuration:** Zustand `persist`, `storage: localStorage`, **key `apex:reservation-draft`**, **`version: 1`** with a `migrate` stub, a **TTL of 24 h** via the `savedAt` field — on rehydrate, if `now − savedAt > 24h` the draft is discarded and the wizard starts clean. Driver PII is persisted only locally as typed (no network, consistent with the "no real PII leaves the device" note); a "Start over" control clears the persisted draft; the draft is cleared on successful confirm.
- **Date-range reconciliation on rehydrate (decision; the `AGENT_NOTES.md` flag, adapted to a range):** on rehydrate, if the draft holds a `range`, the wizard **re-runs `getRangeAvailability` for the persisted `(vehicleId, from, to)`.** Under the frozen clock + seeded mocks, availability is stable, so the normal demo restores exactly. The reconciliation path exists for (a) the clock/seed being advanced via the escape hatch or (b) a future time-relative mock change: if the held range is **no longer fully available**, the wizard **keeps `vehicleId` + `config`, clears `range`, drops the user back on the `dates-locations` step, and shows a non-blocking notice ("Your selected dates are no longer available — please pick another range"),** never silently confirming a stale range or wiping the whole draft. Unit-tested with a **forced-stale fixture** (Phase 7) so the path does not rot untested (the exact razors-edge lesson).

**TanStack Query over the mock source (no network):** mock data is fetched through TanStack Query against an **in-memory seeded source** (`src/mocks/*` + `getRangeAvailability`) wrapped in async functions with a small deterministic artificial latency — **not `fetch`** — so loading/error/`isPending` ergonomics, query keys, and cache behaviour are idiomatic while the source is local. Query keys: `['vehicles']`, `['vehicle', slug]`, `['locations']`, `['extras']`, `['availability', vehicleId, fromISODate, toISODate]`, `['disabled-ranges', vehicleId]`. Stated explicitly so no one wires a real endpoint: there is no network in v1.

**Mocked submit surface:** a **Next.js server action** (`reserveVehicle`) that re-validates the `ReservationDraft` submit projection with the **shared Zod schema** (the same `src/lib/schemas` files the form steps use), waits a realistic beat, and returns a deterministic `ConfirmedReservation` with a generated `reference` (deterministic from the draft — e.g. a short stable hash — so screenshots are stable) and `isDemo: true`. Nothing persists server-side; the persisted draft is cleared on successful confirm; a reload of the confirmation starts fresh. Inputs sanitized; the driver licence is **format-validated only** (a Zod regex, no real verification).

**Confirmation `.ics`:** **hand-rolled** (no `ics` dependency) — a minimal RFC-5545 VEVENT in `src/lib/ics.ts` built from the `ConfirmedReservation`: an **all-day or multi-day VEVENT spanning the rental range** (`DTSTART;VALUE=DATE` = `from`, `DTEND;VALUE=DATE` = `to`, exclusive per the iCalendar all-day convention), `SUMMARY` = "APEX rental — {vehicle} ({colour}/{wheels})", `LOCATION` = pickup address, emitted as a `text/calendar` `Blob` download. Kept minimal and tested against the frozen clock for broad calendar-client compatibility.

### Consequences

- **Positive.**
  - Insurance-as-a-separate-field (I-A) makes the step-3 UI, the Zod schema, and `priceQuote` all honest about the exactly-one-of constraint, while the catalog stays uniform (insurance rows are `Extra`s with a `tier`).
  - The range-based `getRangeAvailability` + `getDisabledRanges` + the pure `priceQuote` are two small, deterministic, Vitest-isolated functions (the § 10 "domain logic does not need a backend" point made concrete) — reproducible across reloads under the frozen clock.
  - One store owns the whole draft including the carried configurator `config`, so the spine thread (configure → reserve) is a single source of truth, deep-linkable, with the ephemeral live-scene state correctly excluded from persistence.
  - `localStorage` + versioned key + 24 h TTL + the range-reconciliation rule means a real mobile customer survives an accidental reload, the demo stays deterministic, and a stale range degrades gracefully instead of confirming a lie.
  - The shared Zod schema is the single contract for the form steps and the server-action submit (§ 5) even without a backend; the one-way surcharge makes the locations step meaningful to the live price.

- **Negative.**
  - Persisting driver fields to `localStorage` (even locally, never transmitted) is a minor privacy footprint; mitigated by the 24 h TTL, "Start over", clear-on-confirm, and the demo-honesty copy. The reviewer confirms nothing is transmitted.
  - The reconciliation path is mostly dormant under the frozen clock, so it MUST be exercised by a forced-stale unit-test fixture (Phase 7) or it rots untested.
  - A hand-rolled multi-day all-day `.ics` must get the exclusive-`DTEND` all-day convention right for broad calendar compatibility; mitigated by keeping the event minimal and testing against the frozen clock.
  - A flat one-way fee is a simplification of real distance-based one-way pricing; acceptable for the fiction and noted as a v2 README line if richer pricing is ever wanted.

- **Follow-up tasks.**
  - **Task 3.1 (frontend-engineer):** the Zod schemas above — `Vehicle.configurable`, `ConfiguratorOption.renderMatrix`, `Extra` with `kind: 'insurance'` + `tier`, `ReservationDraft` with the separate `insuranceTier` field + `extras` array + `config` + `savedAt`, the persisted-shape guard, `PriceQuote`, `ConfirmedReservation`, `Driver` (licence regex), `Shop`.
  - **Task 3.2 (frontend-engineer):** seed the fixed fleet (one `configurable`), the configurator colours/wheels + the `renderMatrix` mapping, locations, extras incl. insurance tiers, per-vehicle blackouts/bookings, testimonials, and `src/lib/clock.ts` frozen `now`. Bake faker output to a static seeded file (CSP — ADR-002).
  - **Task 3.3 (frontend-engineer):** the pure `getRangeAvailability` + `getDisabledRanges` per the algorithm above.
  - **Task 3.4 (frontend-engineer):** the pure `priceQuote` (days × daily + extras + insurance tier + one-way fee − multi-day discount).
  - **Task 5.4 (frontend-engineer):** the Zustand store with key `apex:reservation-draft`, `version: 1`, 24 h TTL via `savedAt`, the step guards, the configurator carry-over, deep-link seeding, and the rehydrate range-reconciliation rule.
  - **Task 5.6 (frontend-engineer):** the `reserveVehicle` server action (shared-schema re-validate, deterministic `reference`, `isDemo`), clear-draft-on-confirm, the licence-format-only validation, and `src/lib/ics.ts` (multi-day VEVENT over the rental range).
  - **Task 7.1 (test-engineer):** Vitest for `getRangeAvailability` (blackouts, existing bookings, window bounds, overlap edge cases, frozen-`now` determinism), `priceQuote` (days × daily + per-day vs flat extras + insurance tiers + one-way fee + multi-day discount boundaries), and the wizard machine (guards, config carry-over, deep-link seeding, persist rehydrate + the forced-stale range reconciliation, submit-payload projection).

### References

- **razors-edge `DECISIONS.md` ADR-003.** The inherited shape: Zustand wizard + `localStorage` `persist` (versioned key + TTL + savedAt + reconciliation), per-step RHF/Zod, TanStack Query over an in-memory seeded source with artificial latency (no `fetch`), the pure availability function over a frozen `now`, the server-action submit re-validating the shared schema, the hand-rolled `.ics`. apex adapts it to a date _range_ + the configurator carry-over.
- **`docs/conventions.md` § 5** (shared Zod schemas), **§ 6** (`faker.seed` determinism + bake-to-static for CSP), **§ 3** (server actions for same-page mutations).
- **PLAN.md** — "Reservation flow", "Live price summary", "Mock data shape". **ADR-001** — the web-only thesis. **ADR-002** — the CSP eval-source neutralisation (faker bake, zod `jitless`) the mock layer must honour. **ADR-004** — the configurator's `renderMatrix` is the Tier-3 fallback source the carry-over writes from.

---

## ADR-004: Hero→configurator hand-off seam, the four-tier degradation contract, the pre-baked render matrix, and the configurator's accessible DOM-control model

**Status:** accepted
**Date:** 2026-06-04

### Context

The hero→configurator hand-off is the planner's named **highest-risk integration** (PLAN.md; ADR-001) and the **single point where the inside-canvas/outside-canvas boundary (ADR-002) is necessarily crossed**. This ADR (Task 0.3) pins: the exact seam where the static AVIF hero render hands off to the live R3F canvas without a visible pop, CLS, or the canvas ever becoming the LCP; how GSAP scroll progress couples to the scene at the seam (the one sanctioned coupling from ADR-002); the **pre-baked render matrix** (colour × wheel) generation + the Tier-3 fallback wiring; the configurator's **accessible DOM-control model + screen-reader text alternative**; and the **four-tier degradation** precisely enough for the frontend-engineer to build (Tasks 4.2/4.3/4.4) and the designer-critic to judge (Task 6.1). It builds on ADR-002 (the integration + performance contract + the capability gate) and ADR-003 (the configurator writes `config` into the reservation store). It resolves the `AGENT_NOTES.md` flag left open in ADR-002: **whether reduced-motion forces Tier 3** (resolved below: no — reduced-motion keeps user-driven interactivity and only changes the _reveal_ and disables auto-orbit).

### Options considered

**The seam — how the static render hands off to the live canvas:**

- **S1. Cross-layer "reveal when ready": the static AVIF render is the LCP and stays the visible surface; the live Canvas mounts behind it (lazy, ADR-002) in the same reserved box, and only crossfades in once R3F signals first-frame-ready AND the GLB is loaded. GSAP scroll progress drives the _static_ hero composition (scale/settle to hero pose) and, once the live canvas is ready, hands the camera a matching pose so the swap is pose-aligned (no jump). Picked.** The viewer never sees an empty/loading canvas; the LCP is provably the static image; the swap is invisible because the live camera is posed to match the static render's framing at the swap instant.
- **S2. Mount the live Canvas immediately and animate the camera in from the start.** The canvas risks becoming the LCP, blocks first paint on three.js+GLB, and shows a loading/empty canvas during boot. Rejected (violates the ADR-002 "LCP is never the canvas" contract).
- **S3. No live hand-off — the configurator is a separate section the hero scrolls _to_ (the ADR-001/`AGENT_NOTES.md` fallback re-shaping).** Lowest risk, but loses the "the still image becomes a thing you can grab" wow that is the spine's emotional centre. **Held as the documented fallback** if S1 cannot hit the budget/feel in Phase 4 (the frontend-engineer raises it; keep the three effects reading as one art direction either way) — but S1 is the target.

**The GSAP↔R3F coupling at the seam (`AGENT_NOTES.md` flag):**

- **G1. One-directional value passing: GSAP writes a scroll-progress number (0→1) to a ref/store; R3F reads it inside its own `useFrame`/`invalidate` loop to interpolate the intro camera/scene. The two libraries never write the same property. Picked.** GSAP owns the DOM scroll + the static-layer choreography; R3F owns the scene; the seam is a single readable value, honouring the ADR-002 boundary exactly. `frameloop="demand"` is driven by `invalidate()` while the seam progress is changing.
- **G2. GSAP tweens three.js object properties directly (a shared `gsap.timeline` mutating camera position).** Crosses the boundary in the forbidden direction (GSAP mutating the scene), couples the two render loops, and fights `frameloop="demand"`. Rejected.

### Decision

**The seam (Option S1 + coupling G1):**

- **Layer model in the hero/configurator section (one reserved box, back to front):** (1) the **static `next/image` AVIF product render** — `priority`, sized, blur placeholder — **the LCP element**; (2) the **live R3F `<Canvas>`** (lazy, `ssr:false`, ADR-002), mounted _behind_ the static render in the _same reserved box_ (CLS < 0.1 — the box is reserved at first paint regardless of which layer is visible); (3) the **DOM swatch controls + the screen-reader text alternative** (real DOM, always present — the a11y/no-JS floor).
- **First paint → LCP:** only the static render and the real-DOM controls/text are visible and counted. three.js + the GLB load after LCP, on approach (ADR-002 capability gate decides whether they load at all).
- **GSAP scroll choreography (Tier 1):** a pinned/scrubbed `ScrollTrigger` timeline (inherited `useGSAP` + `matchMedia`, transform/opacity-only, CLS-safe pin — razors-edge ADR-002/004) introduces the car on the _static_ layer (scale + settle toward the hero pose) and writes a normalised seam-progress value.
- **The reveal-when-ready swap:** the live Canvas signals ready when **both** R3F has rendered its first frame **and** `useGLTF` has resolved the GLB (a drei `useProgress`/`onCreated` + a loaded flag). At that instant — and only then — the live camera is set to the **pose matching the static render's framing**, then a short **opacity crossfade** swaps the static render out and the live canvas in. Because the camera is pose-matched, there is no positional pop; because it waits for ready, there is no empty-canvas flash. If ready never fires (slow asset / runtime demotion from ADR-002's `PerformanceMonitor`), the static render simply stays — which is the Tier-3 surface anyway, so a failed reveal degrades into the fallback rather than into a broken state.
- **Coupling (G1):** GSAP writes seam-progress to a ref/Zustand slice; R3F reads it in `useFrame` to interpolate the intro camera during the pinned phase (calling `invalidate()` while progress changes, honouring `frameloop="demand"`). One-directional, value-only.

**The pre-baked render matrix (Tier-3 fallback source):**

- **Generation:** the colour × wheel matrix is rendered **offline from the same GLB + the same studio lighting/camera as the live scene** (a build-time/offline script using the same three.js setup, or a headless render), so the stills are visually consistent with the live configurator (the `AGENT_NOTES.md` "must not drift" requirement). Output: one **AVIF still per `(colorId, wheelId)`**, stored as static assets, mapped by `ConfiguratorOption.renderMatrix` (ADR-003). Kept small (a handful of colours × 2–3 wheels — PLAN.md out-of-scope) to bound asset weight and render count.
- **Wiring:** the Tier-3 configurator renders the matrix still for the current `{colorId, wheelId}` via `next/image` (AVIF); tapping a colour/wheel swatch swaps to the corresponding still (a pre-loaded image swap, instant, no GPU). The swatch controls + the carried-config + the "Reserve this configuration" CTA are **identical DOM** across Tier 1 and Tier 3 — only the _display surface_ (live canvas vs still) differs — so the same store writes, the same a11y, and the same spine thread work in both.

**The configurator's accessible DOM-control model + screen-reader text alternative (all four tiers):**

- **Colour and wheel controls are real DOM radio groups** (`role="radiogroup"` / native `<input type="radio">` styled, with `aria-checked`/`aria-label` per swatch), keyboard-operable (arrow keys within a group, Tab between groups), with brand-styled visible focus — **never canvas-only**. They live in the server-rendered DOM (present without JS).
- **The WebGL canvas has a real-DOM text alternative** — a visually-appropriate but screen-reader-complete description of the _current configuration_ ("APEX {model}, {colour name}, {wheel name}"), updated as the selection changes (an `aria-live="polite"` region), so a screen-reader/keyboard user gets the same information and configures via the DOM without manipulating the 3D scene. The canvas itself is `aria-hidden` (it is a presentational surface; the information is in the DOM).
- **The "Reserve this configuration" CTA** writes `{vehicleId, config}` to the reservation store and routes to `/reserve` (ADR-003 carry-over) — identically in all tiers.

**The four-tier degradation contract (resolving the reduced-motion question):**

- **Tier 1 — full (capability gate passes, JS on, motion OK):** the live R3F scene (drag-to-orbit with damping/bounds via `OrbitControls`/`PresentationControls`, live colour/wheel swaps, studio lighting + `ContactShadows`), the GSAP scroll-hero with the pose-matched reveal-when-ready hand-off, and (optionally) a gentle idle auto-orbit flourish.
- **Tier 2 — `prefers-reduced-motion: reduce` (capability still allows the live scene):** **no scrubbed scroll choreography and no idle auto-orbit.** The hero hand-off becomes a **simple opacity crossfade** from the static render to the (still) live configurator frame once ready — no scroll-scrubbed intro. **The configurator stays interactive on direct user input** — the user can drag-to-orbit and tap swatches, because that is user-initiated, not auto-motion (the resolution of the ADR-002 flag: reduced-motion does NOT force Tier 3; it removes _automatic_ motion only). Gallery reveals are static/instant.
- **Tier 3 — no-WebGL / low-power / `prefers-reduced-data` (the ADR-002 capability gate routed here, OR a runtime `PerformanceMonitor` demotion):** the **pre-baked render matrix** — the configurator shows the AVIF still for the current `{colorId, wheelId}`; swatches swap stills (instant, no GPU); the same DOM controls, carried config, text alternative, and "Reserve this configuration" CTA. The hero hand-off is a crossfade from the static render to the still configurator (no live canvas mounts at all). This is the surface the **mobile Lighthouse run** measures.
- **Tier 4 — no-JS / failed hydration:** the section renders server-side as the **default-configuration static render** (the matrix still for the default `{colorId, wheelId}`) with real `alt` text, the real-DOM swatch controls (non-interactive without JS but present and labelled), the configuration text alternative, and a real `<a href="/reserve?vehicle=…">` "Reserve" link. Every section's content is real server-rendered DOM; WebGL and scroll only ever _enhance_ a page that already reads and is crawlable.

### Consequences

- **Positive.**
  - The seam is engineered so the **LCP is provably the static render**, there is **no empty-canvas flash** (reveal waits for first-frame + GLB ready), and **no positional pop** (the live camera is pose-matched to the static framing at the swap) — the three failure modes the planner feared are each closed by construction.
  - The GSAP↔R3F coupling is one-directional value-passing, honouring the ADR-002 boundary exactly — the two libraries never fight over a property, and `frameloop="demand"` is preserved.
  - The pre-baked matrix is rendered from the _same_ GLB/lighting as the live scene, so Tier 3 reads as "the same configurator, just stills" rather than a degraded stub (the designer-critic's named bar) — and the DOM controls/CTA/text-alternative are identical across tiers, so the spine thread and a11y work everywhere.
  - The reduced-motion question is resolved cleanly: reduced-motion removes _automatic_ motion (scrub, auto-orbit) and simplifies the reveal to a crossfade, but **keeps user-driven interactivity** — honouring `prefers-reduced-motion` without amputating the wow for users who can still drag a model.
  - Four tiers are specified precisely, so reduced-motion / no-WebGL / no-JS are first-class spec the test-engineer and designer-critic verify, not afterthoughts.

- **Negative.**
  - Pose-matching the live camera to the static render's exact framing is fiddly (the static render must be captured from a known camera the live scene can reproduce); mitigated by rendering the static hero render from the **same camera/lighting rig** used for the live scene and the matrix (one rig, three outputs: the hero still, the matrix stills, the live scene) — recorded as a Phase-4 constraint.
  - Generating the matrix offline from the live rig is an extra build step; mitigated by it being a one-off script per model and by the small matrix size.
  - If S1 cannot hit the budget/feel, the S3 fallback (configurator as a section the hero scrolls _to_) is the documented escape — the frontend-engineer raises it in `AGENT_NOTES.md`; the spine must still read as one art direction.
  - The `aria-live` configuration description must be debounced/polite so rapid swatch changes do not spam a screen reader; noted for Task 4.3.

- **Follow-up tasks.**
  - **Task 4.2 (frontend-engineer):** the scroll-hero — static AVIF render as LCP (rendered from the shared camera/lighting rig), the pinned GSAP intro writing seam-progress, the reserved box, CLS-safe. Tier-2 crossfade branch via `matchMedia`.
  - **Task 4.3 (frontend-engineer):** the live R3F configurator — load the budgeted compressed GLB, orbit (damping/bounds), live colour/wheel swaps reading store state, the real-DOM radio-group swatch controls + the `aria-live` configuration text alternative (debounced), the "Reserve this configuration" CTA (ADR-003 carry-over). Source/grade/compress the royalty-clear model (provenance → `CREDITS.md`).
  - **Task 4.4 (frontend-engineer):** generate the colour×wheel matrix from the shared rig; wire the ADR-002 capability gate + the runtime demotion to swap live↔stills; implement the reveal-when-ready pose-matched crossfade (Tier 1), the reduced-motion crossfade (Tier 2), the no-JS default-still frame (Tier 4); verify no flash/CLS.
  - **Task 6.1 (designer-critic):** judge the configurator + the seam against Bruno Simon + Stripe/Vercel ship pages (is the orbit tactile, are swaps instant, is the reveal seamless, does Tier 3 read as the same configurator) — zero pochwał.
  - **Task 7.2 (test-engineer):** Playwright for the configurator DOM-swatch interaction + the Tier-3 pre-baked path, keyboard operation of the swatches, and the `prefers-reduced-motion` hero path (crossfade, no scrub, no auto-orbit).

### References

- **ADR-002** — the R3F/Next integration, the performance contract, the capability gate (which routes to Tier 3 here), the one sanctioned GSAP↔R3F coupling point, and the reduced-motion-orthogonal-to-tier flag this ADR resolves.
- **ADR-003** — the configurator writes `{vehicleId, config}` into the reservation store (the carry-over the CTA performs); `ConfiguratorOption.renderMatrix` is the Tier-3 source.
- **razors-edge `DECISIONS.md` ADR-004.** The hero LCP-is-the-static-asset rule, the CLS-safe transform pin, the `matchMedia` reduced-motion branch, the no-JS static-composed-frame floor — the four-tier discipline apex extends to cover WebGL.
- **PLAN.md** — the wow spine ("one car, brought closer"), the four-tier WebGL degradation, the configurator a11y requirements, the pre-baked matrix scope. **`docs/inspirations.md`** — Bruno Simon + Stripe/Vercel ship pages (the configurator + seam bar). **CLAUDE.md § 4** (Lighthouse ≥ 95, a11y WCAG 2.2 AA, reduced-motion, `next/image` AVIF).

---

## ADR-005: Production deploy posture — Fly.io single-machine Next standalone, web-only, no secrets; the Linux/Docker standalone build (P1-3); the branded-model public-deploy precondition (P0-1)

**Status:** accepted
**Date:** 2026-06-05

### Context

apex is feature-complete, reviewed (review-6.3), tested (151 Vitest + 22 Playwright), and perf-fixed (desktop Lighthouse ≥ 95 on `/` and `/reserve`; the mobile sub-95 is a documented Lighthouse-4×-CPU-throttle artifact — at real-device CPU the mobile run scores 100 / LCP 1000 ms, ADR-002 §3). The only remaining Phase-8 work is the deploy itself. apex is **web-only** (ADR-001) — a single Next.js 15 App Router app with `output: 'standalone'`, a mocked server action (`app/reserve/actions.ts`), a generated OG image, JSON-LD/metadata, and on-demand `next/image` AVIF optimization, over a fully in-memory reservation flow (ADR-003) and a client-side WebGL configurator (R3F + drei, ADR-002). It has no backend service, no database, no migrations, and no runtime secrets. This ADR ratifies the deploy posture so the deploy artifacts (`Dockerfile`, `fly.toml`, `.dockerignore`, `DEPLOY.md`) sit on a recorded footing consistent with the ADR-001..004 trail, mirroring **razors-edge ADR-005** (the proven web-only Fly single-Machine standalone template) adapted to apex.

Two project-specific items force their way into this ADR rather than living only in the runbook:

1. **P1-3 (reviewer finding) — the Windows standalone EPERM.** On the Windows host, `next build` emits `output: 'standalone'` but logs `⚠ Failed to copy traced files … EPERM: operation not permitted, symlink …` (the host lacks the symlink privilege — no admin / Developer Mode; the gotcha documented since Phase 1 in `AGENT_NOTES.md`). The host's standalone trace is incomplete and unshippable. The deploy must build the standalone artifact where symlink tracing works — i.e. inside the Linux Docker context — and must never ship a host-built `.next`.
2. **P0-1 (reviewer finding) — the branded model.** The currently-shipped `web/public/models/apex-suv.glb` is an optimized but **branded** Mercedes-Benz Maybach GLS 600 (trademarks + `gls_`/`maybach` material names), which is NOT royalty-clear (violates ADR-001/002). The infra can be fully prepared and a PRIVATE/STAGING build can run, but a PUBLIC demo URL is licensing-blocked until the unbadged CC0 GLB swap lands. This is recorded here as an explicit precondition, not buried in the runbook.

### Options considered

- **A. Fly.io, single Machine, single Node process (the Next standalone server), region `fra`, standalone built inside a multi-stage Linux Dockerfile. Picked.** Mirrors the portfolio's existing Fly posture (razors-edge, meld, tape) for host consistency, and strips meld's entrypoint-fan-out / migration complexity that a web-only app does not need. One process = one health check on `/`, the simplest logs, the smallest image. Building the standalone in the Linux build stage resolves P1-3 by construction (Linux symlinks work; the Windows EPERM never occurs).
- **B. Static export to a CDN/edge host (Cloudflare Pages, Vercel static).** Tempting for a "static-ish" marketing site, but **rejected**: the app genuinely needs the Node runtime — the mocked server action, the generated OG image, JSON-LD/metadata, and on-demand `next/image` AVIF optimization are not expressible as a pure static export without losing behaviour. `output: 'standalone'` is the honest runtime. (The configurator being WebGL does not change this — WebGL is client-side; the server still must run the Node surface above.)
- **C. Vercel (the Next-native host).** Valid and zero-config, and would side-step the Windows-EPERM entirely (it builds on Linux). But the portfolio's deploy story is Fly + Docker standalone across the board (razors-edge, meld, tape), and keeping apex on Fly demonstrates the same Docker/standalone competence rather than offloading it to a managed Next host. **Rejected for portfolio consistency**, not capability. (Option A already gets the Linux-build benefit C would offer, via the Docker build stage.)
- **D (orthogonal, on machine size). 256 MB vs 512 MB.** razors-edge's first deploy OOM-killed at 256 MB on the first on-demand `next/image` optimization of a cinematic AVIF. apex has the same image-optimization (sharp) path on its hero + gallery renders. **512 MB picked** to serve the image-optimization path cleanly from the first request; the Next server itself is light (the heavy three.js + the 1.9 MB GLB run in the browser, never on the server). Bump-to-1024 is a no-ADR path if a burst pressures it.

### Decision

**Deploy to Fly.io as a single Machine in `fra` running one process — the Next.js standalone Node server on internal port 3000, behind Fly's 443 TLS terminator.** Three-stage Dockerfile (deps install → Next standalone build → slim `node:22-bookworm-slim` runtime, non-root `node` user), with **`NEXT_PUBLIC_SITE_URL=https://apex-rentals.fly.dev` baked at BUILD time** (Next inlines `NEXT_PUBLIC_*` at build; the canonical/OG/JSON-LD URLs depend on it — the meld lesson that a wrong baked `NEXT_PUBLIC_*` silently ships; the dev fallback is `http://localhost:3090`). **No entrypoint script, no migrations, no secrets** — `CMD` execs `server.js` directly. The one-hop `outputFileTracingRoot` (web/next.config.ts, pinned to the apex project root `projects/apex/`) nests the bundle as `web/.next/standalone/web/server.js`, so the runtime layout is `/app/web/web/server.js` with `.next/static` + `public` as siblings. HTTP health check on `/` (a 200 is the liveness signal — there is no separate `/health` route). `auto_stop_machines = 'stop'` + `min_machines_running = 1` keep one Machine warm so the showcase loads without a cold start before the scroll-hero-into-3D-configurator wow moment. VM shared-cpu-1x / **512 MB** (option D). Region `fra` (EU — owner in Poznań).

**App name `apex-rentals` is a placeholder** the owner may rename; renaming requires updating the `fly.toml` `app =` line AND every `NEXT_PUBLIC_SITE_URL` (the Dockerfile ARG default + the `[env]` mirror) in lockstep, since every absolute URL is built from it (documented in DEPLOY.md).

**P1-3 RESOLUTION (recorded):** the standalone artifact is built **inside the Linux `node:22-bookworm-slim` build stage**, where symlink tracing works, so the EPERM that occurs on the Windows host does not occur and the emitted `web/.next/standalone/web/server.js` is complete. The host's `.next` is excluded by `.dockerignore`, so a broken Windows trace can never leak into the image. `--remote-only` deploys additionally build on Fly's Linux builder, so even a deploy issued from the Windows host produces a Linux-built standalone. The Windows EPERM is therefore a host-only dev artifact with **zero deploy impact** — P1-3 is resolved by the deploy architecture, not worked around.

**`next.config.ts` is UNCHANGED:** it already carries `output: 'standalone'` and the correct one-hop `outputFileTracingRoot` (`fileURLToPath(new URL('../', import.meta.url))` → `projects/apex/`), set in Phase 1 and Windows-path-safe. The Dockerfile's COPY paths match what `pnpm -F apex-web build` produces under `.next/standalone` (verified — see Consequences). No config change was needed for the Docker context.

**Runtime assets:** the optimized **1.9 MB `web/public/models/apex-suv.glb`** (the live configurator + the Tier-3 stills source) and the AVIF renders / gallery crops / static maps / OG image under `web/public/` ARE required at runtime and ship in the image (carried by the `public` COPY). The **raw 31 MB source GLB is NOT** in the context (not in the repo, not under `public/`; `.dockerignore` also defensively drops `**/source/*.glb`).

**P0-1 PUBLIC-DEPLOY PRECONDITION (recorded, BLOCKING for public):** the shipped GLB is branded and NOT royalty-clear. The infra may be prepared and a PRIVATE/STAGING build may run now, but **going PUBLIC requires the unbadged CC0 GLB swap first** (swap `public/models/apex-suv.glb`, re-run `model:optimize` + `renders:scene`, re-verify CSP, update `CREDITS.md`). The image builds and runs fine with the branded model — this is a licensing precondition, not a technical one — but the demo URL must not be published until P0-1 is cleared. DEPLOY.md carries this as an unmissable STOP block at the top.

### Consequences

- **Positive.**
  - Cheapest class of deploy in the portfolio (~$3-7/mo — no backend, no database). Single process = trivial ops (one health check, one log stream, no migration gate). Host-consistent with razors-edge/meld/tape (Fly + Docker standalone).
  - **P1-3 is resolved by construction** — the Linux build stage produces a complete standalone trace, so the Windows-host EPERM is a dev-only artifact with no deploy or CI impact. The earlier "build passes (EPERM = known Windows gotcha)" phrasing in PROGRESS is now backed by a deploy that does not depend on the host build.
  - **PROVEN, not asserted:** a local `docker build` of this exact Dockerfile succeeded on Linux (Docker 29.3.1), producing a complete standalone with zero EPERM, and the resulting container serves `/` 200 with the correct CSP header and the GLB 200 (see verification in PROGRESS / AGENT_NOTES).
  - The baked `NEXT_PUBLIC_SITE_URL` makes every absolute URL correct from the first request. No secret surface to defend (consistent with the "no PII, persists nothing" cross-cutting note).
  - The deployed Fly real-CPU run becomes the authoritative mobile-perf measurement (ADR-002 §3), settling the synthetic-throttle mobile-Lighthouse artifact on real hardware.

- **Negative.**
  - A single Machine has no redundancy — a crash drops the demo until Fly restarts it (acceptable for a portfolio demo; the warm-floor + auto-start covers the common case). The warm floor costs ~$3-5/mo at idle versus true scale-to-zero; deliberate, to protect the five-second first impression.
  - **The public deploy is gated on P0-1** (the branded-model swap), which is owner-work outside this ADR. The infra ships ready, but the canonical URL must not go public until the swap lands — a recorded, deliberate hold, not an oversight.
  - 512 MB is comfortable for the image-optimization path but not generous under a sustained burst; the documented bump-to-1024 path covers it without an ADR.
  - `'unsafe-inline'` for scripts (inherited) is weaker than a nonce policy — the same v1.1 hardening debt razors-edge recorded; the `'wasm-unsafe-eval'` addition is narrowly WASM (the meshopt decoder) and the `'unsafe-eval'` JS ban does not move.

- **Follow-up tasks.**
  - **[OWNER — public-deploy gate] P0-1: swap the branded GLB** for a royalty-clear unbadged CC0 model, re-run `model:optimize` + `renders:scene`, re-verify CSP (`verify-csp.mjs`), update `CREDITS.md`. Until then, only PRIVATE/STAGING deploys.
  - **[OWNER — executes the deploy] Run the DEPLOY.md steps** (`flyctl apps create apex-rentals` then `flyctl deploy --remote-only --config projects/apex/fly.toml --dockerfile projects/apex/Dockerfile projects/apex`). This ADR/task PREPARES the deploy; the owner executes it (no Fly credentials in this environment).
  - **[OWNER — after first deploy] Confirm the live mobile-perf** on real hardware (the authoritative measurement per ADR-002 §3) and the served CSP via `curl -sI .../ | grep -i content-security-policy`.
  - **[doc-writer — Phase 8.1/8.2] README + CHANGELOG** restate the deploy posture, the demo URL (once public), and the P0-1 swap path.

### References

- **razors-edge `DECISIONS.md` ADR-005 + `Dockerfile` / `fly.toml` / `.dockerignore` / `DEPLOY.md` / `lighthouserc.json`.** The proven web-only Fly single-Machine standalone template this deploy mirrors line-for-line, adapted to apex (the `apex-web` package, the `public/` GLB + AVIF runtime assets, the 512 MB image-optimization sizing, the `'wasm-unsafe-eval'` CSP line). The one-hop `outputFileTracingRoot` standalone-nesting lesson and the 256→512 MB image-optimization-OOM lesson are inherited directly.
- **ADR-001** — web-only thesis (no backend, no secrets) this posture flows from. **ADR-002 §5** — the served CSP (`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, no `'unsafe-eval'`) the deploy serves at runtime, and §3 (the deployed real-CPU run is the authoritative mobile-perf measurement). **ADR-003** — the in-memory mocked reservation flow (why there are no secrets).
- **review-6.3** — P1-3 (Windows standalone EPERM → build in Linux Docker, this ADR) and P0-1 (branded model → public-deploy precondition, this ADR).
- **`web/next.config.ts`** — `output: 'standalone'` + the one-hop `outputFileTracingRoot` (the source of the `web/.next/standalone/web/server.js` nesting) + the CSP/security-header set served at runtime. **CLAUDE.md § 3, § 4, § 11** — Next 15 hard-default stack, the performance/security baseline, Node 22 / pnpm tooling.
