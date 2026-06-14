# nocturne — Task List

> Derived from `PLAN.md` by the `planner` (2026-06-14). Ordered, sized (`S`/`M`/`L`), each with its responsible subagent. Status: `todo` until an agent picks it up. Phase 1+ starts only after Phase 0 ADRs are accepted.

## Phase 0 — Architecture lock-in (`architect`)

- [ ] **0.1 (L, architect)** ADR-002: GPGPU architecture (FBO ping-pong mechanism, position/velocity texture encoding `RGBA16F`/float + fallback, curl-noise advection + lifetime/re-spawn, render particle system, per-frame uniform contract) + R3F/Next 15 integration (`next/dynamic ssr:false` + Suspense + `<Loader>` + low `'use client'`, capped `dpr`, visibility-pause) + the WebGL2/float-render-target capability gate → Tier-4 routing + the performance **tier table** (sim FBO size N × resolution scale × post quality) + `PerformanceMonitor`/`AdaptiveDpr` adaptation + strict-CSP-runs-three.js-clean verification.
- [ ] **0.2 (M, architect)** ADR-003: the Web Audio pipeline (three sources → one shared `AnalyserNode`), the autoplay-policy gesture-gate contract, the FFT size + pure band-reduction contract (bins → sub-bass/bass/mid/high + smoothed RMS, attack/decay), mic-permission consent + graceful denial, the upload privacy boundary (object URL), the `media-src`/`connect-src` CSP allowances, and the CC0 built-in-track provenance.
- [ ] **0.3 (M, architect)** ADR-004: reduced-motion behaviour (calm drift vs still + the exact muting of reactivity/bloom/wake) + the four-tier degradation contract + the poster-frame + per-preset-still generation + the static-poster→live-canvas reveal seam (LCP never the canvas, no CLS) + the canvas `aria-hidden` decorative + text-alternative model + the chrome-theme/stage-stays-dark decision.

## Phase 1 — Scaffold (`frontend-engineer`)

- [ ] **1.1 (S)** Next 15 + React 19 + TS strict + Tailwind v4 + shadcn/ui scaffold under `projects/nocturne/` (mirror apex's structural scaffold; `next-themes` **dark default**; full security headers + strict CSP; `output: 'standalone'`). **Dev port 3100.**
- [ ] **1.2 (S)** App-level providers — Zustand store (preset + audio-source + HUD state) + `next-themes` in a low `'use client'` boundary. (No TanStack Query — no async data; recorded.)
- [ ] **1.3 (M)** R3F + drei + three.js + @react-three/postprocessing + a **smoke Canvas** (`next/dynamic ssr:false`, Suspense, trivial primitive + minimal bloom, capped `dpr`, the WebGL2/float capability gate stubbed → placeholder poster); verify code-split + CSP-clean under `next build && next start`.

## Phase 2 — Design system / tokens + type (`frontend-engineer`)

- [ ] **2.1 (M)** Sovereign dark-cinematic tokens in `app/globals.css` (near-black grounds, cool near-white/grey chrome ink, scrim/translucency for HUD legibility, hairlines, focus-ring) + the light **chrome** theme (non-canvas only; stage stays dark). **NO sibling token reuse (§ 14).** Contrast ≥ 4.5:1 both themes. Documented in `AGENT_NOTES.md`.
- [ ] **2.2 (S)** Type system — the variable display/technical sans (NOCTURNE wordmark + preset/source labels) via `next/font` + the scale + `font-variation-settings` hooks; document OFL/clear-license provenance.

## Phase 3 — Schemas + presets + pure logic (`frontend-engineer`)

- [ ] **3.1 (S)** Zod schemas in `src/lib/schemas/` — `preset` (palette/flow/particle/post params), `audio-source`, `audio-bands`, `hud-state`.
- [ ] **3.2 (M)** The curated preset definitions (`src/lib/presets/`) — a handful of dramatically-distinct typed `Preset`s (e.g. glacial-drift, molten-swirl, nebula, ink-in-water) + the directory copy (one line each).
- [ ] **3.3 (M)** The pure **audio band-reduction** in `src/lib/` — bins → { subBass, bass, mid, high, rms } with attack/decay smoothing. Pure, no React / no Web Audio singletons. (Tests in 7.1.)
- [ ] **3.4 (M)** The pure **preset cross-fade / interpolation** helper + the reduced-motion branch selector + the capability-gate routing decision as pure functions in `src/lib/`. (Tests in 7.1.)

## Phase 4 — The engine, the wow (`frontend-engineer`)

- [ ] **4.1 (L)** The GPGPU simulation — FBO ping-pong (position + velocity textures), the **curl-noise advection** sim fragment shader (custom GLSL), lifetime/re-spawn, uniform plumbing. Prove **100k+ particles at 60 fps** at the default tier before audio/post.
- [ ] **4.2 (L)** The render particle system + custom render GLSL (soft additive sprites / instanced quads, color from audio-mapped energy through the preset palette, optional velocity trails) + the **pointer/touch attractor-repeller** wake uniform.
- [ ] **4.3 (M)** Cinematic post — `@react-three/postprocessing` `EffectComposer` (**bloom + vignette + subtle chromatic aberration**), per-preset tuned + audio-energy modulated; the CLS-safe fullscreen canvas + the **poster→live-field reveal** seam (LCP = poster).
- [ ] **4.4 (L)** The **audio pipeline** — the Web Audio graph, the autoplay **gesture gate** (resume context + start built-in track), the shared `AnalyserNode` + band-reduction wired into the uniforms (bass→turbulence/energy, mid→motion, high→color/sparkle, RMS→bloom), and **source switching** (built-in / mic-with-permission / upload). The field breathes with the music.

## Phase 5 — Minimal HUD + presets + about/credits + degradation (`frontend-engineer`)

- [ ] **5.1 (L)** The minimal cinematic HUD — wordmark, **preset picker** (keyboard-operable), **audio-source picker** (built-in/mic/upload + play/mute + level/spectrum + mic-permission/upload UX), small **controls** (intensity/calm + pointer-interaction toggles), the **auto-dimming** behaviour (never keyboard-unreachable), and the chrome **theme toggle**. Mobile-first thumb-reachable from 320 px.
- [ ] **5.2 (M)** The preset **cross-fade** wiring in the engine — switching lerps the whole uniform set so the field morphs from one identity to another (judged vs Linear's micro-interaction bar in 6.1).
- [ ] **5.3 (M)** The `/about` + credits surface — what nocturne is, the technique in plain language, the **preset directory** (labelled stills + one line each), **credits** (CC0 track, fonts, libraries), the **accessibility statement**, links to the experience + `atrium`.
- [ ] **5.4 (L)** The **four-tier degradation** — generate the **poster frame** + per-preset directory stills from the live engine; wire the capability gate + device-tier heuristic + `PerformanceMonitor` adaptation; the **reduced-motion** branch (calm/still, reactivity muted, no audio-violent motion, no autoplay); the **no-WebGL/no-JS** Tier-4 (poster + directory + wordmark as real DOM); the canvas `aria-hidden` + text alternative.

## Phase 6 — Polish + review

- [ ] **6.1 (M, designer-critic)** UI milestone review vs `docs/inspirations.md` (field/post vs Bruno Simon + Codrops/Awwwards SOTD; HUD/restraint vs Linear + Vercel + Stripe; type vs Klim + Linear; cross-fade timing vs Linear). **Run the § 14 no-sibling-re-skin gate explicitly vs apex.** Concrete defect list, zero pochwał.
- [ ] **6.2 (M, frontend-engineer)** Apply the designer-critic must-fix defects + the reduced-motion / no-WebGL-fallback / FOUC / focus-state / auto-dim-keyboard-reachability polish pass.
- [ ] **6.3 (M, reviewer)** Code review — confirm **zero per-particle CPU work** (the 60 fps claim), FBO ping-pong correctness, the R3F lazy-load + code-split + capability gate, Web Audio graph cleanup (context resume/close, node disconnect, no leaks on source switch/unmount), band-reduction + cross-fade purity, the shared-schema contract, CSP compatibility (three.js + post + Web Audio + any worker/wasm/blob), prod-bundle dev-logging strip.

## Phase 7 — Tests (`test-engineer`)

- [ ] **7.1 (M)** Vitest — the pure band-reduction (silence/clipping/empty-bin edge cases, attack/decay determinism), the preset cross-fade/interpolation (lerp, switching, 0/1 endpoints), the reduced-motion branch selector + capability-gate routing, the preset/audio-source/hud state machine.
- [ ] **7.2 (L)** Playwright — the no-GPU chrome critical paths: intro/gesture-gate → HUD reveal, preset picker (keyboard + pointer + look-label change), audio-source picker (built-in start, mic-permission-mock, upload-accept), `/about` + directory, theme toggle (stage stays dark), the `prefers-reduced-motion` path (calm/still, **no audio-violent motion / no autoplay**), the **no-WebGL fallback** (poster + directory as DOM).
- [ ] **7.3 (S)** Lighthouse CI ≥ 95 across all four categories on the **non-canvas surfaces** (`/about` + the poster-frame fallback state) + a CWV check on `/` first paint (poster LCP / CLS). The canvas route's 60 fps + tier table are documented (measured), not Lighthouse-asserted — stated honestly.

## Phase 8 — Docs + deploy

- [ ] **8.1 (M, doc-writer)** `README.md` — pitch, stack, run, demo URL, screenshots + a **field-breathing-with-music GIF** + a preset-cross-fade GIF, key decisions (web-only, R3F single-family/no-GSAP/no-Motion, GPGPU + tier table + no-WebGL fallback, Web Audio + autoplay-gesture), the **CC0 audio + font provenance/credits**, the accessibility statement, the "more presets / recording-export / MIDI" v2 path.
- [ ] **8.2 (S, doc-writer)** `CHANGELOG.md` initialised (Keep a Changelog).
- [ ] **8.3 (M, architect + frontend-engineer)** Deploy infra (ADR-005) — Fly.io single-Machine Next standalone, web-only, no secrets, `NEXT_PUBLIC_SITE_URL` baked at build, warm floor, the bundled CC0 track within the CSP `media-src`. (Deploy executed by the main thread.)
