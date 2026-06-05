# apex — Task List

> Derived from `PLAN.md` (the "Tasks" section is the source of truth). This is the executable checklist downstream subagents work against. Each task: size `S`/`M`/`L` + responsible subagent. Check off as completed and mirror the state into `PROGRESS.md`.
>
> Implement phase is gated on the Phase-0 ADRs (architect). Engineering kickoff (Phase 1) is gated on ADR-002 + ADR-003 acceptance.

## Phase 0 — Architecture lock-in (architect)

- [ ] **0.1** `L` `architect` — ADR-002: animation/3D posture + R3F/Next 15 integration + WebGL performance strategy + GSAP↔R3F boundary + no-Motion-by-default + strict-CSP verification. Inherit razors-edge `useGSAP()` + `gsap.matchMedia()`.
- [ ] **0.2** `M` `architect` — ADR-003: reservation-mock architecture (Zustand wizard + configurator store + `localStorage` persistence/versioned key/TTL/date-range reconciliation; pure `getRangeAvailability` + `priceQuote` over frozen `now`; insurance-tier modelling; TanStack Query mock layer; server-action submit + shared Zod + `.ics`).
- [ ] **0.3** `M` `architect` — ADR-004: hero→configurator hand-off seam + four-tier degradation contract + pre-baked render matrix (colour × wheel) + configurator accessible DOM-control model + screen-reader text alternative.

## Phase 1 — Scaffold (frontend-engineer) — gated on 0.1 + 0.2

- [x] **1.1** `S` — Next 15 + React 19 + TS strict + Tailwind v4 + shadcn scaffold (mirror razors-edge structure: umbrella `apex` + member `apex-web`, project `tsconfig.base.json` extending root base; ESLint flat + Prettier + Tailwind class-order; `next-themes` **light default**; strict CSP + security headers; `output: 'standalone'` + `outputFileTracingRoot`; unique dev port — **3090** chosen, 3080 was occupied).
- [x] **1.2** `S` — TanStack Query + Zustand + RHF/Zod bootstrap at app level (low `'use client'` boundary); trivial query round-trips a stub mock source (verified `success` headless).
- [x] **1.3** `S` — GSAP + ScrollTrigger installed + registered (apex's own `register.ts` + `useGsapEffect`, inherited pattern); smoke ScrollTrigger proving registration/cleanup/CSP-clean under `next build && next start` (0 violations).
- [x] **1.4** `M` — R3F + drei + three.js installed + a smoke Canvas (`next/dynamic ssr:false`, Suspense, trivial primitive + `OrbitControls`, capped `dpr`, `frameloop="demand"`, `detectWebglTier()` capability gate); verified code-split out of initial bundle (three.js absent from route manifest, home First Load 117 kB) + CSP-clean under `next build && next start` (live canvas mounted, 0 violations).

## Phase 2 — Design system / tokens + type (frontend-engineer)

- [x] **2.1** `M` — Sovereign tokens in `globals.css` (premium-modern/EV cool-light palette, near-black ink, EV accent, hairlines, track-line token; intentional dark "night drive" theme; type scale). NO reuse from tape/meld/razors-edge/pulse. Contrast-verified ≥ 4.5:1 both themes. Document in `AGENT_NOTES.md`.
- [x] **2.2** `S` — Type system: variable sans (+ optional display cut) via `next/font`, type scale + `font-variation-settings` hooks. Document licensing/source (OFL or clear). [Inter + Space Grotesk, OFL-1.1]

## Phase 3 — Schemas + mock data + pure domain logic (frontend-engineer)

- [x] **3.1** `M` — Zod schemas in `src/lib/schemas/` — `vehicle`, `configurator-option`, `location`, `extra` (incl. insurance tier), `vehicle-booking`, `availability`, `price-quote`, `reservation-draft`, `driver`, `testimonial`, `shop` (+ `common` primitives + barrel).
- [x] **3.2** `M` — Seeded mock data in `src/mocks/` (fixed fleet, configurator colours/wheels + pre-baked render-matrix mapping, locations, extras/insurance, seeded per-vehicle blackouts/bookings, testimonials) + frozen-`now` `src/lib/clock.ts`. faker baked to a static `seed-data.ts` at authoring time (CSP); `pnpm -F apex-web mocks:bake` re-bakes.
- [x] **3.3** `M` — Pure `getRangeAvailability` + disabled-ranges helper in `src/lib/availability.ts` (per ADR-003). Pure, deterministic, no React.
- [x] **3.4** `S` — Pure `priceQuote` in `src/lib/pricing.ts` (per ADR-003): days × daily + extras + insurance tier + one-way fee (− discount). Pure, deterministic, no React.

## Phase 4 — Chrome + hero + the configurator (the wow) (frontend-engineer)

- [ ] **4.1** `M` — App chrome: post-hero sticky header (brand, nav + mobile menu, theme toggle, "Reserve" CTA), the track-line / scroll-reveal divider component, footer shell. Mobile-first 320 px.
- [ ] **4.2** `L` — Scroll-hero (ADR-004): first-paint static AVIF product render (LCP), pinned GSAP scroll timeline introducing the car, prepared hand-off seam into the configurator. CLS-safe; LCP = static render, never the canvas.
- [x] **4.3** `L` — Live 3D configurator (ADR-002/004): R3F + drei scene (PROCEDURAL EV model — no GLB/decoder/WASM, CSP unchanged; orbit damped+bounded, `Lightformer` studio lighting, `ContactShadows`), live colour + wheel swaps reading the configurator store, accessible DOM radio-group swatch controls + the debounced `aria-live` text alternative, capped `dpr`/`frameloop="demand"`/`AdaptiveDpr`+`PerformanceMonitor`, "Reserve this configuration" CTA writing `{vehicleId, config}` into the reservation Zustand store + deep-link. Model provenance in CREDITS.md/AGENT_NOTES.
- [x] **4.4** `L` — Tier-3 pre-baked-render fallback + the hero→configurator hand-off + the four-tier degradation: re-generated the colour×wheel matrix WITH a dark-stage re-key (`matrix-dark/`); wired `detectWebglTier()` + runtime `PerformanceMonitor` demotion to swap live↔stills (Tier-3 loads NO three.js); reveal-when-ready crossfade (gated on `seam.ready`), reduced-motion crossfade (seam-progress pinned to 1, auto-orbit off), no-JS Tier-4 static frame. CSP re-verified 0 violations; tier guarantees verified.

## Phase 5 — Sections + reservation wizard (frontend-engineer)

- [x] **5.1** `M` — Fleet section + "How it works / why APEX": editorial fleet list (spec + daily price via `lib/format.ts` + track-line `Reveal`), each "Reserve this" deep-linking pre-seeded (`/reserve?vehicle=…[&color=&wheels=]`, reusing the existing store contract); the value section (4 steps + 4 value props), Linear/Vercel-register restraint.
- [x] **5.2** `L` — Gallery / brand-story: GSAP scroll-reveal sequence (masked clip-path wipe + per-frame parallax + copy slide) desktop; mobile vertical snap-scroll lazy stack; reduced-motion -> static. All `next/image` AVIF (theme-aware), art-directed `sizes`. GSAP-only (ADR-002 boundary).
- [x] **5.3** `M` — Locations + Testimonials + Footer: locations static-map treatment (generated `/maps/*` accent-pin maps, no live embed, maps click-through) + `AutoRental` JSON-LD; the testimonial/trust set; the footer credits line FILLED with 3D-model/imagery provenance. `/maps/*` 404s resolved.
- [x] **5.4** `L` — Reservation wizard shell: `/reserve` route, Zustand wizard machine (the pure `wizard-machine.ts` guards/projection EXTENDING the existing reservation store), step indicator, back/next preserving state, `localStorage` persistence (versioned key + TTL + date-range reconciliation + the `hydrated` flag, per ADR-003), deep-link pre-seeding (`/reserve?vehicle=…&color=…&wheels=…`, reusing `seedFromDeepLink`), responsive summary rail with live price (sticky bottom bar on mobile). Step transitions via GSAP (`use-step-transition.ts`, no Motion).
- [x] **5.5** `L` — Wizard steps 1–3: vehicle pick (carried-over config reflected, change-vehicle allowed), keyboard-operable date-range picker (`date-range-picker.tsx`, arrow-key roving focus, accessible disabled ranges + status) + pickup/return selectors wired to `getRangeAvailability`/`getDisabledRanges` via the TanStack Query mock layer, extras (multi-select) + insurance-tier (single-choice) step updating the live price.
- [x] **5.6** `L` — Wizard steps 4–5: driver-details form (RHF + zodResolver over the shared `driverSchema`, accessible inline validation, licence-format-only), mocked submit (`reserveVehicle` server action re-validating `reservationSubmitSchema`, deterministic confirmation + `APX-XXXX-XXXX` reference), client-side hand-rolled multi-day `.ics` over the rental range, GSAP confirmation flourish + demo-honesty copy. Draft cleared on confirm.

## Phase 6 — Polish + review

- [ ] **6.1** `M` `designer-critic` — UI milestone review vs `docs/inspirations.md`: configurator vs **Bruno Simon** + **Stripe/Vercel ship pages**; hero + gallery vs **Olivier Larose** + **Stripe**; chrome/type/restraint vs **Linear** + **Vercel** + **Klim**; reservation flow vs **Linear** micro-interactions. Concrete defect list, zero pochwał.
- [ ] **6.2** `M` `frontend-engineer` — Apply designer-critic must-fix defects + reduced-motion / no-WebGL-fallback / FOUC / focus-state polish.
- [ ] **6.3** `M` `reviewer` — Audit R3F lazy-load/code-split/capability-gate, GSAP cleanup/SSR boundaries + hand-off seam, wizard + configurator state machines, availability + price purity, shared-schema contract, CSP (three.js + GSAP), prod-bundle dev-logging strip.

## Phase 7 — Tests (test-engineer)

- [ ] **7.1** `M` — Vitest: `getRangeAvailability`, `priceQuote`, wizard + configurator state machines (guards, config carry-over, deep-link seeding, persist rehydrate + forced-stale date-range reconciliation, submit-payload projection).
- [ ] **7.2** `L` — Playwright E2E: reservation happy path (fleet/configurator entry → vehicle → range + locations → extras → details → confirmation + `.ics`), configurator DOM-swatch + Tier-3 fallback path, keyboard date-range + swatches, theme toggle both themes, `prefers-reduced-motion` hero.
- [ ] **7.3** `S` — Lighthouse CI ≥ 95 all four categories on hero + `/reserve`, on **desktop (canvas deferred)** AND **mobile (Tier-3 fallback, no live WebGL)** profiles; CWV check on hero LCP/CLS.

## Phase 8 — Docs + deploy

- [ ] **8.1** `M` `doc-writer` — `README.md`: pitch, stack, run, demo URL, screenshots + configurator GIF + reservation-flow GIF, key decisions (web-only, R3F+GSAP/no-Motion, WebGL perf strategy + Tier-3 fallback, mock honesty), 3D-model + photography provenance/credits, swap-for-real v2 path.
- [ ] **8.2** `S` `doc-writer` — `CHANGELOG.md` initialised (Keep a Changelog).
- [ ] **8.3** `M` `architect` + `frontend-engineer` — Deploy infra (ADR mirroring razors-edge ADR-005): Fly single-Machine Next standalone, web-only, no secrets, `NEXT_PUBLIC_SITE_URL` baked at build, warm floor. (Deploy executed by the main thread.)
