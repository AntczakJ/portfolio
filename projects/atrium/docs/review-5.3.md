# atrium - Phase 5.3 code review (reviewer)

Date: 2026-06-09. Gate before tests (Phase 6) / docs (Phase 7) / commit.
Scope: the uncommitted projects/atrium/ working tree (the whole project is untracked).

## Verdict: approve

Implementation matches what PROGRESS.md claims is done. All seven PLAN Task 5.3 audit
targets pass. No blockers. A small set of should-fix / nit items, none gating this review
(the SEO surface is owed by a later, explicitly scheduled phase).

Local checks, all run and green:

- pnpm -F atrium-web lint -- no warnings or errors.
- pnpm -F atrium-web typecheck (tsc --noEmit) -- clean.
- pnpm -F atrium-web build -- succeeds; 4/4 static pages prerender; home First Load JS 149 kB
  with GSAP code-split OFF the 103 kB shared baseline. Only output is the documented Windows-
  only EPERM standalone-symlink warning (AGENT_NOTES 1.1 - not a code defect; resolves on CI).
- Test suite (vitest run) NOT run -- no specs authored yet; that is Phase 6, out of this gate.

## Audit-target findings

### 1. GSAP boundaries - PASS

- register.ts: memoised loadGsap() dynamic-imports gsap + gsap/ScrollTrigger + @gsap/react,
  registerPlugin once; no static GSAP re-export, so GSAP stays code-split off the initial
  bundle (the 149/103 kB split). ScrollTrigger never enters a Server Component.
- use-gsap-effect.ts: post-paint useEffect, setup inside gsap.context(..., scope.current);
  cleanup calls context.revert() on unmount/dep-change plus cancelled guard + cancelIdleCallback.
  Scoped cleanup actually reverts. SSR-safe.
- refresh-coordinator.ts: requestGlobalRefresh() debounces to ONE rAF; runRefresh() calls
  ScrollTrigger.sort() BEFORE ScrollTrigger.refresh() - load-bearing for the 7 pins. No section
  refreshes in isolation. Listeners attach once, browser-only.
- Hero is idle:true; bays use the non-idle variant. Both are the only client leaves in their
  spine; content is server DOM passed as children. Transform/opacity/clip-path only; will-change
  set narrowly and cleared on onLeave/onLeaveBack.

### 2. The single GITHUB_BASE seam - PASS

- github.com appears in source ONLY as the one GITHUB_PLACEHOLDER constant in site-config.ts
  (plus doc-comments). Zero inline hardcoded repo URLs in any component (grep-verified).
- Every repoUrl derives from repoUrlFor(slug) = GITHUB_BASE + /tree/main/projects/<slug>.
- U2 affordance (directory/repo-affordance.tsx, mirrored in footer + about): while
  REPO_LINKS_LIVE is false the repo control is a non-navigating span aria-disabled (no href,
  not tab-stopped, sr-only explanation); demo is always a live anchor. Flips to a live anchor
  on the single boolean. Correct.

### 3. The Zod-validated data module - PASS

- schemas/project.ts: z.config jitless:true is at the TOP of the module (runs before the schema
  is constructed and before projects.ts calls .parse()), so the client-reachable parse uses the
  interpreted (no-eval) validator. The build prerendering the page confirms it parses.
- Client-reachability is real and correctly mitigated: site-nav.ts imports projects.ts and is
  imported by the client site-header.tsx + mobile-nav.tsx. The jitless fix is the right and
  necessary fix - the ADR-002 no-client-Zod assumption was wrong and is superseded. No OTHER
  client-runtime Zod parse exists.
- Schema is strict + superRefine (backend agrees with category; accentToken equals --bay-slug);
  projectsSchema enforces length 6 + canonical order. PROJECTS is parsed at module load - a
  malformed entry fails the build.

### 4. Outward links - PASS

- Every external link is a real focusable anchor target=\_blank rel=noopener-noreferrer with a
  disambiguated accessible name: demo aria-label "name - live demo", live repo
  "name - GitHub repository"; profile "name on GitHub".
- mailto: links (header, footer, about) are correctly plain anchors without target/rel.
- The disabled repo control is intentionally NOT a focusable link (must not be a tab-stop on a
  dead control).

### 5. CSP / security headers - PASS

- next.config.ts ships the exact ADR-002 string: default-src self; script-src self unsafe-inline;
  style-src self unsafe-inline; img-src self data: blob:; font-src self; connect-src self;
  frame-ancestors none; base-uri self; form-action self. NO unsafe-eval. Full set present: HSTS,
  nosniff, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options DENY, over /(.\*).
- Nothing in the code requires eval: GSAP is eval-clean and the one client Zod path is forced
  jitless. The two unsafe-inline grants are the documented accepted relaxation; nonce-hardening
  is recorded v1.1 debt - not a 5.3 blocker.

### 6. Prod-bundle hygiene - PASS

- No console.\* / debugger anywhere in src or the configs (grep-verified).
- The Phase-3 smoke (src/components/smoke/) and the Phase-4 bays-placeholder.tsx are both
  deleted - confirmed absent on disk and from the file listing. No SMOKE / TODO / FIXME /
  phase4-placeholder markers remain in src.

### 7. General - PASS

- TS strict honesty: zero any / as any / ts-ignore / ts-expect-error / ts-nocheck /
  eslint-disable in src. The one scoped react-hooks/exhaustive-deps exception lives in
  eslint.config.mjs (the documented razors-edge precedent for use-gsap-effect.ts).
- A11y of interactive chrome: header nav is a real nav with anchors + correct aria-current;
  mobile drawer is Radix Dialog (focus trap, Esc, scroll-lock, focus restore); theme toggle is a
  real button with a mount-guarded aria-label; skip-link present; decorative layers aria-hidden.
  Focus ring is global and untouched.
- CLS-safe transform pinning: pins reserve footprint via pin-spacers; only transform/opacity/
  clip-path animate (descent CLS 0.012-0.019 in Phase 5.2). Hero sentinel is h-0, zero CLS.
- English-only, no emojis (codepoint scan clean). .env.example committed, no .env.

## Should-fix (before merge to main / before deploy - not a 5.3 blocker)

- SEO surface is still entirely absent (site-config.ts and AGENT_NOTES both flag it as owed). No
  app/sitemap.ts, no app/robots.ts, no opengraph-image, no JSON-LD (Person + ItemList/WebSite) -
  grep for application/ld+json returns nothing. PLAN success criteria list all of these as ship-
  gating, and SEO matters most on the front page. Explicitly deferred out of Phases 3/4/5 to a
  later phase before deploy; flagged so it is not lost. Must land before the Lighthouse-SEO
  criterion can pass. Route: a frontend/SEO pass before Phase 6 Lighthouse CI or commit-to-main.

## Nits (defer if cheap)

- site-config.ts: GITHUB_BASE strips a trailing slash from the env value but REPO_LINKS_LIVE
  compares against the un-normalized GITHUB_PLACEHOLDER. Harmless today, but a trailing-slash
  placeholder env value would read as live. Normalize the placeholder through the same replace
  for symmetry. Cosmetic.
- bays-sequence.tsx: the setup callback returns a cleanup function (removes data-bay-armed),
  which gsap.context() honours, but useGsapEffect setup param is typed => void, so the cleanup
  contract is not in the type. Optional: widen to => void | (() => void). Correct as-is.
- layout.tsx light themeColor is the old bone value; the real light bg token shifted - cosmetic,
  already flagged for the metadata phase that owns it.

## Matches PROGRESS.md?

Yes. PROGRESS claims Phases 1-5.2 done: scaffold, GSAP integration, tokens + six re-spaced hues,
data module, chrome, hero descent, six pinned bays (PIN_BAYS = true), directory, about, the 5.2
must-fix rebuild (CSS-3D colonnade, continuous descent, daylight light theme, bay light-fields,
demoted wow-card, heavier title). All present, all transform/opacity/clip-path only, no Motion,
no new deps, no client-runtime Zod beyond the jitless-forced parse. Build/lint/typecheck
independently re-verified green.

## Next subagent

No fix routing required for the gate (approve). Before deploy, route the SEO should-fix to a
frontend-engineer SEO pass (sitemap/robots/OG/JSON-LD), then test-engineer for Phase 6.
