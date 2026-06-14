# Changelog

All notable changes to **nocturne** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Deferred designer-critic mediums (D-05/07/09/10/11/12 — real-GPU look judgement / art-direction) and the v2 path: a real CC0 track option, recording/export, MIDI input, and `PerformanceMonitor`-to-`ultra` (1M) promotion tuning against the deployed profile.

## [0.1.1] — 2026-06-14

### Deploy

- **Deployed to Fly.io: [nocturne-demo.fly.dev](https://nocturne-demo.fly.dev)** (single Machine, Next.js standalone, region `fra`, web-only, no secrets, scale-to-zero — the atrium/apex pattern; ADR-005). Deploy surface added: `Dockerfile` (three-stage; standalone built inside the Linux image to dodge the Windows symlink-EPERM; no `web/public` copy), `fly.toml` (single HTTP service :3000, health check `/`, shared-cpu-1x/512MB, `min_machines_running = 0`), `.dockerignore`, `DEPLOY.md`. The app is `nocturne-demo` (the demo-suffix naming of the web-only siblings); `NEXT_PUBLIC_SITE_URL=https://nocturne-demo.fly.dev` baked at build. Verified live: `/` 200 with the exact eval-free CSP (no `unsafe-eval`; `media-src`/`worker-src 'self' blob:`), `/about` 200, `/opengraph-image` 200 image/png, robots/sitemap reference the canonical origin. The GPU field + Web Audio run client-side in the visitor's browser; the CPU-only Fly Machine just serves the bundle.

### Deferred (v2 path)

- **A real CC0 / royalty-free track option** alongside the procedural synth default.
- **Recording / export** — capture the canvas to a video, GIF, or image sequence in-app.
- **MIDI / external control** via Web MIDI.
- **`PerformanceMonitor` adapt-up-to-`ultra` tuning** — the runtime headroom rule that promotes a capable desktop toward the ~1M `ultra` tier, tuned against the deployed profile (boot default stays the conservative `high` ≈ 262k).
- **Deferred designer-critic mediums** (none AA-blocking; flagged for a later art-direction or real-GPU pass): D-05 (HUD hairline dividers may vanish over a bright field — decorative only), D-07 (animate the Sora variable-font weight axis on a signature moment), D-09 (arm into a less-Codrops-generic default preset), D-10 (re-render the OG image with the tagline clear of the glow core), D-11 (vary the `/about` heading rhythm), D-12 (an idle shimmer cue on the begin button).

## [0.1.0] - 2026-06-14

The v1 build: a web-only, GPU-accelerated, audio-reactive generative particle experience. Built, reviewed (reviewer APPROVE-WITH-NITS, 0 blockers; designer-critic § 14 no-sibling-re-skin gate vs `apex` PASS), must-fix tier applied, and tested.

### Added

- **The GPGPU engine.** A field of ~262k particles (the default desktop tier) advected through an animated curl-noise flow field, computed entirely on the GPU via `GPUComputationRenderer` FBO ping-pong — two half-float variables (position + velocity), divergence-free curl-noise advection in custom GLSL, in-shader respawn on the age channel, and the index→texel-UV `reference` attribute built once at init. Zero per-particle CPU work per frame: the load-bearing 60 fps invariant. Rendered as `THREE.Points` additive soft sprites colored through the preset palette ramp.
- **The audio reactivity pipeline.** Three sources (a procedurally synthesized built-in track, microphone input, and local file upload) into one shared `AnalyserNode` behind a master `GainNode`. Pure `reduceBands` (FFT bins → sub-bass / bass / mid / high / RMS) and `applyEnvelope` (attack/release smoothing so the field breathes, not strobes), mapped onto the engine uniforms (bass → turbulence/flow, mid → spread, high → color/sparkle, RMS → bloom/vignette). An idle floor keeps the field drifting under silence. Leak-free teardown (one `AudioContext`, mic tracks stopped, object URLs revoked).
- **The autoplay gesture gate.** The cinematic intro doubles as the audio gate — a real keyboard-operable `<button>` that resumes the `AudioContext`, starts the track, and arms the field. No autoplay ever, including under reduced-motion.
- **Six curated presets.** Glacial Drift, Molten Swirl, Aurora, Nocturne Noir, Solar Wind, Ink Bloom — each a complete typed look (palette ramp, flow, particle treatment, post mix, audio gains), validated by Zod at module load. Switching cross-fades the entire uniform set on an eased curve.
- **The minimal cinematic HUD.** An auto-dimming overlay (wordmark, preset picker, audio-source picker, motion-mode and pointer toggles, mute, theme, about) that recedes on inactivity and returns on pointer/focus — opacity-only, so it never leaves the tab order or the a11y tree.
- **Cinematic post-processing.** An `EffectComposer` with bloom (audio-pulsed), vignette, and a subtle chromatic aberration, tiered by post quality.
- **Four-tier degradation.** Full cinema / reduced-capability (smaller count + DPR + post) / reduced-motion calm-drift (audio muted, bloom pulsing off, an accessible "Still" toggle) / no-WebGL + no-JS (a designed luminous-field poster + the six-preset directory as real server-rendered DOM). The poster→live reveal-when-ready hand-off: the poster is the LCP, the live canvas cross-fades in on first-frame-ready, no empty-canvas flash, no CLS.
- **Sovereign dark-cinematic design system.** OKLCH tokens built from scratch, with theme-invariant stage tokens (the always-dark canvas, scrim, over-stage ink) versus theme-variant chrome tokens (`/about`, light + dark). Dark is canonical; light is a chrome-only reading mode. Sora + Outfit (both SIL OFL 1.1) via `next/font`. No token reuse from any sibling (§ 14).
- **The `/about` route.** The technique in plain language, the preset directory, the credits (the procedurally synthesized audio note, the fonts, the MIT libraries), and the accessibility statement, with `CreativeWork` JSON-LD.
- **SEO surface.** Per-route metadata, a designed `next/og` Open Graph image, `Person` + `WebSite` + `CreativeWork` JSON-LD, `sitemap.xml`, and `robots.txt`.
- **Accessibility.** The canvas is `aria-hidden` decorative with a real-DOM `aria-live` text alternative (current preset + audio source); every HUD control is real keyboard-operable DOM; WCAG 2.2 AA chrome contrast in both themes.
- **Strict, eval-free CSP** — no `unsafe-eval`, no `wasm-unsafe-eval`, no WASM at all (tighter than `apex`); one delta over a non-audio site, `media-src 'self' blob:`. Zod JIT opted out (`jitless`).
- **Tests.** 123 Vitest unit tests (the pure audio reduction + envelope, the cross-fade interpolation, the routing/reduced-motion decisions, the easing, the seed/palette/poster builders, the auto-dim and describe-state logic) and 29 Playwright E2E tests (the gate, the keyboard HUD + ARIA radiogroup, the theme with the stage staying dark, the reduced-motion path, the four-tier degradation floor, mute, a11y, SEO, 320 px). Lighthouse CI on `/about` (100 / 100 / 96 / 100).

### Fixed (must-fix tier, before tag)

- **H1 (reviewer HIGH)** — Mute now mutes the audible output. The audio graph was re-routed so the master gain is the single node between the sources and both outputs (`gain → analyser` and `gain → destination`), so muting silences sound and drops the analyser feed (the field falls to idle drift). The mic is the lone exception (it taps the analyser directly to avoid echoing the room).
- **D-01 (designer-critic HIGH)** — The chrome now respects `prefers-color-scheme` on first load (`defaultTheme="system"`, which had been overridden by a hardcoded `dark`). Follow-on: over-stage ink made theme-invariant so the HUD and intro stay legible on the always-dark stage in light chrome.
- **D-02 (designer-critic HIGH)** — The intro wordmark uses a viewport-bounded clamp and tighter tracking (no longer clips at 320/390 px), and the positioning tagline sits on a strong scrim so it is legible over peak bloom.
- **D-03 (designer-critic HIGH)** — The preset cross-fade is eased (sampled through `easeOutExpo`) and trimmed to 1.1 s, so the signature transition reads decisive rather than linear.
- **D-04 (designer-critic HIGH)** — A strong scrim on the bottom HUD bar so chrome text holds AA contrast over the field's brightest bloom; the bar is capped on ultra-wide.
- **Nits** — zero per-frame allocation in the field `useFrame`; seeded synth detune; preset-relative pointer wake scale; trimmed initial `freqData` allocation.

[Unreleased]: https://github.com/AntczakJ/portfolio/tree/main/projects/nocturne
[0.1.0]: https://github.com/AntczakJ/portfolio/tree/main/projects/nocturne
