# Changelog

All notable changes to **razors-edge** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project README: hero wow-moment description, the honest mock-booking and not-yet-deployed notes, accurate run instructions (`pnpm install` then `cd projects/razors-edge && pnpm dev` on :3070, plus the production-build surface for E2E / Lighthouse / screenshots), the full stack, the four ADRs, the testing and Lighthouse story, and the v1-deferred list.
- `docs/screenshots/` — eleven curated PNGs captured from the production build at 1440 x 900 (deviceScaleFactor 2) and 390 x 844: the hero at rest and mid-cut (light and dark), the services price list, the pinned gallery, the team, the booking date-time availability grid and the confirmation, and the mobile hero.
- `e2e/capture-readme-screenshots.mjs` — Playwright capture script that drives the booking wizard and scrubs the pinned hero against the served production app.
- Fly.io deploy infrastructure (`Dockerfile`, `fly.toml`, `.dockerignore`, `DEPLOY.md`, ADR-005): a single Fly Machine running the Next.js 15 standalone server, region `fra`, no backend and no secrets. `NEXT_PUBLIC_SITE_URL` is baked to `https://razors-edge-demo.fly.dev` at build time.
- **Deployed to Fly.io: [razors-edge-demo.fly.dev](https://razors-edge-demo.fly.dev).** Verified live: the blade-sweep hero wow moment, the booking flow, `sitemap.xml` / `robots.txt` / the Open Graph image, CSP-clean GSAP, and zero 4xx/5xx. The Machine runs at 512 MB — a first deploy at 256 MB was OOM-killed on the first on-demand `next/image` optimization of the hero portrait (which 502'd the LCP image); the bump fixed it.

## [0.0.1] — 2026-06-03

First publishable cut. A cinematic dark-luxe barbershop marketing site with a fully mocked, production-grade multi-step booking flow, feature-complete for v1. Four ADRs ratified; designer-critic and reviewer passes landed with all defects cleared (reviewer GREEN); unit + E2E + Lighthouse CI in place. Web-only, no backend. (Deployed to Fly.io shortly after — see [Unreleased].)

### Added

**Architecture (ADR-001 to ADR-004).**

- **ADR-001** — Stack flavour `web-only` (no backend service; the only server surface is one Next.js server action for the mocked submit). Primary animation library GSAP + ScrollTrigger, with Motion permitted only as a scoped secondary for React-state component transitions. Sovereign design tokens (no reuse from tape or meld). Fully client-side mocked booking architecture. Portfolio composition: the api-heavy slots are satisfied by tape (Elysia/Bun) and meld (Hono/Node), so slot 3 is a deliberate web-only creative showcase; the NestJS api-heavy slot stays reserved.
- **ADR-002** — Animation boundary and GSAP / Next 15 App Router integration. The hard, mechanically-auditable rule: GSAP owns all scroll / pin / scrub / timeline / SVG; Motion owns only React-state component enter/exit; hover and theme crossfade are CSS. Motion `useScroll` / `useTransform` are banned. All GSAP runs through `useGSAP` (`@gsap/react`) with a low `'use client'` boundary and `gsap.matchMedia` for reduced-motion and responsive branches; transform/opacity only; CLS-safe transform pin. CSP posture: `script-src 'self' 'unsafe-inline'` (no `unsafe-eval`), `style-src 'unsafe-inline'` consciously accepted, verified under `next build && next start`.
- **ADR-003** — Booking-mock architecture. The domain model and shared Zod schemas (`src/lib/schemas/`); combos modelled as a single service with a larger `durationMin` (no special case); the pure deterministic `getAvailability` over a frozen `now`; the Zustand `persist` wizard machine (`localStorage` key `razors-edge:booking-draft`, version 1, 24-hour TTL via `savedAt`) with the explicit refresh-reconciliation rule for a stale held slot; TanStack Query over an in-memory seeded source (no network); the `bookAppointment` server action re-validating the shared schema; and a hand-rolled RFC-5545 `.ics`.
- **ADR-004** — Hero "blade-sweep" technical contract. The back-to-front layer model; the wordmark split via two real-DOM `clip-path` halves (no Club-GreenSock plugin); the portrait as the `priority` AVIF LCP element; the CLS-safe pin; and the three-tier degradation contract (full pinned scrub / reduced-motion static reveal / no-JS composed frame).

**Scaffold and foundation** (Phases 1–2).

- Next 15.5 App Router + React 19.2 + TypeScript strict + Tailwind v4 (CSS-first) + shadcn/ui new-york primitives over a sovereign token bridge, dev/prod pinned to port 3070. next-themes with dark default. TanStack Query + Zustand + react-hook-form + Zod providers at a low `'use client'` boundary. GSAP + ScrollTrigger registered through a single module and verified CSP-clean.
- Sovereign design tokens in `app/globals.css`: the brass-on-near-black dark palette and an intentional bone/ivory "editorial print" light theme (OKLCH), all key contrast pairs verified to WCAG AA in both themes.
- Type system: Fraunces (variable display serif) for the wordmark and headers, Inter (variable sans) for body and UI, both via `next/font` (self-hosted, CSP-clean) and both SIL OFL 1.1.
- Shared Zod schemas (service, barber, availability, contact, booking draft / submission / confirmation, testimonial, shop); seeded faker mock data (11 services including 3 combos, 5 barbers with distinct specialties and schedules, 46 pre-bookings, 8 testimonials, shop info) baked to static output so faker is build-time only; a frozen clock at `2026-06-10 11:00 Europe/Warsaw`.
- The pure `getAvailability` generator: a 15-minute grid over working hours minus days off, lunch, and pre-bookings; half-open intervals; disabled slots emitted with accessible reasons rather than hidden; combos handled by passing a larger duration.

**Chrome and the hero** (Phase 3).

- App chrome: a sticky header that is transparent over the hero and gains a legible backdrop on scroll, anchor nav with `aria-current`, a theme toggle, a primary CTA, and a mobile sheet drawer; a single grain/noise overlay; the recurring blade-sweep section divider; and the brand footer.
- The cinematic blade-sweep hero: the pinned, scrubbed GSAP timeline (sweep, cut, part and reveal, hand-off), the two `clip-path` wordmark halves, the inline-SVG straight razor with a tracking brass edge-glow, the portrait LCP with art-directed desktop and mobile crops, and the three-tier degradation.
- Real cinematic photography (Unsplash License) sourced same-origin and graded through one cohesive dark-luxe `sharp` pass; provenance and the swap-for-real path in `web/public/images/CREDITS.md`.

**Homepage sections and the booking wizard** (Phase 4).

- Editorial sections: positioning, the 11-service menu with brass edge-reveal hovers and per-service deep-links, the desktop GSAP pinned horizontal-scroll gallery (vertical snap stack on mobile), the five-barber team grid, editorial testimonials with accessible ratings, an opening-hours table with today highlighted via the frozen clock, a CSP-clean inline-SVG map with a maps click-through, and the full brand footer.
- The `/book` booking wizard (the centerpiece): the five-step machine over the persisted Zustand store, Motion `AnimatePresence` step transitions (reduced-motion gated — the one place Motion earns its bundle), the keyboard-navigable availability grid, the react-hook-form + Zod details form, the server-action submit, the deterministic booking reference, the hand-rolled `.ics` download, deep-link preselect, and the `localStorage` persistence with 24-hour TTL and stale-slot reconciliation.

**Polish, review, accessibility, SEO, and performance** (Phases 5–7).

- Cleared the designer-critic's 18-defect ledger across two passes: the hero seam reworked to be structurally incapable of glyph corruption, the razor redrawn as an unmistakable open straight razor, the barber photography unified to one grade, the confirmation seal and testimonial ticks built from one shared brass edge primitive, the availability grid mobile reflow, the visit map redrawn with real intent, the global brass focus ring, and the mobile wizard sticky bar carrying the primary action.
- Fixed the three real defects the E2E suite surfaced: the Zod eval-probe escaping `jitless` on the landing path (now configured globally and early, so zero CSP violations on any route), the radiogroups made fully keyboard-operable (WAI-ARIA roving tabindex), and focus-on-advance moved to the step heading's own mount effect.
- SEO: `sitemap.ts`, `robots.ts`, the `next/og` Open Graph image, the `HairSalon` / `LocalBusiness` JSON-LD built from the live menu and shop data, and per-route canonical / OG / Twitter metadata. Canonical origin via `NEXT_PUBLIC_SITE_URL` with a documented placeholder.
- Performance: a perf pass on the home route (GSAP deferral, a static home route, code-splitting, and a JS trim) lifting desktop Performance to ~94 with green Core Web Vitals (LCP ~1.3 s, CLS ~0.01, TBT ~100 ms); `/book` CLS fixed from 0.294 to 0.055 and its Performance at 94 to 98.

**Tests and CI** (Phase 6).

- 53 Vitest unit tests: the pure `getAvailability` generator, the wizard state machine (step guards, deep-link seeding, any-barber resolution, the forced-stale reconciliation, the submit-payload projection), the `.ics` builder, and the security headers.
- 18 Playwright E2E tests across 9 specs (`razors-edge-e2e` workspace), run against the built and served production app on :3070: landing SSR/CSP smoke, the booking happy path to confirmation with the `.ics` download, deep-link preselect, form validation, the availability grid, full keyboard operation, the reduced-motion hero, the theme toggle under the strict CSP, and the stale-slot reconciliation — a `@smoke` subset for deploy verification.
- Lighthouse CI (`lighthouserc.json` + workflow) asserting the success criteria (>= 0.95 in all four categories plus LCP < 2.5 s / CLS < 0.1) on `/` and `/book`, and the `razors-edge-e2e` CI workflow, both against the production build.

### Not shipped in v1 (deferred)

- **Any real backend, database, or persistence.** The booking is mocked end to end; a reload starts fresh. Wiring a real booking API (the reserved NestJS api-heavy slot) is the explicit v2 path.
- **Real authentication, accounts, payments, or email / SMS confirmations.** None in v1; the confirmation is on-screen plus an `.ics` download only.
- **A live interactive map embed** — v1 uses a styled inline-SVG map plus a maps click-through; a lazy live embed is a v2 candidate.
- **Multi-barber combos** — a combo is one service with a longer duration and cannot split across two barbers in v1.
- **CMS-managed content and internationalisation** — seeded mock data, English only.
- **Deploy** — not part of the v1 build itself, but the site was deployed to Fly.io immediately after (see [Unreleased]): [razors-edge-demo.fly.dev](https://razors-edge-demo.fly.dev).

---

[Unreleased]: https://github.com/AntczakJ/portfolio/compare/razors-edge-v0.0.1...HEAD
[0.0.1]: https://github.com/AntczakJ/portfolio/releases/tag/razors-edge-v0.0.1
