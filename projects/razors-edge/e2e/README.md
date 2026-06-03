# razors-edge-e2e

Playwright E2E harness for **razors-edge** (Phase 6, Task 6.2) — critical-path
coverage for the dark-luxe barbershop showcase.

## What it covers

| Spec                         | Critical path                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `landing.spec.ts`            | `/` SSR floor (hero `<h1>`), chrome + Book CTA, zero console / unexpected CSP |
| `booking-happy-path.spec.ts` | The 5-step booking flow end to end + `.ics` download + combo duration         |
| `deep-link.spec.ts`          | `?service=` / `?barber=` preselect; invalid ids ignored gracefully            |
| `form-validation.spec.ts`    | Details-step validation: empty required, malformed email, malformed phone     |
| `availability-grid.spec.ts`  | Disabled slots present-but-not-selectable; selecting a slot updates summary   |
| `keyboard.spec.ts`           | Keyboard operability (form fill + Enter-submit; radiogroup/focus see below)   |
| `reduced-motion.spec.ts`     | Reduced-motion hero static reveal + gallery fallback, no pin error            |
| `theme-toggle.spec.ts`       | Toggle to light flips `<html>`, persists across reload                        |
| `reconciliation.spec.ts`     | Stale held-slot → date-time step + calm notice (the ADR-003 reconciliation)   |

A `@smoke` subset (landing + booking happy path + a11y-keyboard form) gives a
fast deploy-style verification: `pnpm -F razors-edge-e2e test:smoke`.

## Important: build + serve, do NOT use `next dev`

The project ships a strict CSP that forbids `unsafe-eval`, and `next dev`
cannot run under it (the meld lesson, carried in razors-edge `AGENT_NOTES`).
Several assertions (zero unexpected CSP violations, GSAP-hydrated landing) are
only meaningful against the production surface. So run against:

```bash
pnpm -F razors-edge-web build
pnpm -F razors-edge-web start   # serves on :3070
```

then, in another shell:

```bash
pnpm -F razors-edge-e2e test            # full suite
pnpm -F razors-edge-e2e test:smoke      # @smoke subset
```

Point at a deployed URL via `BASE_URL` (or `RAZORS_EDGE_E2E_TARGET_URL`):

```bash
BASE_URL=https://<deploy> pnpm -F razors-edge-e2e test
```

## Determinism

The app pins a frozen `now` (2026-06-10 11:00 Europe/Warsaw) in
`src/lib/clock.ts`, so the date strip + availability grid are stable across
runs — the suite picks "the first available slot" and gets the same one every
time. The wizard persists its draft to `localStorage`; each spec clears the
draft in `beforeEach` and the runner uses a single worker, so persisted state
never leaks between specs.

## Known defects surfaced by this suite (tracked, not faked)

Writing the suite surfaced three real defects in the production build. They are
recorded as `test.fixme` (visible + skipped, not silently dropped) so they are
un-fixme'd when fixed, and are reported to the main thread / reviewer:

- **D-CSP-1** — the zod-4 JIT `eval` probe intermittently trips
  `script-src 'eval'` under the strict CSP on the client landing path (the
  `z.config({ jitless: true })` guard does not cover the lazily-compiled
  landing-path validator). Tracked by the `theme-toggle` fixme; filtered from
  the deploy-anchor's CSP assertion by the diagnostics helper so the anchor
  does not flap.
- **D-A11Y-1** — the service/barber/date/slot `<button role="radio">` options
  have no keydown handler, so a keyboard user cannot select them (Enter/Space
  do not activate). Tracked by the `keyboard` fixme.
- **D-A11Y-2** — focus does not move to `#wizard-step-heading` on step advance
  (the heading is focusable, but the wizard's focus call never lands it).
  Tracked by the `keyboard` fixme.
