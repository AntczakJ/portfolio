# Changelog

All notable changes to **nocturne** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (post-deploy — the Still-toggle off-centre / scroll regression)

- **Toggling motion-mode to "Still" on a capable device no longer breaks centering or makes the page scrollable.** On a real-GPU device, switching to **Still** a few times made the page scroll and the wordmark drift off-centre (the title screen reappearing in normal flow). The Stage drove the `data-armed` attribute and the page-overflow lock off the RESOLVED route, and "Still" resolves to the `poster` route — conflating the Still-motion still (an immersive fullscreen stage, frozen to the poster) with the genuine no-WebGL/software capability floor (where the scrollable preset directory is the readable surface). The Stage now keys those off a new `isCapabilityFloor` check (the device's actual capability, not the resolved route): live, calm, AND Still on a capable device all stay scroll-locked with the directory hidden and the HUD present, while only a genuine capability floor unlocks scroll and reveals the directory. Still now freezes to a VISIBLE poster still (not a blank stage), the intro gate does not re-appear (Still leaves the armed state intact), and toggling back to Full re-reveals the live field via the poster bridge. The genuine Tier-4 no-WebGL / software-renderer floor (the scrollable directory + the hardware-acceleration hint) and the reduced-motion calm default are unchanged.

### Fixed (post-deploy — software-WebGL fallback + a per-frame palette sink)

- **Software-renderer detection (the 0% GPU / 100% CPU report).** A visitor running with a SOFTWARE WebGL backend (SwiftShader / llvmpipe / Mesa softpipe / Microsoft Basic Render / ANGLE-over-SwiftShader) was running the full 262k-particle GPGPU simulation + bloom on the CPU, because a software backend PASSES the WebGL2 + `EXT_color_buffer_float` gates. The capability probe (`detectGpuTier`) gained a **software gate** after the float gate: it reads the unmasked renderer string (`WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`) and probes a `failIfMajorPerformanceCaveat: true` context; a known software renderer string, or a caveat-only context, routes to the **poster** — the same outcome as the float gate, so the heavy field never runs on the CPU. A `posterReason` discriminator (`no-window` / `no-webgl2` / `no-float` / `software-webgl`) is now carried on the tier config so the UI can distinguish a fixable misconfiguration from a capability floor. Behavior-preserving for real-GPU visitors (they keep the full field).
- **The "enable hardware acceleration" hint.** When (and only when) the poster is engaged because of `software-webgl`, the stage shows a dismissible, accessible note (`role="status"`, keyboard-reachable dismiss, AA-contrast over-stage ink, no layout shift) explaining that hardware-accelerated WebGL appears to be off, that the live field needs it, and how to turn it on (browser settings / `chrome://gpu`, then reload). The ordinary no-WebGL / no-JS poster (a capability floor) shows no hint.
- **A per-frame palette CPU sink.** The palette ramp texture was rebuilt with a fresh `new Uint8Array(width*4)` allocation and re-uploaded (`needsUpdate = true`) on EVERY frame, even when no cross-fade was active. The ramp is now written into the texture's existing buffer in place (a new allocation-free `writePaletteData`), and the rebuild + GPU upload happen ONLY on frames where the ramp actually changed (during a transition). This restores the zero-allocation hot-path invariant and removes a needless per-frame GPU upload on idle frames. Visually identical.

### Polished (finish-off pass — the deferred designer-critic mediums/lows closed)

- **D-05** — The HUD control-group dividers are now derived from the scrim layer (a faint near-white line over the always-dark `--stage-scrim-strong` panel via a new `--hud-divider` token) instead of a translucent dark hairline floating over the field, so the bottom-bar grouping stays legible at peak bloom (when the old `--hud-hairline` vanished into a bright field).
- **D-07** — The Sora variable-font weight axis is now animated on two signature moments (CSS `font-variation-settings` only, no per-frame JS): the intro wordmark eases its `wght` in over the reveal (300 → 640), and the active preset label gains weight (500 → 720) as the cross-fade settles, tying chrome weight to the eased field morph. Both are motion-safe — under `prefers-reduced-motion` the elements land on their final weight, never mid-animation.
- **D-08 (top bar)** — The HUD top bar is now capped to the same `max-w` as the bottom bar and centred, so the wordmark and chrome stay a compact instrument on ultra-wide (2560 px) instead of drifting into far corners.
- **D-09** — The arm-in default preset is now **Ink Bloom** (the only alpha-blend look — soft indigo/violet, tied to nocturne's identity) instead of the Codrops-generic Aurora; all six presets remain. The poster, store, and OG card follow the new default.
- **D-10** — The OG card tagline now sits on its own dark scrim band dropped below the glow core (mirroring the D-02 intro scrim) instead of running through the centre of the bloom, so the share card reads cleanly; the card motif now matches the new default look.
- **D-11** — The `/about` section headings now chunk via the Linear long-form pattern: a per-section accent eyebrow (`01 / Method` …), a hairline rule across the top of each section, and a heading weight/size jump (text-2xl/medium → text-3xl/semibold). AA contrast holds in both chrome themes.
- **D-12** — The begin button now carries a faint motion-safe breathing accent ring (a slow idle "about to happen" shimmer, CSS keyframes on a `::before` pseudo-element); nothing animates under `prefers-reduced-motion`.

### Deferred (v2 path)

- The v2 path: a real CC0 track option, recording/export, MIDI input, and `PerformanceMonitor`-to-`ultra` (1M) promotion tuning against the deployed profile.

## [0.1.1] — 2026-06-14

### Deploy

- **Deployed to Fly.io: [nocturne-demo.fly.dev](https://nocturne-demo.fly.dev)** (single Machine, Next.js standalone, region `fra`, web-only, no secrets, scale-to-zero — the atrium/apex pattern; ADR-005). Deploy surface added: `Dockerfile` (three-stage; standalone built inside the Linux image to dodge the Windows symlink-EPERM; no `web/public` copy), `fly.toml` (single HTTP service :3000, health check `/`, shared-cpu-1x/512MB, `min_machines_running = 0`), `.dockerignore`, `DEPLOY.md`. The app is `nocturne-demo` (the demo-suffix naming of the web-only siblings); `NEXT_PUBLIC_SITE_URL=https://nocturne-demo.fly.dev` baked at build. Verified live: `/` 200 with the exact eval-free CSP (no `unsafe-eval`; `media-src`/`worker-src 'self' blob:`), `/about` 200, `/opengraph-image` 200 image/png, robots/sitemap reference the canonical origin. The GPU field + Web Audio run client-side in the visitor's browser; the CPU-only Fly Machine just serves the bundle.

### Deferred (v2 path)

- **A real CC0 / royalty-free track option** alongside the procedural synth default.
- **Recording / export** — capture the canvas to a video, GIF, or image sequence in-app.
- **MIDI / external control** via Web MIDI.
- **`PerformanceMonitor` adapt-up-to-`ultra` tuning** — the runtime headroom rule that promotes a capable desktop toward the ~1M `ultra` tier, tuned against the deployed profile (boot default stays the conservative `high` ≈ 262k).
- **Deferred designer-critic mediums** (none AA-blocking; flagged at deploy for a later art-direction pass) — **all CLOSED in the [Unreleased] finish-off pass above:** D-05 (scrim-derived dividers), D-07 (animated Sora weight axis), D-09 (Ink Bloom default), D-10 (OG tagline scrim band), D-11 (`/about` heading rhythm), D-12 (idle button shimmer).

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
