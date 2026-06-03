# razors-edge — PLAN

> Cinematic dark-luxe marketing site for an upscale barbershop, with a fully mocked but delightful multi-step booking flow.
> Brand display: **Razor's Edge**. Repo dir: `razors-edge`.

## Problem

Upscale grooming studios sell an experience — atmosphere, craft, a barber you trust — but their websites almost universally undersell it: stock templates, a Calendly embed, a gallery of low-light phone photos, and a "Book Now" button that dumps you into a generic third-party scheduler with none of the brand's character. There is a gap between the in-chair experience an upscale barbershop delivers and the digital first impression it makes. For this portfolio, `razors-edge` closes that gap as a **web-only creative / marketing showcase**: a cinematic, scroll-driven dark-luxe site where every section — and especially the booking flow — is built to the same level of craft as the haircut. It is the portfolio's proof that the author can carry a single arresting art direction across a complete marketing site and a multi-step interactive flow without a backend.

## Audience

Dual audience, and the design must serve both in the same five seconds:

1. **The recruiter / peer judging craft (primary for portfolio value).** Lands on the deployed demo URL from a portfolio index, a shared link, or an Awwwards-style roundup. Desktop monitor (1440 px+ typical, 1920 px common), good GPU, may open DevTools out of habit. Decides in 5–10 seconds whether this is "another barbershop template" or "someone who can art-direct and choreograph motion". The hero wow moment must land before they read a word of copy, and the booking flow must feel like a real, considered product when they click through it.
2. **The plausible real client of an upscale barbershop (primary for the fiction's credibility).** A man, 25–45, deciding whether to book. Arrives on mobile as often as desktop (a grooming studio's real traffic skews mobile — Instagram bio link, Google Maps, a friend's text). Wants: to see the work (gallery), understand what a service costs and how long it takes, pick a barber, and book a slot without friction. On a phone, at 320–430 px, one-handed, possibly on cellular. This audience is why the booking flow has to feel real even though nothing persists, and why mobile is a first-class target, not a desktop afterthought.

The art direction is tuned for audience 1; the information architecture and the booking flow are tuned for audience 2. Neither is sacrificed for the other.

## Wow moment

**A scroll-driven cinematic hero where the brand wordmark "RAZOR'S EDGE" is sliced by a sweeping straight-razor blade as the viewer scrolls, the two halves of the type parting and parallaxing against a near-black, grain-textured backdrop while a single brass-amber edge of light tracks the blade — and on scroll-out the hero photograph (a high-contrast portrait of a finished cut) is revealed through the parting type as if the blade cut the title open to show the work beneath.**

Concretely, on first paint and through the first viewport of scroll:

- First paint (zero scroll): near-black charcoal field, heavy film grain, the wordmark **RAZOR'S EDGE** set in a confident editorial display face, centered, with a single thin brass-amber highlight running along the baseline like the lit edge of a honed blade. A barely-perceptible idle shimmer travels the highlight every ~6 s (respects `prefers-reduced-motion` — shimmer disabled, static highlight retained). One line of supporting copy and a quiet downward chevron invite the scroll.
- As the viewer scrolls the first viewport, a GSAP `ScrollTrigger` timeline pins the hero and scrubs: a straight-razor (SVG with a brushed-metal gradient and a sharp specular edge) sweeps diagonally across the wordmark. The instant the blade's edge crosses the type, the wordmark splits along the cut line into an upper and lower half that drift apart and parallax at different rates, and the lit brass edge tracks precisely with the blade's leading point.
- Through the parting type, the hero portrait — a high-contrast, cinematic photograph of a finished cut / a barber mid-craft — is revealed in the gap, scaling up subtly (a slow Ken-Burns push) as the halves separate. The grain stays consistent across type and photo so the composite reads as one cinematic frame, not two layers.
- The timeline resolves into the first content section (the studio's one-line positioning statement) so the scroll never "stalls" on a finished animation — the cut _is_ the transition into the site.

This is the spine of the design, not a decoration: the "cut / blade / edge" motif (the brass edge-of-light, the slice transition, the grain) recurs as the connective tissue between sections (section dividers are blade-sweeps; the gallery transitions echo the slice; the booking confirmation lands with a final clean "edge" flourish). Reference points from `docs/inspirations.md`: **Olivier Larose** (scroll-driven storytelling + photographic art direction is the closest analogue to what this hero attempts), **Stripe** (long-form scrolling pages where a custom scroll element justifies its bundle cost, and type as a primary design element), **Aristide Benoist** (kinetic transitions / generative-feeling typography for the wordmark treatment), and **Klim Type Foundry** (display type used at its best — the wordmark must hold up as a specimen, not just as a logo). The designer-critic judges the hero against Olivier Larose and Stripe specifically.

A defined fallback is part of the spec, not an afterthought: under `prefers-reduced-motion`, the blade does not sweep — the hero cross-fades from wordmark to portrait on scroll with no pinning and no parallax, and the brass highlight is static. Under a no-JS / failed-hydration condition, the hero renders as a static composed frame (wordmark over portrait with the brass edge) that is still on-brand and legible. The wow is additive over a floor that always works.

## Stack flavour

**`web-only`.**

This is an explicit, owner-confirmed decision, and it is correct against `docs/conventions.md` § 10. None of the five api-heavy triggers fires:

- **No WebSocket / SSE.** There is no long-lived bidirectional channel. The booking flow is a client-side wizard over seeded mock data; nothing streams.
- **No background jobs / queue / cron.** There is no server-side scheduled work. "Availability" is computed deterministically from seeded mock data at request/render time on the client.
- **API not consumed by a non-Next client.** There is no public API. The only consumer of any data is this Next.js app itself.
- **No heavy auth flow.** There is no auth at all in v1. No accounts, no sessions, no tokens. The booking flow collects contact details into client state and shows a confirmation — it does not authenticate anyone.
- **No heavy domain logic worth isolating from the UI.** The "domain logic" here is availability-slot generation and booking-wizard state transitions. Both are small, pure, deterministic, and live perfectly well in `src/lib/` tested with Vitest — they do not benefit from a separate backend service. The booking submission is mocked: a Next.js route handler (or server action) that validates with the shared Zod schema, waits a realistic beat, and returns a deterministic confirmation. That is the entire server surface.

`api-heavy` is rejected because forcing a backend here would be ceremony, not need — exactly the "deviate only when the project genuinely requires it" bar from CLAUDE.md § 3. The portfolio composition is explicitly not harmed by this call: see DECISIONS.md ADR-001 and the note below.

**Portfolio-composition note (planner enforcement, `docs/conventions.md` § 12).** The api-heavy slots are healthy: slot 1 `tape` (Elysia / Bun) and slot 2 `meld` (Hono / Node) already satisfy "at least two distinct backend frameworks" and put the portfolio at 2 of the required 2–3 api-heavy projects. `razors-edge` takes slot 3 as a deliberate **web-only creative / marketing showcase**, demonstrating range (motion + art direction) that the two systems-heavy projects do not. This does **not** push the portfolio out of compliance: with 3 projects, the 2 api-heavy projects keep the ratio in spec, and the constraint is evaluated at the five-project mark. The open **NestJS api-heavy slot stays open** for a later project (the planned slot-4 AI agentic tool), and this was the owner's deliberate call — recorded so the next planning pass does not mistake it for drift. If the brief _after_ this one is also web-only, the planner must flag it and recommend an api-heavy / NestJS brief to keep the five-project constraint reachable.

## Animation stack — GSAP (ScrollTrigger + timeline)

**Selected: GSAP 3.x with the ScrollTrigger plugin as the single primary animation library**, per `docs/conventions.md` § 15 and CLAUDE.md § 5 (one library, do not stack three).

Justification against the § 15 decision criteria:

- The wow moment is a **scroll-driven, pinned, scrubbed timeline** with several independently-animated elements (blade SVG, two wordmark halves at different parallax rates, the brass edge tracking the blade's leading point, the photo Ken-Burns push, grain continuity) choreographed against a single scroll progress. This is the textbook case where "Motion's declarative model fights you" (§ 15) — coordinating a pinned scrub with per-element offset easing and a precise hand-off into the next section is exactly what ScrollTrigger exists for. Motion's `useScroll` can drive single-value scroll springs, but the multi-element pinned timeline with mid-timeline state changes (the type _splitting_ at the blade-crossing instant) is far cleaner in a GSAP timeline.
- The recurring "blade-sweep" section dividers, the horizontal/parallax gallery presentation, and the SVG razor specular animation all benefit from GSAP's timeline + SVG strengths (§ 15: "SVG path animation, complex choreography with many independently animated elements").
- The grain-textured, photo-forward, cinematic surface does **not** need WebGL — R3F is explicitly rejected (§ 15: R3F is "not for fancy 2D backgrounds — those should be CSS or Motion"; here the grain is a CSS/SVG noise layer and the parallax is 2D transforms). Keeping it off the GPU-3D path protects the Lighthouse ≥ 95 performance budget on mid-tier mobile.

**Motion is permitted only as a scoped secondary for small component-state transitions** where GSAP would be overkill — specifically: the booking-wizard step transitions (enter/exit of each step panel), shadcn primitive mount/unmount (dialogs, popovers), the theme-toggle crossfade, and hover micro-interactions on service / barber cards. This is a deliberate, justified two-library posture, not "stacking three" — and it is bounded: **no scroll-driven animation may be authored in Motion; no React-state component transition may be authored in GSAP.** That boundary keeps the libraries from overlapping and is ratified in DECISIONS.md (ADR-002, authored by the architect at implement kickoff, ratifying or tightening this split). If during implementation the wizard transitions turn out to be expressible cleanly with CSS + GSAP and Motion earns its bundle nowhere else, the frontend-engineer should raise dropping Motion entirely in `AGENT_NOTES.md` for the architect to decide — single-library is the preferred end state if it is achievable without fighting the tooling.

GSAP licensing note: GSAP 3 core + ScrollTrigger are free under the standard "no-charge" license for this use. No Club-GreenSock-only plugins (SplitText, MorphSVG) are assumed in v1 — the wordmark split is achieved by pre-splitting the wordmark into two masked halves at build time (or a hand-rolled split), not by SplitText. If a Club plugin would materially improve the hero, the frontend-engineer raises it in `AGENT_NOTES.md` and the architect decides via ADR; v1 assumes free GSAP only.

## Design direction

Sovereign visual identity — **no token reuse from tape or meld** (`docs/conventions.md` § 14). Built from scratch in `app/globals.css`.

- **Aesthetic: modern dark / luxe.** Near-black and charcoal fields, a single warm metallic accent (brass / amber — one accent hue, used with restraint as the "lit edge" motif), cinematic high-contrast photography, generous negative space, atmosphere over information density. Premium and arresting — explicitly **not** "clean and safe minimal".
- **Dark is the canonical theme and the default.** Per CLAUDE.md § 4 the site still ships light + dark via CSS variables + `next-themes`, with dark as the default and respecting `prefers-color-scheme`. The light theme is **intentional, not an inversion**: a warm bone/ivory paper field, charcoal ink, the same brass accent shifted to hold contrast on light — a "daytime barbershop / editorial print" register, designed deliberately so a recruiter toggling the theme sees craft in both, not a broken dark-site-with-the-colors-flipped.
- **Type:** a sharp, confident sans for UI and body (variable font preferred so weight can be animated subtly on the wordmark and headings — references the `font-variation-settings` note in `docs/inspirations.md`), plus an optional editorial display face for the wordmark and section headers. Type is a primary design element (Stripe / Klim references), not just labels on boxes.
- **Texture:** consistent film-grain / noise layer across hero and section backgrounds (CSS or a tiled SVG noise, NOT WebGL), tuned to stay invisible to the Lighthouse performance budget. The grain is what makes the composite of type-over-photo read as one cinematic frame.
- **Photography:** all imagery is `next/image` with AVIF, art-directed (`<picture>` / `sizes`) for the cinematic crops. Mock photography is sourced as placeholders (documented, royalty-clear) and the README notes the swap-for-real path.

The designer-critic reviews every UI milestone against `docs/inspirations.md` with zero pochwał — see Phase 5.

## Site sections / IA

Single long-form scrolling marketing page (with the booking flow as a routed, focused sub-experience), in this order. The hero is the wow; the booking flow is the centerpiece interaction.

1. **Cinematic hero** — the wow moment above. Brand wordmark, the blade-slice scroll transition revealing the hero portrait, one-line positioning, scroll affordance, and a persistent quiet "Book" call-to-action that becomes a sticky header element after the hero.
2. **Positioning / intro** — one short, confident statement of what Razor's Edge is (the studio's voice). Minimal copy, maximal atmosphere. A blade-sweep divider introduces it out of the hero.
3. **Services + pricing** — cuts, beard, shave, combos. Elegant cards or an editorial list (decided at design-system phase): each service shows name, short description, duration, and price, with a tasteful hover state (a brass edge-reveal echoing the motif). Each service is selectable as the entry point into the booking flow ("Book this").
4. **Gallery** — the major photographic surface. A scroll-driven / interactive presentation of cuts, shop interior, and atmosphere shots. Candidate treatment: a horizontal-scroll parallax strip on desktop (GSAP ScrollTrigger pinned horizontal scroll) that collapses to a vertical, snap-scrolling, lazy-loaded stack on mobile. Slice-transition reveals echo the hero motif. This is a primary design surface for a dark-luxe shop and must hold up next to Olivier Larose's photographic art direction.
5. **The team / barbers** — individual barber cards: portrait, name, specialty (e.g., "skin fades & beard sculpting"), a one-line bio, and an availability hint. Each card feeds the booking flow ("Book with {name}"), pre-selecting that barber in the wizard. Hover/active states use the brass-edge motif.
6. **Booking flow (mocked centerpiece)** — see the dedicated spec below. Routed as a focused sub-experience (`/book`), enterable pre-seeded from a service card or a barber card or from a plain "Book" CTA.
7. **Testimonials / reviews** — a curated set of client quotes with name + (mock) rating, presented with editorial restraint (not a star-rating dump). Possibly a subtle auto-advancing or scroll-tied marquee, motif-consistent.
8. **Hours, location, contact** — opening hours table, a map treatment (a styled static map / dark-themed map tile image with a brass location pin and the address; NOT a heavyweight live embed that would tank the performance budget — a click-through to maps is the interaction), phone, email, and the studio address.
9. **Footer** — strong brand presence: the wordmark, social links (icons from `lucide-react`), a compact repeat of hours + a final "Book" CTA, legal/credits line. The footer is a designed surface, not a sitemap dump.

A persistent, accessible header appears after the hero: brand mark (left), anchor nav to the sections (center, collapses to a menu on mobile), theme toggle, and a primary "Book" button (right) that routes into the booking flow.

## Booking flow — mocked, but the centerpiece interaction

A polished multi-step wizard, entirely client-side against seeded deterministic mock data. It must feel real and delightful even though nothing persists. State in **Zustand** (the wizard machine); each step's form in **react-hook-form + Zod**; mock data fetched through **TanStack Query** against a thin mock data layer (so the data-fetching ergonomics are real even though the source is local — loading states, query keys, and a deliberate small artificial latency make the flow feel like it talks to a server). Validation schemas live in `src/lib/schemas/` and are the contract shared by the form steps and the mocked submit handler.

Steps:

1. **Pick a service.** Grid/list of services (cuts, beard, shave, combos) with duration + price. Pre-selected if the user entered from a service card. Multi-service combos allowed if the design supports it; v1 may scope to single-service to keep the availability model clean (decided at design phase — see Out of scope).
2. **Pick a barber.** Barber cards filtered to those who perform the chosen service (mock data encodes each barber's service specialties). "Any available barber" is an option. Pre-selected if entered from a barber card.
3. **Pick date & time.** A date strip (next ~14 days) and, for the chosen date + service duration + barber, an **availability grid** of time slots. Availability is generated deterministically from seeded mock data (each barber has mock working hours, mock days off, and mock pre-booked slots) so the grid is stable across reloads and reproducible for tests and screenshots. Unavailable slots are visibly disabled with accessible labelling; the slot duration reflects the chosen service's length.
4. **Your details.** Name, phone, email, optional notes — react-hook-form + Zod, inline accessible validation (labels + `aria-describedby` error wiring per `docs/conventions.md` § 5). A summary rail shows the running selection (service, barber, date/time, price).
5. **Confirmation.** A mocked submit: the shared Zod schema validates, a thin route handler / server action returns a deterministic confirmation object (a booking reference, the full summary, an "add to calendar" `.ics` download generated client-side, and an on-brand confirmation flourish that lands with a final "clean edge" motif beat). Nothing persists server-side; a reload starts fresh. The confirmation copy makes the mock nature graceful ("This is a demo booking — no appointment was actually scheduled") without breaking the luxe tone.

Cross-cutting wizard requirements: a visible step indicator; back/next navigation that preserves entered data (Zustand); deep-linkable entry (`/book?service=…&barber=…`) that pre-seeds the wizard; full keyboard operability of the slot grid and step controls; `prefers-reduced-motion`-respecting step transitions (Motion, with a CSS/no-motion fallback); and a mobile-first layout where the summary rail collapses into a sticky bottom bar at small widths.

## Mock data shape

All under `src/mocks/`, faker-driven, `faker.seed(<n>)` at the top of each factory module for determinism (`docs/conventions.md` § 6). Domain-coupled, never shared. Indicative shapes (final fields fixed when the Zod schemas are authored in Phase 2):

- **`Service`** — `{ id, slug, name, category: 'cut' | 'beard' | 'shave' | 'combo', description, durationMin, priceCents, currency, popular?: boolean }`. A fixed, hand-curated set (not random) so pricing reads as a real menu; faker fills only flavor copy.
- **`Barber`** — `{ id, slug, name, title, bio, specialties: ServiceCategory[], portraitSrc, workingHours: WeeklySchedule, daysOff: ISODate[] }`. Small fixed roster (e.g., 4–6 barbers) with stable portraits.
- **`WeeklySchedule`** — per-weekday `{ open: 'HH:mm', close: 'HH:mm' } | null` (null = closed). Drives slot generation.
- **`Booking` (mock pre-bookings)** — `{ id, barberId, date: ISODate, startMin, durationMin }`, a seeded set per barber so the availability grid has realistic gaps. Deterministic from the seed.
- **`AvailabilityQuery` / `AvailabilitySlot`** — derived, not stored: a pure function `getAvailability({ barberId, serviceId, date })` composes working hours − days off − pre-bookings − service duration into an array of `{ startMin, available: boolean }`. Pure, deterministic, unit-tested in isolation (this is the one piece of "domain logic" and it lives in `src/lib/` with Vitest coverage).
- **`Testimonial`** — `{ id, author, rating, quote, service?: string }`, seeded set.
- **`BookingDraft`** (wizard state, not mock data) — the Zustand store shape: `{ serviceId?, barberId?, date?, startMin?, contact?: { name, phone, email, notes? }, step }`. The submit payload is a Zod-validated projection of this.

The "current date" for availability is pinned to a deterministic reference (seeded relative to a fixed `now`, or frozen in a `src/lib/clock.ts` the tests and the UI share) so screenshots and Playwright runs are reproducible and the "next 14 days" never drifts.

## Success criteria

All measurable; all gate v1 ship.

- **Lighthouse ≥ 95** in **all four** categories (Performance, Accessibility, Best Practices, SEO) on the deployed demo, including the hero page (the scroll/animation work must not cost the performance budget) and the `/book` flow. Measured via Lighthouse CI, median of 5 runs.
- **Core Web Vitals green** on the hero: LCP < 2.5 s (the hero portrait is the LCP element — it must be `priority` AVIF, correctly sized), CLS < 0.1 (the pinned hero must not shift layout — pin via transform, reserve space), INP < 200 ms (scroll handlers throttled to rAF via GSAP, no long tasks during the scrub).
- **Wow moment quality bar.** The hero blade-slice scrub runs at a smooth 60 fps on a mid-tier laptop (no dropped frames during the pinned scrub, verified in DevTools performance trace) and degrades correctly under `prefers-reduced-motion` (crossfade, no pin) and no-JS (static composed frame). Designer-critic signs off against Olivier Larose + Stripe with zero pochwał.
- **Booking flow completes** end to end: enter from a service card → barber → date/time from the availability grid → details → confirmation with a booking reference and a working client-side `.ics` download, in under 90 seconds of unhurried interaction, fully keyboard-operable, with deterministic availability across reloads.
- **Responsive from 320 px upward.** Every section and the entire booking flow are usable and on-brand at 320 px, tested up through 430 px mobile, tablet, and desktop. The horizontal gallery collapses to a vertical stack on mobile; the wizard summary rail collapses to a sticky bottom bar.
- **Theming.** Light + dark via CSS variables + `next-themes`, dark default, `prefers-color-scheme` respected, no FOUC on theme. The light theme is an intentional editorial register, reviewed in its own right.
- **Accessibility — WCAG 2.2 AA.** Full keyboard navigation across nav, gallery, service/barber selection, and the entire booking wizard (the slot grid is a proper keyboard-navigable widget with `aria` state for disabled slots). Contrast ≥ 4.5:1 in both themes (the brass-on-near-black accent is verified, not assumed). `prefers-reduced-motion` honored at every animated site. Visible focus states styled to the brand, never removed. The hero conveys its content to screen readers regardless of the animation (the wordmark and the portrait alt text are real DOM, not canvas).
- **SEO.** Per-page meta + Open Graph, a designed OG image, `LocalBusiness` (specifically `HairSalon`) JSON-LD with address / hours / price range, `sitemap.xml`, `robots.txt`. This is a local-business site — the structured data is part of the fiction's credibility and a real differentiator vs a template.
- **Security baseline.** CSP headers configured (and verified compatible with GSAP — no `unsafe-eval` reliance; if a CSP/animation conflict arises it is resolved in favor of strict CSP, mirroring the meld lesson). Input sanitization on the booking form. No secrets; `.env.example` committed if any env is introduced (none expected in v1). No real PII is collected or stored — the form is mocked and the README says so.
- **Tests.** Vitest unit coverage on the availability generator and the wizard state machine (the two pieces of real logic); Playwright E2E on the booking happy path and on `prefers-reduced-motion` hero behavior; Lighthouse CI in the pipeline.

## Tasks

Ordered, granular, each sized `S` / `M` / `L` with the responsible subagent. The implement phase starts after the architect ratifies ADR-002 (animation-library split + GSAP-with-Next-App-Router integration posture) and ADR-003 (booking-mock architecture: client-side wizard state + seeded deterministic availability + the mocked submit surface).

### Phase 0 — Architecture lock-in

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Size | Subagent  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- |
| 0.1 | Author ADR-002: animation posture — ratify (or tighten/collapse) the GSAP-primary + Motion-scoped split, AND the GSAP-with-Next-15-App-Router integration pattern (where GSAP registers, the `'use client'` boundary for ScrollTrigger, SSR-safe pinning, cleanup on route change, and the no-`unsafe-eval` CSP compatibility check). Decide whether Motion earns its bundle or the project goes single-library.                                                                      | M    | architect |
| 0.2 | Author ADR-003: booking-mock architecture — Zustand wizard store shape + persistence boundary (in-memory only vs `sessionStorage` for back/forward survival), the deterministic availability model (frozen `now`, seeded pre-bookings, the pure `getAvailability` contract), the TanStack Query mock-fetch layer (query keys, artificial latency, where the mock source lives), and the mocked submit surface (route handler vs server action, shared Zod schema, `.ics` generation). | M    | architect |
| 0.3 | Author ADR-004: hero technical contract — the exact layer model (DOM type halves vs photo vs grain vs blade SVG), how the wordmark split is achieved without a Club GSAP plugin, the LCP element strategy (portrait `priority` AVIF), the CLS-safe pinning approach, and the three-tier degradation contract (full scrub / reduced-motion crossfade / no-JS static frame).                                                                                                            | M    | architect |

### Phase 1 — Scaffold

| #   | Task                                                                                                                                                                                                                                                                                                                                                              | Size | Subagent          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 1.1 | Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui scaffold under `projects/razors-edge/`. Package name `razors-edge`. Extends root `tsconfig.base.json`. ESLint flat + Prettier + Tailwind class-order plugin. `next-themes` provider with `attribute="class"` (or `data-theme`), dark default. `GET`-free static-first app shell. | S    | frontend-engineer |
| 1.2 | TanStack Query provider + Zustand store bootstrap + react-hook-form/Zod wiring at the app level (providers in a `'use client'` boundary kept as low as possible per `docs/conventions.md` § 3). Verify a trivial query round-trips against a stub mock source.                                                                                                    | S    | frontend-engineer |
| 1.3 | GSAP + ScrollTrigger installed and registered per ADR-002, behind an SSR-safe client boundary, with a smoke ScrollTrigger (a throwaway pinned section) proving registration, cleanup-on-unmount, and CSP compatibility (no `unsafe-eval`). Removed before Phase 3.                                                                                                | S    | frontend-engineer |

### Phase 2 — Design system / tokens + schemas + mock data

| #   | Task                                                                                                                                                                                                                                                                                                                                                             | Size | Subagent          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 2.1 | Sovereign design tokens in `app/globals.css` — the dark-luxe palette (near-black/charcoal scale, single brass/amber accent, surfaces, borders), the intentional light "editorial print" theme, spacing/radius, type scale. NO token reuse from tape or meld (`docs/conventions.md` § 14). Contrast-verified ≥ 4.5:1 both themes. Documented in `AGENT_NOTES.md`. | M    | frontend-engineer |
| 2.2 | Type system — load the chosen variable sans (+ optional editorial display face) via `next/font`, set up the type scale and the `font-variation-settings` hooks for animated weight on the wordmark/headings. Document licensing/source of the faces.                                                                                                             | S    | frontend-engineer |
| 2.3 | Zod schemas in `src/lib/schemas/` — `service`, `barber`, `booking-draft`, `availability`, `contact`, `testimonial`. These are the contracts shared by the wizard forms and the mocked submit handler.                                                                                                                                                            | M    | frontend-engineer |
| 2.4 | Mock data in `src/mocks/` — seeded faker factories for services (fixed menu), barbers (fixed roster + portraits), weekly schedules, seeded pre-bookings, testimonials; plus the frozen-`now` clock in `src/lib/clock.ts`. Deterministic across reloads.                                                                                                          | M    | frontend-engineer |
| 2.5 | The pure availability generator `getAvailability` in `src/lib/` per ADR-003 — composes working hours − days off − pre-bookings − service duration into the slot array. Pure, deterministic, no React. (Unit tests land in Phase 6.)                                                                                                                              | M    | frontend-engineer |

### Phase 3 — Chrome + hero (the wow)

| #   | Task                                                                                                                                                                                                                                                                                     | Size | Subagent          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 3.1 | App chrome — the post-hero sticky header (brand mark, anchor nav with mobile menu, theme toggle, primary "Book" CTA), the grain/noise texture layer, and the reusable "blade-sweep" section-divider component. Mobile-first from 320 px.                                                 | M    | frontend-engineer |
| 3.2 | The cinematic hero wow moment per ADR-004 — first-paint composed frame, the pinned GSAP ScrollTrigger scrub (blade sweep → wordmark split → portrait reveal → Ken-Burns → hand-off), brass-edge tracking, grain continuity, 60 fps target. LCP = portrait `priority` AVIF; CLS-safe pin. | L    | frontend-engineer |
| 3.3 | Hero degradation — `prefers-reduced-motion` crossfade (no pin/parallax, static highlight) and the no-JS / failed-hydration static composed frame. Both are on-brand and legible.                                                                                                         | M    | frontend-engineer |

### Phase 4 — Sections + booking wizard

| #   | Task                                                                                                                                                                                                                                                                                           | Size | Subagent          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 4.1 | Positioning/intro section + services & pricing section (cards or editorial list per the design phase), each service "Book this" deep-links into the wizard pre-seeded. Brass-edge hover motif.                                                                                                 | M    | frontend-engineer |
| 4.2 | Gallery — desktop GSAP pinned horizontal-scroll parallax strip with slice-transition reveals; mobile vertical snap-scroll lazy-loaded stack. All `next/image` AVIF, art-directed crops.                                                                                                        | L    | frontend-engineer |
| 4.3 | Team / barbers section — barber cards (portrait, name, specialty, bio, availability hint), "Book with {name}" deep-links pre-seeding the wizard barber.                                                                                                                                        | M    | frontend-engineer |
| 4.4 | Testimonials + Hours/Location/Contact + Footer — testimonial set (editorial, not star-dump), hours table, static-map treatment with brass pin + maps click-through, contact, and the designed brand footer with social icons (`lucide-react`).                                                 | M    | frontend-engineer |
| 4.5 | Booking wizard shell — the `/book` route, the Zustand wizard machine, the step indicator, back/next preserving state, deep-link pre-seeding (`/book?service=…&barber=…`), and the responsive summary rail (sticky bottom bar on mobile). Motion step transitions with reduced-motion fallback. | L    | frontend-engineer |
| 4.6 | Wizard steps 1–3 — service pick, barber pick (filtered by specialty + "any available"), and the date strip + keyboard-navigable availability grid wired to `getAvailability` via TanStack Query (with artificial latency + loading states).                                                    | L    | frontend-engineer |
| 4.7 | Wizard steps 4–5 — details form (react-hook-form + Zod, accessible inline validation), the mocked submit surface (shared Zod schema, deterministic confirmation + booking reference), client-side `.ics` generation, and the on-brand confirmation flourish with the "clean edge" motif beat.  | L    | frontend-engineer |

### Phase 5 — Polish + review

| #   | Task                                                                                                                                                                                                                                                                                                                             | Size | Subagent          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 5.1 | UI milestone review against `docs/inspirations.md` — designer-critic judges the hero against **Olivier Larose** + **Stripe**, the gallery against **Olivier Larose**, the chrome/type against **Linear** + **Klim**, and the booking flow polish against **Linear**'s micro-interaction bar. Concrete defect list, zero pochwał. | M    | designer-critic   |
| 5.2 | Apply the designer-critic defect list (must-fix tier) + the reduced-motion / FOUC / focus-state polish pass.                                                                                                                                                                                                                     | M    | frontend-engineer |
| 5.3 | Code review — `reviewer` audits the GSAP cleanup/SSR boundaries, the wizard state machine, the availability purity, the shared-schema contract, CSP compatibility, and the prod-bundle strip of any dev-only logging.                                                                                                            | M    | reviewer          |

### Phase 6 — Tests

| #   | Task                                                                                                                                                                                                                                                           | Size | Subagent      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| 6.1 | Vitest unit suite — `getAvailability` (working hours, days off, pre-booking gaps, service-duration slot sizing, frozen-`now` determinism) and the Zustand wizard machine (step transitions, data preservation, deep-link seeding, submit-payload projection).  | M    | test-engineer |
| 6.2 | Playwright E2E — booking happy path (enter from a service card → barber → date/time → details → confirmation + `.ics`), full keyboard operation of the slot grid, theme toggle in both themes, and the `prefers-reduced-motion` hero path (crossfade, no pin). | L    | test-engineer |
| 6.3 | Lighthouse CI workflow asserting ≥ 95 across all four categories on the hero and `/book`, plus a CWV check on the hero LCP/CLS.                                                                                                                                | S    | test-engineer |

### Phase 7 — Docs

| #   | Task                                                                                                                                                                                                                                                                         | Size | Subagent   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 7.1 | `README.md` — pitch, stack, run instructions, demo URL, screenshots + a GIF of the hero blade-slice wow moment and the booking flow, key decisions (web-only rationale, GSAP choice, mocked-booking honesty), and the "swap mock photography / wire a real backend" v2 path. | M    | doc-writer |
| 7.2 | `CHANGELOG.md` initialised (Keep a Changelog).                                                                                                                                                                                                                               | S    | doc-writer |

## Out of scope (v1)

Locked. v2 candidates only.

- **Any real backend, database, or persistence.** The booking is mocked end to end; a reload starts fresh. (This is the whole web-only thesis — see DECISIONS.md ADR-001.) A "wire a real booking API (NestJS slot)" path is noted in the README as v2.
- **Real authentication / accounts / "my bookings" history.** No auth in v1.
- **Real payments / deposits.** The price is displayed; nothing is charged.
- **Real email / SMS confirmations.** The confirmation is on-screen + a client-side `.ics` download only; the copy says so gracefully.
- **A live, interactive map embed** (Google Maps JS, Mapbox GL). v1 uses a styled static-map treatment + maps click-through to protect the performance budget. A live embed is a v2 candidate behind a lazy boundary.
- **CMS-managed content.** Services, barbers, and testimonials are seeded mock data, not editable through an admin.
- **Multi-service combo bookings in one wizard pass**, if the design phase finds it complicates the availability model — v1 may ship single-service-per-booking and note combos as v2. The architect decides in ADR-003.
- **Club-GreenSock-only GSAP plugins** (SplitText, MorphSVG). v1 assumes free GSAP core + ScrollTrigger only; a Club plugin requires its own ADR.
- **Internationalisation / multi-language.** English only (per CLAUDE.md § 2 file-language rule and v1 scope).
- **Online gift-card purchase, loyalty program, blog/editorial content.** Brand-plausible future surfaces, not v1.
