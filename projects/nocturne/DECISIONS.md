# nocturne — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour (web-only), the portfolio-composition rationale, the R3F single-family animation posture, the sovereign dark-cinematic token posture, and the R3F-re-use justification vs apex

**Status:** accepted
**Date:** 2026-06-14

### Context

`nocturne` (slot 8) is a **web-only, GPU-accelerated, audio-reactive generative particle experience** — a field of 100k–1M particles advected through an animated curl-noise field via a **GPGPU FBO ping-pong simulation in custom GLSL**, driven in real time by a **Web Audio FFT** (the field breathes with the music), reacting to the pointer, re-skinnable by curated **presets**, and finished with cinematic **post-processing** (bloom, vignette, chromatic aberration) in a fullscreen sovereign-dark UI with a minimal HUD. The wow is the five-second moment the field comes alive and pulses to the sound.

The owner has confirmed the load-bearing decisions. ADR-001 ratifies four of them so downstream agents work against a fixed footing:

1. **(a)** web-only vs api-heavy per `docs/conventions.md` § 10 — owner explicitly chose **web-only, no backend**;
2. **(b)** the portfolio-composition rationale per § 12 — the backend-variance story is already complete, so slot 8 is a deliberate web-only creative piece;
3. **(c)** the animation/3D library posture per § 15 — a genuine GPGPU + custom-GLSL surface points at **R3F + drei + @react-three/postprocessing**, a **single R3F family** (no GSAP, no Motion);
4. **(d)** the design-token posture — sovereign per § 14 (no reuse from any sibling), **dark-canonical**;

and, because nocturne is the portfolio's **second** R3F project, it explicitly discharges the § 14 **no-sibling-re-skin gate** against `apex` (the only other R3F project).

Portfolio context that frames (a) and (b): per root `PROGRESS.md`, the portfolio stands at **seven shipped + deployed projects**, with **four api-heavy across four distinct backends** — `tape` (Elysia/Bun), `meld` (Hono/Node), `pulse` (NestJS), `atlas` (Fastify) — plus three web-only (`razors-edge` dark-luxe marketing, `apex` 3D configurator, `atrium` the landing page). The § 11 backend axis is **fully exhausted** (all four cutting-edge Node/Bun backends are demonstrated) and § 12 is satisfied several times over.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (a static-first Next.js app; the experience runs entirely in the browser).** None of the five § 10 api-heavy triggers fires: **no WebSocket/SSE** (the audio analysis, the GPGPU sim, and the rendering are all in-browser; nothing streams), **no background jobs/queue/cron**, **no non-Next API consumer** (the only "data" is a small static set of preset definitions + credits the app serves to itself), **no heavy auth flow** (none at all), and **no heavy domain logic worth isolating** (the only logic is the GLSL sim — a GPU concern, not a backend one — plus a small pure audio-band-reduction function and a preset cross-fade machine, both client-side and Vitest-testable in `src/lib/`). **Picked (owner-confirmed).**
- **B. api-heavy with some invented backend (e.g. a "gallery of saved presets" service, or a streaming-audio proxy).** Technically possible but pure ceremony — it would not advance the backend-variance story (all four § 11 backends are already demonstrated) and would violate CLAUDE.md § 3 ("deviate only when the project genuinely requires it") in reverse. The showcase value here is the GPGPU + GLSL + audio-reactive craft, not a CRUD service. **Rejected on need grounds, not capability grounds.** (Saveable/shareable presets are a v2 note, achievable client-side via URL params with no backend.)

**Crucially, the GPGPU simulation and the Web Audio pipeline do _not_ make this api-heavy.** Both are **client** concerns; every § 10 trigger is a **server** concern. A heavy-WebGL + heavy-Web-Audio project is a frontend-complexity signal (it sets the animation stack — ADR-002 pending), not a backend signal — the same principle apex established for its WebGL configurator.

**Animation / 3D library posture (per § 15):**

- **A1. R3F + drei + @react-three/postprocessing — a single R3F family, no GSAP, no Motion.** The entire visual surface is **genuine GPU 3D + custom compute** (the GPGPU FBO ping-pong sim + the render particle system + custom GLSL), which is the strongest possible § 15 case for R3F ("only when the project actually uses WebGL / 3D"). `@react-three/postprocessing` is the **post stack of the same family** (it wraps `postprocessing` for R3F), not a separate animation library — so this is **one** family, honestly inside CLAUDE.md § 5's "do not stack three." The preset cross-fades, audio envelopes, and pointer wake are **uniform interpolations inside the R3F render loop**, not a DOM animation library's job; the minimal HUD's small transitions are **CSS / `data-state`**. No GSAP and no Motion are needed. **Picked.**
- **A2. R3F + GSAP (and/or Motion) for the HUD / intro choreography.** Rejected: the HUD is a handful of small DOM transitions that CSS expresses cleanly; adding GSAP or Motion would be a second/third animation library for no surface that needs it, and would weaken the "one engine, in the render loop" purity that is the project's craft signal. Admitted only by a later bounded ADR if CSS genuinely cannot express a needed HUD transition (the escape hatch; default = not included).
- **A3. A raw three.js / vanilla-WebGL implementation outside R3F.** Possible, but R3F + drei give the production helpers (Suspense `<Loader>`, the `next/dynamic ssr:false` integration apex already proved, `PerformanceMonitor`/`AdaptiveDpr`, the lifecycle/cleanup discipline) and keep the project consistent with the portfolio's stack defaults, while custom GLSL + `GPUComputationRenderer` still deliver the hand-written-shader craft. **Rejected** in favour of R3F for integration + lifecycle correctness; the GLSL is still hand-written.

**Design-token posture + canonical theme:**

- **D1. Sovereign tokens, built from scratch, dark-canonical.** Required by § 14 (tokens never leave the project that owns them). The dark-cinematic "nocturne" identity is unique and must not borrow tape's slate/cyan, meld's warm-paper/OKLCH, razors-edge's brass-on-near-black, pulse's palette, apex's light-canonical-EV-product palette, or atrium's six-hue lobby. **Dark is canonical and design-true** (a cinematic audio-visual piece is a dark-room experience; the field _is_ the color, glowing additively against black). Light ships as a **chrome-only** reading mode for the non-canvas surfaces; the **canvas stage stays dark in both chrome themes** (you do not "light-mode" a fireworks display) — reasoned here, pinned precisely in a later ADR. **Picked (mandated sovereign tokens; dark-default; the chrome-light/stage-dark split recommended, architect ratifies).**
- **D2. Reuse/extend another project's tokens.** Forbidden by § 14. **Rejected.**

### Decision

**Stack flavour: web-only.** **3D/animation posture: React Three Fiber + drei + @react-three/postprocessing — a single R3F animation-library family; no GSAP, no Motion** (cross-fades/envelopes/wake are render-loop uniform interpolations; HUD micro-transitions are CSS; Motion/GSAP admissible only by a later bounded ADR). **Custom GLSL is the heart** (the curl-noise advection simulation shader in the FBO ping-pong, the render particle shader, the noise utilities) — hand-written, not a black-box effect. **Design-token posture: sovereign — no reuse from any sibling (§ 14) — dark-canonical, with a chrome-only light reading mode and the canvas stage staying dark in both themes.**

The four picks converge on one thesis: **this slot's portfolio value is pure creative-coding / generative-graphics craft** — proof the author can write a GPGPU curl-noise advection sim in GLSL, run it at hundreds of thousands of particles at 60 fps, wire a Web Audio FFT into the turbulence / color / bloom so the field breathes with the music, re-skin it dramatically with presets, finish it cinematically, and still ship it to the portfolio's production bar (tiered degradation, a no-WebGL poster-frame floor, reduced-motion respected, WCAG 2.2 AA chrome, a decorative-canvas text alternative, strict CSP, SEO). It is the deliberate most-visually-arresting piece in the portfolio.

**The new risks this project introduces** over apex are (1) a **GPGPU FBO ping-pong** compute architecture (apex rendered a supplied GLB; nocturne computes the whole sim on the GPU in custom GLSL), (2) a **Web Audio analysis pipeline** under the browser autoplay policy, and (3) the **degradation contract for a generative, continuously-animating, audio-reactive piece** (vs apex's interactive-on-input configurator). These are deferred to the architect: **ADR-002** (GPGPU architecture + R3F/Next integration + performance tiers + CSP-with-three.js), **ADR-003** (the Web Audio pipeline + the autoplay-gesture contract + the CC0 track provenance), and **ADR-004** (reduced-motion + four-tier degradation + the poster→live-field hand-off + the chrome-theme/stage-dark decision). A deploy-posture ADR lands at Phase 8. apex's R3F-with-Next integration (`next/dynamic ssr:false` Canvas, Suspense + `<Loader>`, low `'use client'` boundary, capped `dpr`, adaptive quality, capability gating, the static-still→live-canvas hand-off, the strict-CSP-with-three.js verification) is **inherited wholesale** and not re-litigated.

### Portfolio-composition rationale (planner enforcement, `docs/conventions.md` § 12)

**slot 8 being web-only does not threaten § 12; the constraint is satisfied with wide margin and there is no standing flag to discharge.**

- **The backend-variance story is COMPLETE.** The portfolio has **4 api-heavy projects across FOUR distinct backends** (`tape` Elysia/Bun, `meld` Hono/Node, `pulse` NestJS, `atlas` Fastify) — all four § 11 backends are demonstrated. The 2–3 api-heavy minimum and the ≥2-backends (here four) variance requirement are met several times over. **No backend axis remains to fill**, so a deliberate web-only creative piece is the correct use of slot 8.
- **No standing flag.** Unlike apex (which had to discharge razors-edge's NestJS-slot worry), there is no open composition flag here — the backend story closed at slot 6 (`atlas`/Fastify). slot 7 (`atrium`) and slot 8 (`nocturne`) are both web-only by deliberate design, and that is healthy: the portfolio now demonstrates **range across the full WebGL spectrum** (apex's product-3D configurator at one end, nocturne's abstract generative GPGPU art at the other) on top of a complete backend story.
- **Forward-looking note (not a block):** the backend axis is exhausted, so any _ninth_ project is unconstrained on this axis. If the owner wants to revisit backend depth (e.g. a second project on an existing backend with a harder domain), that is a free future choice — it is not required and does not affect nocturne.

### R3F-re-use justification — the § 14 no-sibling-re-skin gate vs apex

nocturne is the **second** R3F project in the portfolio (apex is the first). § 14 forbids the portfolio collapsing into "one template repeated," so the re-use of R3F must be **justified as a different project, not a re-skin.** It is — on every axis:

- **Motif.** apex's R3F is a **product configurator**: a single supplied **GLB car model**, lit like a studio shot, orbited by the user, with **material/mesh swaps** (paint, wheels). nocturne's R3F is **abstract generative art**: there is **no model** — the entire visual is a **GPGPU simulation** (hundreds of thousands of particles advected through a curl-noise field in custom GLSL, computed via FBO ping-pong). One renders a thing; the other **computes** a living system. Opposite ends of the R3F spectrum.
- **Custom GLSL.** apex uses R3F/drei's stock materials + lighting on a loaded asset (essentially no custom shader work). nocturne is **almost entirely custom GLSL** — the simulation shader (curl-noise advection of position/velocity textures), the render particle shader (additive soft sprites, audio-mapped color), and the noise utilities are hand-written. This is the distinguishing craft signal and it is absent from apex.
- **Audio reactivity.** apex has none. nocturne's defining feature is a **Web Audio FFT** driving the simulation's turbulence, the particle color/energy, and the bloom — the field **breathes with the music**. A whole pipeline (and interaction model) apex does not have.
- **Palette.** apex is **light-canonical** — a bright, technological EV-product register (cool-light grounds, a single voltaic accent). nocturne is **dark-canonical and generative-luminous** — a near-black cinematic stage where the **preset palette ramps themselves** are the shifting accent. Sovereign and unmistakably distinct (§ 14 mandates no token reuse — verified).
- **Interaction model.** apex: **orbit** the car + tap **material swatches** + carry the config into a reservation wizard. nocturne: an **audio + pointer field** (the pointer is a local attractor/repeller leaving a wake; the music drives the whole field) + **presets** that morph the entire look. Different inputs, different outputs.
- **Post-processing.** apex has essentially none (a studio-lit product reads best clean). nocturne is **cinematically post-processed** (bloom pulsed by the audio, vignette, chromatic aberration) as a core part of the identity.

The `designer-critic` runs this gate **explicitly in Phase 6** and it must PASS: a viewer landing on nocturne after apex must read it as a **different project by the same author**, not the same engine re-skinned. (This mirrors how the designer-critic passed the atrium-vs-razors-edge gate in slot 7.)

### Consequences

- **Positive.**
  - The portfolio gains a **pure creative-coding / generative-graphics capability signal** — a hand-written GPGPU curl-noise sim + custom GLSL + a Web Audio reactive pipeline at 60 fps — that **none** of the other seven projects demonstrate, completing the WebGL story with apex's product-3D at the opposite end of the spectrum.
  - **Single R3F family, no GSAP/no Motion** keeps the project honestly inside § 5; the "everything in the render loop" purity is itself part of the craft signal and makes the animation boundary trivially enforceable (canvas = R3F; HUD = CSS).
  - **Sovereign dark-canonical tokens** force a fresh, ownable identity and strengthen the range story (the deliberate dark-room counterpoint to apex's light-canonical EV register).
  - **§ 12 is satisfied with wide margin** and the backend story is complete, so this slot is free to be the most visually arresting creative piece without any composition cost.
- **Negative / risks (deferred to the architect).**
  - **GPGPU correctness + the 60 fps claim** hinge on a 100%-GPU sim (zero per-particle CPU work) and correct FBO ping-pong — ADR-002 must pin the mechanism + the tier table + the capability gate, and the `reviewer` verifies no per-particle CPU loop exists.
  - **The Web Audio autoplay policy** means the experience cannot start without a user gesture — ADR-003 must turn that constraint into the designed intro gate, and must keep the audio graph leak-free across source switches.
  - **A continuously-animating audio-reactive canvas is not a fair Lighthouse-TBT subject** — the spec measures Lighthouse ≥ 95 on the **non-canvas surfaces** and documents the canvas's 60 fps + tiers separately (the apex precedent); ADR-004 pins the poster→live hand-off so LCP is the static poster, never the canvas.
  - **Strict CSP with three.js + the post stack + Web Audio (+ any worker/wasm/blob for decode)** must be verified — ADR-002/003 pin the allowances; the `reviewer` confirms no `unsafe-eval` path.

---

## ADR-002: GPGPU engine (FBO ping-pong + curl-noise advection), the R3F/Next 16 integration, the performance-tier strategy, and the strict eval-free CSP for WebGL + post + Web Audio

**Status:** accepted
**Date:** 2026-06-14

### Context

ADR-001 selected **R3F + drei + @react-three/postprocessing** (single family) with **custom GLSL** as the heart, and deferred the GPGPU mechanism, the texture format, the performance tiers, the R3F/Next integration, and the CSP to the architect. This ADR (Task 0.1) pins them so Phase 1 (Task 1.3 smoke Canvas) and Phase 4 (the engine) build against a fixed contract. nocturne **inherits apex's R3F/Next integration wholesale** — the `next/dynamic ssr:false` Canvas, Suspense + `<Loader>`, the low `'use client'` boundary, the capped `dpr`, `PerformanceMonitor`/`AdaptiveDpr` adaptation, the capability gate → fallback routing, and the static-still→live-canvas reveal (apex ADR-002/004) — and diverges on exactly the surface that is new: **a GPGPU FBO ping-pong simulation in custom GLSL** (apex rendered a supplied GLB; nocturne computes the whole sim on the GPU), a **continuous render loop** (apex used `frameloop="demand"`; an audio-reactive field must animate every frame), and a **float-render-target capability requirement** (apex needed only a WebGL2 context).

Four forces must be fixed before scaffold:

1. **The GPGPU mechanism + texture format** — what stores position/velocity, how the ping-pong works, and the precision/format with its WebGL2 extension requirement and capability probe.
2. **The performance tiers** — the particle counts, the default desktop tier (the planner's flag: a smooth 262k beats a stuttering 1M), the device heuristic, and the runtime adaptation.
3. **The R3F/Next integration** — single client island, the **continuous** frameloop (the apex divergence), and the single render-loop ownership (sim step → render → post).
4. **The CSP** — apex proved three.js + R3F + the post stack run **eval-free**; this ADR confirms it for nocturne and adds the Web Audio allowances (deciding AnalyserNode over AudioWorklet to keep the CSP tight).

### Options considered

**GPGPU mechanism (FBO ping-pong):**

- **A. three.js `GPUComputationRenderer` (the drei/three ecosystem's batteries-included ping-pong). Picked.** It owns the two-FBO ping-pong, the texture allocation, the dependency wiring between variables (position depends on velocity and vice-versa), and the render-target swap, exposing each "variable" as a named texture you read in the render shader. It is the canonical, battle-tested vehicle for exactly this pattern (it is what every reference GPGPU-particle three.js demo uses), it is `three/examples` (MIT, no extra dependency beyond three), and — load-bearing for the CSP — it compiles GLSL **through the WebGL driver, not JS `eval`** (the apex finding holds: shader compilation is GPU-side). **Picked** for correctness + ecosystem proof + zero new heavy deps.
- **B. A hand-rolled minimal ping-pong** (two `WebGLRenderTarget`s + a fullscreen-quad `Scene`/`OrthographicCamera`, swap each frame). More control and one fewer abstraction, but re-derives exactly what `GPUComputationRenderer` already does correctly (the read/write-different-texture invariant, the variable dependency graph), with more surface for a subtle ping-pong bug (reading and writing the same texture in a pass — the classic GPGPU footgun). **Rejected** as needless risk; the engine's craft signal is the **GLSL** (curl-noise advection), not re-implementing the harness. (Retained as the documented escape hatch if `GPUComputationRenderer`'s variable model ever fights a needed multi-pass; not expected for a two-variable position/velocity sim.)
- **C. WebGPU compute shaders (`three/webgpu` + TSL/WGSL).** The "modern" path, but WebGPU support is still uneven across the target audience's browsers (Safari only recently, Firefox partial), it would force a WebGL2 fallback engine anyway (doubling the surface), and it abandons the proven apex WebGL2 + CSP precedent. **Rejected for v1** as premature; noted as a v2 "WebGPU compute" path in the README.

**Texture format / precision:**

- **F1. `HALF_FLOAT` (`RGBA16F`) render targets, with a `FLOAT` (`RGBA32F`) fallback, both gated on `EXT_color_buffer_float`. Picked.** Half-float halves memory + bandwidth versus full float (load-bearing at 262k–1M texels × 2 textures × ping-pong = up to 8 render targets live), and 16-bit float precision (~3 decimal digits, range to 65504) is **adequate for the curl-noise advection** because positions are kept in a bounded domain (a normalized field box, roughly [-1,1]³ scaled) and velocities are small per-frame deltas — precision drift over a particle lifetime is masked by the respawn cycle (below) and is imperceptible in an additive glow field. Full float is the fallback only where half-float render targets are unsupported but full-float is (rare; most WebGL2 GPUs that support one support both via the same extension). **Picked.**
- **F2. Full `FLOAT` (`RGBA32F`) always.** Simpler (one format) and maximally precise, but doubles VRAM/bandwidth for precision the field does not need, and on some mobile/integrated GPUs `RGBA32F` render targets are unsupported or non-filterable while `RGBA16F` is fine — so always-full-float would needlessly route capable devices to the Tier-4 poster. **Rejected** as the default; kept as the fallback rung.

**WebGL2 + `EXT_color_buffer_float` requirement.** Rendering **to** a float/half-float texture (color-buffer float) is **not** core WebGL2 — it requires the `EXT_color_buffer_float` extension (which covers both `RGBA16F` and `RGBA32F` as renderable color attachments). The capability probe (below) **must** check `gl.getExtension('EXT_color_buffer_float')` is non-null after acquiring a WebGL2 context; without it, no GPGPU float ping-pong is possible and the client routes to the Tier-4 poster (ADR-004). This is the single hard gate the frontend-engineer implements first.

**Render particle system:**

- **R1. `THREE.Points` (gl.POINTS) reading the sim textures in the vertex shader. Picked.** One draw call for the whole field; each vertex's `gl_Position` is computed by sampling the position texture at the particle's UV (the index→UV map below); `gl_PointSize` is set per-particle (size attenuation + audio/energy modulation); the fragment shader does the soft radial falloff (a smooth `1 - smoothstep` disc, additive-blended). `POINTS` is the cheapest primitive for hundreds of thousands–millions of particles and is the canonical GPGPU-particle render path. **Picked** for v1. Caveat recorded: `gl_PointSize` has a driver `ALIASED_POINT_SIZE_RANGE` cap (often 1023, sometimes 64 on some mobile) — the soft-falloff disc keeps point sizes modest, so the cap is not a practical limit; if large bloom-blossoms are wanted they come from the **post bloom**, not huge points.
- **R2. Instanced quads (billboarded triangles per particle).** Removes the point-size cap and allows velocity-stretched trails as stretched quads, but costs ~6× the vertex work and a custom billboard in the vertex shader. **Rejected for v1** as unnecessary cost; **velocity-stretched trails** are achieved instead by (a) the additive accumulation of the field over the bloom and (b) an optional per-particle previous-position read for a short stretch — kept as a Phase-4 refinement, not a primitive change. Instanced quads are the documented v2 path if trails need to be longer/sharper.

### Decision

**1. The GPGPU engine — `GPUComputationRenderer`, two variables, half-float, curl-noise advection.**

- **Two compute variables, ping-ponged by `GPUComputationRenderer`:** `texturePosition` (RGBA: `xyz` = world position, `w` = particle age/life in [0,1]) and `textureVelocity` (RGBA: `xyz` = velocity, `w` = a per-particle seed/scalar, e.g. a stable random used for size/phase variation). Each is an **N×N** `HALF_FLOAT` texture (full-float fallback). `setVariableDependencies` declares each reads both textures (velocity advects position; position feeds the next velocity's noise sample).
- **Data layout — particle index → sim UV.** Particle `i` (of `N²`) maps to texel `uv = (mod(i, N) + 0.5)/N, (floor(i / N) + 0.5)/N`. The render `Points` geometry carries a single static `reference` attribute per vertex = that `uv` (computed once on the CPU at allocation — this is the **only** CPU per-particle work, done **once at init**, never per frame). The render vertex shader samples `texturePosition` / `textureVelocity` at `reference` to place and color each particle. The sim fragment shaders use `gl_FragCoord.xy / resolution` as the texel UV.
- **Initial state.** The position texture is seeded (at init, on the CPU, once) with particles distributed in the field domain (a sphere/box per preset's spawn shape); `w` (age) seeded to a randomized phase in [0,1] so respawns are de-synchronized (no global pulsing). The velocity texture seeds near-zero with the per-particle seed in `w`.
- **Curl-noise advection (the simulation velocity shader, custom GLSL).** Velocity is driven by the **analytic curl of a 3D simplex/value noise field**: `curl(F) = ( ∂Fz/∂y − ∂Fy/∂z , ∂Fx/∂z − ∂Fz/∂x , ∂Fy/∂x − ∂Fx/∂y )`, evaluated by sampling the noise potential at small ±epsilon offsets on each axis (finite-difference curl — the standard, robust approach; a fully analytic-gradient simplex is a Phase-4 optimization only if profiling demands it). Curl of a vector field is **divergence-free**, so particles flow in smooth incompressible swirling streams rather than collapsing to sinks. The new velocity is `lerp(prevVelocity, curlSample * uFlowSpeed, uDamping)` plus the **pointer attractor/repeller** term (a falloff-weighted vector toward/away from `uPointer`) and the **audio turbulence** term (below). Uniforms: `uFlowScale` (noise frequency), `uFlowSpeed`, `uTurbulence`, `uDamping`, `uTime`, `uPointer` (xyz + strength), `uDelta` (frame delta, clamped to avoid blowups on tab-return). The simplex/value noise + the curl helper live in a shared `.glsl` chunk (`src/lib/glsl/`), `#include`-d into both sim and render shaders via three's `ShaderChunk`/onBeforeCompile or a small glsl import — **hand-written, the craft signal.**
- **The simulation position shader** integrates `position += velocity * uDelta * uFlowSpeed` and advances `age (w) += uDelta / uLifetime`. **Respawn/lifetime:** when `age >= 1.0` (or the particle drifts outside the field bounds), the particle is **respawned** to a fresh seeded position in the spawn shape with `age = 0` — keeping the field from draining into the curl attractors and giving continuous regeneration. Respawn position is computed in-shader from the particle's stable seed + `uTime` hashing (no CPU involvement).
- **Zero per-particle CPU work per frame — the load-bearing 60 fps invariant.** Per frame the CPU only: reads the AnalyserNode once (ADR-003), reduces to bands (a pure function over a fixed small bin array), and sets a **handful of scalar/vector uniforms**. There is **no per-particle JS loop anywhere in the frame** — the `reference` attribute and the seed textures are built **once** at init. The `reviewer` verifies this invariant (Phase 6.3); it is the reason 262k–1M particles hold 60 fps.

**2. The render particle system — `THREE.Points`, additive soft sprites, audio-mapped color.** The vertex shader samples `texturePosition` at `reference`, sets `gl_Position` and a per-particle `gl_PointSize` (base size × size-attenuation × `(1 + uHigh * k)` sparkle from highs); passes the particle's speed/energy and age to the fragment shader. The fragment shader draws a **soft additive radial disc** (`alpha = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5))`), colored by sampling the **preset palette ramp** (a 1D gradient texture or an in-shader color-ramp) at a coordinate derived from particle energy/speed shifted by `uHigh` (highs → color shift) — `AdditiveBlending`, `depthWrite: false`, `depthTest: false` so the field glows cumulatively against the dark stage. Pointer wake is already in the velocity (sim), so the render just shows it.

**3. The per-frame uniform contract (the single source of truth the engine, the audio pipeline (ADR-003), and the cross-fade (ADR-004) all write).** Grouped, with their drivers:

- **Sim (velocity/position shaders):** `uFlowScale`, `uFlowSpeed`, `uTurbulence` (← `bass`), `uDamping`, `uLifetime`, `uPointer (vec4: xyz+strength)`, `uFlowEnergy` (← `bass`), `uSpread` (← `mid`), `uTime`, `uDelta`.
- **Render (Points shaders):** `uPaletteRamp` (preset palette texture), `uColorShift` (← `high`), `uSparkle` (← `high`), `uParticleSize`, `uParticleOpacity`, `uEnergy` (← `rms`).
- **Post (EffectComposer):** `uBloomStrength` / `uBloomThreshold` (← `rms` for the breathing glow), `uVignette` (← `rms`, subtle), `uAberration` (preset constant, gently `rms`-modulated).
- Every audio→uniform mapping passes through the **attack/release envelope** (ADR-003) so the visuals breathe, not strobe. Preset switching cross-fades the **base** values of all of the above (ADR-004); audio modulates **around** the cross-faded base.

**4. Performance tiers — counts, default, heuristic, adaptation.**

Particle count = the sim FBO dimension N (N×N texture → N² particles):

| Tier                       | N (FBO) | Particles | DPR clamp   | Post quality                  | Target device (initial guess)                     |
| -------------------------- | ------- | --------- | ----------- | ----------------------------- | ------------------------------------------------- |
| **low**                    | 256²    | ~65k      | `[1, 1.25]` | bloom only (no aberration)    | mobile / coarse-pointer small-viewport / weak GPU |
| **mid**                    | 384²    | ~147k     | `[1, 1.5]`  | bloom + vignette              | mid laptops / integrated GPUs / tablets           |
| **high (DESKTOP DEFAULT)** | 512²    | ~262k     | `[1, 2]`    | bloom + vignette + aberration | **mainstream capable desktop GPU — the default**  |
| **ultra**                  | 1024²   | ~1.05M    | `[1, 2]`    | full                          | adapted-UP only, on proven headroom               |

- **The desktop default is `high` (512² ≈ 262k), NOT `ultra`.** This discharges the planner's explicit flag (`AGENT_NOTES.md` #1): a jank-free 262k field beats a stuttering 1M one for the five-second wow. **`ultra` (1M) is never the initial pick** — it is reached **only** by runtime adaptation when `PerformanceMonitor` reports sustained headroom (a stable factor above 60 fps for a few seconds) on a Tier-1 desktop. The README's measured tier table is the source of truth; if a class of GPU is proven on real hardware to hold 1M at a locked 60 fps, the README documents it, but the **shipped default stays conservative**.
- **Tier-selection heuristic (boot, before the Canvas mounts) — a `detectGpuTier()` probe mirroring apex's `detectWebglTier()`, extended for the float requirement.** Order:
  1. Acquire a throwaway `canvas.getContext('webgl2')`. **Null → Tier-4 poster** (no WebGL2).
  2. `gl.getExtension('EXT_color_buffer_float')`. **Null → Tier-4 poster** (cannot render to float — the GPGPU hard gate). (A `WebGL1 + OES_texture_float` half-engine is explicitly **out of scope**: the audience is WebGL2-era; WebGL1-only routes to the poster.)
  3. `matchMedia('(prefers-reduced-data: reduce)')` → cap at **low**.
  4. Coarse-pointer (`matchMedia('(pointer: coarse)')`) AND small viewport (`< 768px`) → **low** (mobile floor), even if the GPU probe is strong (the apex "a melted phone is a worse first impression than a crisp lower tier" rule).
  5. `navigator.hardwareConcurrency` (and `deviceMemory` **where present** — absent on Safari/Firefox, not penalized): `>= 8` cores → **high**; `>= 4` → **mid**; else **low**. Desktop (fine pointer, large viewport) passing the float gate starts at **high** (the default).
     An **optional first-second FPS probe** may nudge the initial guess down one rung before the field fully arms; the authoritative correction is the runtime monitor.
- **Runtime adaptation (`PerformanceMonitor` + `AdaptiveDpr`).** After mount, drei `<PerformanceMonitor>` adapts **in this order** on sustained low fps: (1) drop **DPR** (within the tier clamp), (2) drop **post quality** (aberration off → vignette off → bloom resolution down), (3) only as a last resort, **demote the tier** (re-init at a smaller N — a heavier operation, so it is the final rung). On sustained **headroom** it may step **up** DPR/post and, on a desktop Tier-1 client only, **promote toward `ultra`**. Particle count change (N) requires a sim re-init, so it is coarse and rare; DPR/post are the fine, frequent knobs. Thresholds tuned in Phase 4 against the deployed profile and recorded in `AGENT_NOTES.md` (the apex pattern).
- **The render `Canvas` caps `dpr` per the tier clamp** above; the sim FBO size N is independent of DPR (the sim resolution is the particle count; DPR is the _render-target_ resolution). **Resolution-scale** under load is the DPR drop, not an N change.

**5. R3F / Next 16 integration — single client island, continuous frameloop, single render-loop owner.**

- **A single client island, `next/dynamic` with `ssr: false`.** All of three.js, R3F, drei, `@react-three/postprocessing`, the `GPUComputationRenderer`, and the shaders live behind **one** dynamically-imported module (e.g. `src/components/stage/nocturne-canvas.tsx`), never imported into a Server Component — the only place three.js is imported, giving the code-split chunk Task 1.3 verifies is **out of the initial bundle**. The `/` route's Server Component renders the **poster** (LCP) + the intro/gesture gate + the real-DOM HUD/text-alternative; the live Canvas is the lazy client leaf mounted behind the poster (ADR-004 reveal).
- **Frameloop is `always` (continuous) — the deliberate divergence from apex.** apex used `frameloop="demand"` (an idle configurator costs zero GPU); nocturne is a **continuously-animating audio-reactive field** — it must step the sim and re-render **every frame** while armed, so `frameloop="always"`. To honor the spirit of apex's battery discipline, the loop **pauses** (sets `frameloop` off / stops the rAF) when: the tab is hidden (`document.visibilityState === 'hidden'`), the experience is not yet armed (pre-gesture: the poster is showing, no loop runs), and when reduced-motion selects the **still** branch (ADR-004 — no loop at all). So "always" means "always while armed and visible," never "always burning a hidden tab."
- **A single `useFrame` owns the whole loop, in this fixed order each frame:** (1) read AnalyserNode → bands → envelope (ADR-003); (2) write the audio + pointer + cross-fade uniforms; (3) `gpuCompute.compute()` (one ping-pong step of velocity then position); (4) feed the resulting position/velocity textures into the render material uniforms; (5) the Canvas renders the `Points` through the `EffectComposer` (post). **One owner, one order** — no competing loops, no per-object `useFrame` scattering. The `EffectComposer` from `@react-three/postprocessing` replaces the default render in that single pass.
- **Suspense + drei `<Loader>` / `useProgress`** wrap the dynamic Canvas; the fallback occupies the reserved fullscreen box (CLS-safe). **Cleanup:** on unmount, R3F disposes the renderer/scene; the engine disposes the `GPUComputationRenderer` render targets, the palette textures, and the geometry; the audio graph tears down (ADR-003). The `reviewer` audits no leaked WebGL context / render targets across navigation (the apex audit, extended to the FBOs).

**6. The strict, eval-free CSP for WebGL + post + Web Audio.** apex **proved** three.js + R3F + drei + `@react-three/postprocessing`'s `postprocessing` compile GLSL through the WebGL **driver, not JS `eval`** (apex ADR-002 §5; the shipped apex CSP carries **no `'unsafe-eval'` and no `'wasm-unsafe-eval'`**). nocturne ships **no GLB, no draco/meshopt decoder, no WASM** at all (the sim is pure GLSL; there is nothing to decompress), so it is **even cleaner** than apex — there is no WASM surface to consider. The remaining question is Web Audio:

- **AnalyserNode (main thread), NOT AudioWorklet — chosen to keep the CSP tight.** An `AudioWorklet` loads its processor module via `audioContext.audioWorklet.addModule(url)`, which (for a blob-built processor) needs `script-src blob:` and/or `worker-src blob:` — a relaxation. A main-thread `AnalyserNode` (`getByteFrequencyData` once per rAF) needs **no worklet, no blob script, no extra CSP directive at all**, and is entirely sufficient: the analysis is a single cheap FFT read per frame (ADR-003), not heavy DSP that would justify a worklet. **AnalyserNode is chosen** — it keeps `script-src` free of `blob:` and the CSP as tight as apex's. (AudioWorklet is noted as a v2 path only if a future feature needs sample-accurate off-main-thread DSP, and it would be an explicit CSP ADR.)
- **The Web Audio additions to apex's CSP are `media-src` (the bundled CC0 track + the uploaded-file object URL) — that is the only delta.** mic input (`getUserMedia` → `MediaStreamAudioSourceNode`) needs **no** CSP directive (a `MediaStream` is not a fetched resource). The uploaded file is read as an **object URL** (`blob:`), so `media-src` must allow `blob:`. The bundled track is a same-origin static asset (`'self'`).

**The exact production CSP (the value of the `Content-Security-Policy` header, directives `;`-joined):**

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Notes on each non-obvious directive:

- **`script-src 'self' 'unsafe-inline'`** — the load-bearing guarantee is **no `'unsafe-eval'` and no `'wasm-unsafe-eval'`** (nocturne has no WASM at all, so even apex's narrow WASM allowance is absent — a genuine tightening over apex). `'unsafe-inline'` for scripts is the inherited Next-15/16-hydration-bootstrap + next-themes-flash-guard necessity (the same v1.1 nonce-hardening debt razors-edge/apex/atrium carry; recorded in `AGENT_NOTES.md`).
- **`style-src 'self' 'unsafe-inline'`** — Tailwind v4 inline style attributes + R3F's inline canvas styles. (No GSAP here, but the inline-style need stands.)
- **`media-src 'self' blob:`** — the **new** directive vs apex: `'self'` serves the bundled CC0 track from the app's static assets; `blob:` serves the user-uploaded audio file's object URL. Without `media-src`, `default-src 'self'` would cover the bundled track but **not** the `blob:` upload — so this directive is required.
- **`img-src 'self' data: blob:`** — the poster + preset-directory AVIF stills, favicons, and any canvas `toDataURL` (poster-export workflow, ADR-004).
- **`connect-src 'self'`** — there is **no network in v1** (presets are static; no backend; the track and stills are same-origin static assets; mic is a `MediaStream`, not a fetch; upload is a local `File`→`blob:`, not a fetch). Kept at `'self'` — **tighter than apex's `connect-src 'self' blob:`**, because nocturne's GLTFLoader-blob-fetch reason (apex's) does not exist here. (If a future profiling step shows three's texture loading `fetch`-es a same-origin `blob:`, add `blob:` then with a recorded reason — not pre-emptively.)
- **`worker-src 'self' blob:` / `child-src 'self' blob:`** — retained defensively (R3F/drei or `postprocessing` may spin a self-hosted blob worker; harmless same-origin surface). Note this is for **R3F**, not for any AudioWorklet (which is **not** used).
- **`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`** — inherited hardening (no embed, no `<base>` injection, same-origin form posts).

**Dev-only relaxation (mirrors atrium/apex):** `next dev` (HMR + React Fast Refresh) evals at runtime and opens an HMR WebSocket, so the `headers()` dev branch adds `'unsafe-eval'` to `script-src` and `ws: wss:` to `connect-src` **for development only** (`process.env.NODE_ENV !== 'production'`). The **shipped build is eval-free**; the dev grant never reaches production. This is the verified atrium pattern, copied.

### Consequences

- **Positive.**
  - The GPGPU mechanism (`GPUComputationRenderer` + half-float + curl-noise + index→UV) is pinned with the **zero-per-particle-CPU-work** invariant explicit, so the 60 fps claim is engineered, not hoped — and the `reviewer` has a single mechanical thing to verify (no per-particle JS loop in the frame).
  - The **default desktop tier is conservatively `high` (262k)**, discharging the planner's "smooth 262k beats stuttering 1M" flag; `ultra` is adaptation-only, so the wow never ships stuttering.
  - The CSP is **tighter than apex's** (no WASM at all; `connect-src 'self'` without `blob:`), with **exactly one** Web-Audio-driven addition (`media-src 'self' blob:`), and the AnalyserNode-over-AudioWorklet choice keeps `script-src` free of `blob:` — the security baseline is set before scaffold and is the cleanest in the portfolio's WebGL projects.
  - The continuous-frameloop divergence from apex is **bounded** (pauses when hidden / unarmed / reduced-motion-still), so battery discipline survives despite the always-on field.

- **Negative.**
  - **Half-float precision** could, in a pathological preset (very low flow speed + very long lifetime + a huge field domain), accumulate visible positional drift; mitigated by the bounded domain + respawn cycle and the full-float fallback rung. The frontend-engineer validates precision visually in Phase 4 and may pin a preset's domain scale; flagged for `AGENT_NOTES.md`.
  - **`EXT_color_buffer_float` is a hard gate** — clients without it (old/locked-down WebGL2) get the poster, not the field. Accepted: it is the honest floor (you cannot run a float GPGPU sim without renderable float targets), and the poster (ADR-004) is a first-class surface, not a stub.
  - **`GPUComputationRenderer` is `three/examples`**, not core three — version-coupled to the installed three. Mitigated: it is vendored-stable, MIT, and the escape hatch (hand-rolled ping-pong) is documented if it ever breaks against a three upgrade.
  - **Continuous `frameloop="always"`** is inherently more main-thread/GPU-hungry than apex's `demand`; this is intrinsic to an audio-reactive field and is why the canvas route's perf is **measured + documented separately** (not Lighthouse-asserted — the spec's honest stance, the apex precedent).

- **Follow-up tasks.**
  - **Task 1.1 (frontend-engineer):** set the CSP/security headers in `next.config.ts` to the exact production string above + the dev-only `'unsafe-eval'`/`ws:` branch (mirror atrium's `headers()` dev/prod split); `output: 'standalone'` + the one-hop `outputFileTracingRoot` (the apex/atrium Windows-safe `fileURLToPath(new URL('../', import.meta.url))` form).
  - **Task 1.3 (frontend-engineer):** the `next/dynamic ssr:false` smoke Canvas + a minimal `EffectComposer`/bloom + the `detectGpuTier()` probe (WebGL2 + `EXT_color_buffer_float` + the heuristic) routing failure to a placeholder poster; **verify the chunk is out of the initial bundle and runs with ZERO CSP violations under `next build && next start`** (NOT `next dev`); record the verified CSP + the "no WASM / no `'unsafe-eval'`" confirmation in `AGENT_NOTES.md`.
  - **Task 4.1 (frontend-engineer):** the `GPUComputationRenderer` two-variable sim + the curl-noise advection GLSL + index→UV `reference` attribute (built once) + respawn/lifetime; prove **262k at locked 60 fps** at the default tier before audio/post. Validate half-float precision; record the domain scale in `AGENT_NOTES.md`.
  - **Task 4.2/4.3 (frontend-engineer):** the `THREE.Points` additive render + palette ramp + pointer wake; the `EffectComposer` (bloom/vignette/aberration) in the single render pass.
  - **Phase 4 (frontend-engineer):** tune the `PerformanceMonitor` thresholds + the adapt-up-to-ultra rule against the deployed profile; record in `AGENT_NOTES.md`.
  - **Phase 6.3 (reviewer):** verify the zero-per-particle-CPU-work invariant, the FBO ping-pong correctness (no same-texture read/write), the code-split, the capability gate, the WebGL-context + render-target teardown, and zero CSP violations.

### References

- **apex `DECISIONS.md` ADR-002 §2–§5 + `web/next.config.ts`.** The inherited R3F/Next integration (`next/dynamic ssr:false`, Suspense + `<Loader>`, low `'use client'`, capped `dpr`, `PerformanceMonitor`/`AdaptiveDpr`, the `detectWebglTier()` capability-gate shape) and the **verified eval-free CSP** (three.js + R3F + drei + post need no `eval`; apex even dropped `'wasm-unsafe-eval'` once it shipped uncompressed assets) that nocturne carries forward and **tightens** (no WASM; `connect-src 'self'`).
- **apex `DECISIONS.md` ADR-004.** The static-still→live-canvas reveal-when-ready / LCP-is-never-the-canvas pattern nocturne reuses as the poster→live-field hand-off (pinned in ADR-004 here).
- **atrium `web/next.config.ts`.** The `headers()` dev/prod CSP split (the dev-only `'unsafe-eval'` + `ws:`/`wss:` relaxation; the eval-free production build) copied here.
- **three.js `GPUComputationRenderer`** (`three/examples/jsm/misc/GPUComputationRenderer.js`, MIT). **R3F / drei** — `next/dynamic ssr:false`, `Suspense`, `<Loader>`/`useProgress`, `<PerformanceMonitor>`, `<AdaptiveDpr>`. **`@react-three/postprocessing`** — `EffectComposer`, `Bloom`, `Vignette`, `ChromaticAberration`.
- **ADR-001** — the R3F single-family posture + custom-GLSL mandate this ADR realizes. **ADR-003** — the AnalyserNode pipeline whose `media-src` allowance this CSP carries. **ADR-004** — the tiers' reduced-motion/no-WebGL behaviors + the poster reveal.

---

## ADR-003: The Web Audio reactivity pipeline — the three-source graph, the autoplay gesture-gate contract, the pure band-reduction + envelope, the uniform mapping, the idle drift, and the teardown contract

**Status:** accepted
**Date:** 2026-06-14

### Context

ADR-001 named audio reactivity nocturne's defining feature (the field **breathes with the music**) and deferred the pipeline. This ADR (Task 0.2) pins the Web Audio graph, the three sources, the browser-autoplay gesture-gate contract (the cinematic intro doubles as the gate), the pure band-reduction + envelope (testable without audio — the Vitest target), the exact audio→uniform mapping (ADR-002's uniform contract), the silence/idle behavior, and the leak-free teardown the `reviewer` checks. The CSP allowance this drives (`media-src 'self' blob:`) and the AnalyserNode-over-AudioWorklet decision are already pinned in ADR-002 §6.

### Options considered

**Off-main-thread vs main-thread analysis:** resolved in ADR-002 §6 — **main-thread `AnalyserNode`** (one rAF-aligned read), to keep the CSP free of worklet `blob:` and because a single FFT read per frame is cheap. Recorded here as the pipeline's spine.

**The built-in track source node:**

- **A. `MediaElementAudioSourceNode` over an `<audio>` element (bundled CC0 track + the uploaded file). Picked.** A real `<audio>` element gives free transport (play/pause/seek/loop/`currentTime`), native streaming of the bundled asset (no full decode-into-memory needed), an accessible media element, and `loop` for the always-on default track. The same node type serves the **uploaded file** (set `<audio>.src` to the file's object URL). One code path for both file-backed sources. **Picked.**
- **B. `decodeAudioData` → `AudioBufferSourceNode`.** Decodes the whole file into memory; needed only for sample-accurate scheduling nocturne does not require, and it loads the entire track into RAM (worse for a long bundled track). **Rejected** for the default + upload; the `<audio>` element path is lighter and gives transport for free. (`decodeAudioData` is noted as the path **only** if a future feature needs precise loop points or waveform scrubbing — v2.)

**Mic source:** `getUserMedia({ audio: true })` → `MediaStreamAudioSourceNode` — the only option for live input; pinned below with the permission/denial UX.

### Decision

**1. The Web Audio graph — three sources into one shared `AnalyserNode`.**

```
[built-in <audio> (CC0 loop)] ─┐
[uploaded <audio> (blob: URL)] ─┼─▶ MediaElementAudioSourceNode ─┐
[mic MediaStream] ─────────────┴─▶ MediaStreamAudioSourceNode ───┼─▶ GainNode ─▶ AnalyserNode ─▶ (destination*)
```

- **One `AudioContext`, one shared `AnalyserNode`, created lazily on the first user gesture** (never at module load — that would violate autoplay policy and waste a context). Source switching disconnects the previous source node from the gain and connects the new one into the **same** gain→analyser chain — the analyser and the render-loop read path never rebuild (ADR-001's "swap the upstream node into the same analyser" requirement).
- **\*destination routing:** the **built-in track and the uploaded file connect to `audioContext.destination`** (the user hears them). The **mic does NOT connect to destination** (that would feed back / echo the room) — the mic path is `MediaStreamAudioSourceNode → analyser` only (analyser does not require a destination connection to run; it taps the signal). A `GainNode` before the analyser is the master mute/volume the HUD controls (mute = gain 0, which mutes the audible output but the analyser still sees the signal — so the field can keep reacting while muted if the user wants "visuals without sound," or the gain can sit before a split; v1 keeps it simple: mute sets gain 0 and the field falls to idle drift).
- **A single `MediaElementAudioSourceNode` per `<audio>` element.** Important Web Audio rule the engineer must honor: an `HTMLMediaElement` can have **at most one** `MediaElementAudioSourceNode` created for it (a second `createMediaElementSource` on the same element throws). So the built-in `<audio>` and the upload `<audio>` are **two distinct elements**, each wrapped once; switching toggles which element plays and which source node is connected to the gain.

**2. The autoplay gesture-gate contract (the cinematic intro IS the gate).** Browsers block audio before a user gesture and start the `AudioContext` `suspended`. The contract:

- On first paint the route shows the **poster + the intro** ("NOCTURNE / one line of positioning / a real `<button>`: _Press to begin_ / _Sound on_"). **No `AudioContext` exists yet; no audio plays; the live field is not looping** (ADR-002: pre-armed = no render loop).
- **On the gesture (click / Enter / Space / touch on the real button):** (1) create the `AudioContext` (if not created), (2) **`await audioContext.resume()`** (resumes from `suspended` — the load-bearing autoplay-policy step), (3) call `<audio>.play()` on the built-in track (now permitted, inside the gesture), (4) **arm the field** (start the render loop, begin the poster→live-field cross-fade — ADR-004). This single gesture turns the autoplay constraint into the designed five-second-wow moment: sound on, the field surges alive.
- **The gate is fully accessible** — a real focusable `<button>` with a real label, operable by keyboard, not a canvas click target.
- **Reduced-motion interaction (ADR-004):** under `prefers-reduced-motion`, **audio still never auto-starts** — the gate is still required, and if the user proceeds, the reduced-motion branch governs motion (calm drift, muted reactivity) but audio only ever begins on the explicit gesture. (No autoplay under reduced-motion, per the planner's hard rule, `AGENT_NOTES.md` #4.)

**3. The pure band-reduction + envelope (the Vitest target — testable with zero Web Audio).**

- **AnalyserNode config:** `fftSize = 2048` (→ `frequencyBinCount = 1024` bins), `smoothingTimeConstant = 0.8` (the analyser's own light temporal smoothing; the musical envelope is layered on top, below), `minDecibels`/`maxDecibels` left at defaults (−100 / −30) for `getByteFrequencyData`'s 0–255 mapping. The render loop calls `getByteFrequencyData(uint8Array)` **once per frame**.
- **`reduceBands(bins: Uint8Array | number[], sampleRate: number, fftSize: number): RawBands` — a PURE function in `src/lib/audio/reduce-bands.ts`.** Maps the linear FFT bins to frequency-defined bands by bin index (each bin = `sampleRate / fftSize` Hz wide; at 44.1 kHz / 2048 ≈ 21.5 Hz/bin):
  - `subBass` ≈ 20–60 Hz, `bass` ≈ 60–250 Hz, `mid` ≈ 250–2000 Hz, `high` ≈ 2000–8000 Hz (above ~8 kHz contributes little perceptual energy and is folded into `high`). Each band = the **mean** (or a perceptual RMS) of its bins, normalized to [0,1].
  - `rms` = the overall energy = the normalized root-mean-square across all (or a perceptually weighted subset of) bins → the "loudness" envelope.
  - **Pure, deterministic, no React, no Web Audio singletons** — takes a bins array + the two scalars, returns `{ subBass, bass, mid, high, rms }`. Vitest covers: silence (all-zero bins → all-zero bands), full-scale (all-255 → ~1.0), a single-band spike (only bass bins hot → bass high, others low), empty/short bins (graceful), and the bin→Hz boundary math.
- **`applyEnvelope(prev: Bands, raw: RawBands, attack: number, release: number, dt: number): Bands` — a second PURE function.** Per-band attack/release smoothing so the visuals **breathe, not strobe**: on a rising value use the fast **attack** coefficient (the field surges quickly on the kick); on a falling value use the slower **release** coefficient (the field eases down musically). `coeff = 1 - exp(-dt / tau)` per direction; `next = prev + (raw - prev) * coeff`. Attack ~30–60 ms, release ~250–400 ms (tuned in Phase 4; defaults recorded). Pure (prev + raw + constants → next), deterministic, Vitest-covered (a step input rises fast then decays slow; constant input converges; `dt` independence within tolerance). **The render loop holds the `prev` Bands in a ref and feeds them back each frame** — the only state, outside the pure function.

**4. The exact audio→uniform mapping (ADR-002's uniform contract, the smoothed Bands as input):**

| Band (smoothed) | Drives                                                  | Effect                                                                                       |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `bass`          | `uTurbulence` + `uFlowEnergy`                           | the field **surges on the kick** (more curl turbulence, more flow energy)                    |
| `mid`           | `uSpread` (particle motion/spread)                      | mids open the field's motion/spread                                                          |
| `high`          | `uColorShift` + `uSparkle`                              | highs **shimmer** the color ramp + sparkle the point size                                    |
| `rms`           | `uBloomStrength` + `uVignette` (+ gentle `uAberration`) | overall energy **blooms** the glow + breathes the vignette — the field brightens on the beat |

Each mapping is `uniform = base(preset, cross-faded) + gain * band` (the audio modulates **around** the preset's cross-faded base — ADR-004 owns the base; this ADR owns the modulation). Gains are per-preset constants (a "molten" preset reacts harder than a "glacial" one) — part of the `Preset` schema (Task 3.1).

**5. Silence / no-audio idle behavior — a gentle autonomous drift (the field is never dead).** When there is no audio (muted, between tracks, mic silent, or the bands are all near-zero), the bands **floor to a small idle baseline** (not literally zero) so the curl-noise field keeps a **gentle autonomous drift** — `uFlowSpeed`/`uTurbulence` retain a low idle value and `uTime` keeps advancing, so the field breathes slowly on its own. This is also the **reduced-motion calm-drift** source (ADR-004): the same idle-baseline path, with audio reactivity muted. The field is **never a frozen dead canvas** while armed.

**6. The three sources — UX + privacy.**

- **Built-in CC0 track (default):** a same-origin static asset, `loop`, started on the gesture gate. **Provenance requirement (do NOT invent a track):** the frontend-engineer / doc-writer must **source a real CC0 / royalty-free track** (e.g. from a documented CC0 source) and **credit it** in `AGENT_NOTES.md` + the README + an in-UI credits line (the apex CC0-provenance discipline). This ADR does **not** name a specific track — sourcing a real, license-clear file with documented provenance is a Phase-3/Phase-8 task; shipping an unlicensed or invented track is a blocker the `reviewer` checks.
- **Microphone:** the HUD's mic option calls `getUserMedia({ audio: true })` **only on explicit user action** (clicking the mic source). UX: a clear label ("Use microphone — the field reacts to the room"), a permission prompt (browser-native), and a **graceful denial path** (if denied or unavailable, show a non-blocking notice and fall back to the previous source — never a broken state). **Hide/disable the mic option in insecure contexts** (`!window.isSecureContext` or `!navigator.mediaDevices?.getUserMedia` — e.g. non-HTTPS, or browsers without the API) rather than offering a control that will throw. When live, a clear "mic is live" indicator. The mic stream is **never connected to destination** (no feedback) and **never leaves the browser**.
- **File upload:** an accessible file input (`accept="audio/*"`); the selected `File` becomes an **object URL** (`URL.createObjectURL`) set as the upload `<audio>.src` — decoded/played **entirely in the browser**, **never uploaded anywhere** (stated in the README for privacy). The object URL is **revoked** (`URL.revokeObjectURL`) when the file is replaced or on teardown (no leaked blob URLs).

**7. The teardown / cleanup contract (the `reviewer` checks this — no leaked AudioContexts / live mic tracks).** On unmount **and on every source switch**:

- **Source switch:** disconnect the outgoing source node from the gain; if switching **away from mic**, **stop every track** on the `MediaStream` (`stream.getTracks().forEach(t => t.stop())`) so the OS mic indicator goes off; if switching **away from upload**, `revokeObjectURL` the previous object URL; pause the outgoing `<audio>`.
- **Unmount:** stop the render loop; disconnect all nodes; **stop any live mic tracks**; pause both `<audio>` elements; `revokeObjectURL` any upload URL; **`audioContext.close()`** (releases the context — no leaked AudioContexts, the explicit reviewer item); null the refs. The pure functions hold no resources, so only the imperative graph + the mic stream + the object URL need teardown.
- **One AudioContext for the lifetime of the armed experience** (created on the gate, closed on unmount) — not one-per-source-switch. The `reviewer` verifies a single context, mic tracks stopped on switch-away and unmount, and no orphaned object URLs.

### Consequences

- **Positive.**
  - One shared `AnalyserNode` behind a `GainNode` with sources swapped upstream means **source switching never rebuilds the read path** — the render loop's per-frame `getByteFrequencyData` is stable across built-in/mic/upload.
  - The **band-reduction + envelope are pure functions** with no Web Audio dependency, so the breathing behavior (attack/release, the bin→Hz math, silence/clipping edges) is **fully Vitest-tested without a real audio device** — the spec's testability requirement met by construction.
  - The **gesture gate turns the autoplay constraint into the cinematic intro** (sound-on = the wow), is fully accessible (a real button), and guarantees **no autoplay** (including under reduced-motion) — the planner's hard rule honored.
  - The **idle drift** means the field is **never dead** (muted, silent mic, between tracks, or reduced-motion) — it always breathes, which is also the reduced-motion calm-drift source (ADR-004 reuses this path).
  - **AnalyserNode (not AudioWorklet)** keeps the CSP free of worklet `blob:` script — the tightest CSP (ADR-002 §6).
  - **Privacy is clean:** mic never hits destination or the network; upload never leaves the browser (object URL only); the teardown stops mic tracks and revokes URLs — a small, auditable surface.

- **Negative.**
  - `MediaElementAudioSourceNode`'s "one source node per element" rule means **two `<audio>` elements** (built-in + upload) — a minor structural constraint the engineer must respect (documented; the alternative — recreating source nodes — throws).
  - Mic permission UX has **many failure modes** (denied, dismissed, no device, insecure context) — each needs a graceful, non-blocking path; mitigated by hiding the option in insecure contexts and falling back to the prior source on denial, and by the test-engineer mocking the permission paths (Phase 7).
  - **Cleanup is imperative and leak-prone** (contexts, mic tracks, object URLs) — exactly why it is a named reviewer item; the contract above enumerates every resource to release.
  - **`smoothingTimeConstant` + the attack/release envelope** stack two smoothings; if over-smoothed the field feels sluggish, if under-smoothed it strobes — tuned in Phase 4 against real tracks; the envelope constants are recorded in `AGENT_NOTES.md`.

- **Follow-up tasks.**
  - **Task 3.1 (frontend-engineer):** the `audio-bands` Zod schema (`{ subBass, bass, mid, high, rms }`) + the `audio-source` schema + the per-preset audio-gain fields on `Preset`.
  - **Task 3.3 (frontend-engineer):** the pure `reduceBands` + `applyEnvelope` in `src/lib/audio/` per the contracts above (no React, no Web Audio singletons).
  - **Task 4.4 (frontend-engineer):** the Web Audio graph (one context, one gain, one analyser, the two `<audio>` elements + the mic source-node switching), the **gesture gate** (create context → `resume()` → `play()` → arm field), the source switching + mic-permission/denial + upload object-URL + the full **teardown contract**, and the band→uniform mapping wired into the engine.
  - **Task 3.2 / Phase 8 (frontend-engineer / doc-writer):** **source a real CC0 / royalty-free track**, bundle it as a same-origin static asset, and document its provenance + license in `AGENT_NOTES.md` + README + the in-UI credits line. (Do NOT ship an invented or unlicensed track — a reviewer blocker.)
  - **Task 7.1 (test-engineer):** Vitest for `reduceBands` (silence, full-scale, single-band spike, bin→Hz boundaries, empty bins) and `applyEnvelope` (fast-attack/slow-release step response, convergence, `dt` independence). **Task 7.2:** Playwright for the gesture-gate → arm path, the source picker (built-in start, mic-permission-mock denied→graceful, upload-accept), and the no-autoplay-under-reduced-motion path.
  - **Phase 6.3 (reviewer):** audit the teardown — one AudioContext (closed on unmount), mic tracks stopped on switch-away + unmount, object URLs revoked, no leaked nodes/contexts.

### References

- **ADR-002 §6** — the AnalyserNode-over-AudioWorklet decision + the `media-src 'self' blob:` CSP allowance this pipeline drives + the single `useFrame` that reads the analyser once per frame. **ADR-001** — audio reactivity as the defining feature + the CC0-provenance discipline (the apex precedent). **ADR-004** — the gesture gate arms the poster→live cross-fade; the idle drift is the reduced-motion calm-drift source.
- **apex `AGENT_NOTES.md` / `CREDITS.md` (CC0 model provenance).** The provenance discipline nocturne mirrors for the CC0 audio track + the font.
- **Web Audio API** — `AudioContext` (suspended-until-gesture, `resume()`, `close()`), `AnalyserNode` (`fftSize`, `smoothingTimeConstant`, `getByteFrequencyData`), `MediaElementAudioSourceNode` (one-per-element rule), `MediaStreamAudioSourceNode` (mic, no-destination), `GainNode` (master mute/volume), `getUserMedia` (secure-context + permission), `URL.createObjectURL`/`revokeObjectURL` (upload privacy + leak-free teardown).

---

## ADR-004: Reduced-motion, the four-tier degradation, the poster→live-field hand-off, and the chrome-theme / stage-dark contract

**Status:** accepted
**Date:** 2026-06-14

### Context

This ADR (Task 0.3) pins the contracts that keep nocturne working for **everyone who arrives** — the capability probe order and decision tree, the four tiers (full / reduced-capability / reduced-motion / no-WebGL), the poster→live-field hand-off (the LCP is the poster, never the canvas — the apex reveal-when-ready pattern), the chrome-themes-light/dark-but-the-stage-stays-dark rule, and the canvas's `aria-hidden` decorative + text-alternative + keyboard-operable-HUD a11y contract. It builds on ADR-002 (the capability gate + the tiers + the continuous loop) and ADR-003 (the gesture gate + the idle-drift = calm-drift source). It resolves the planner's open flag (`AGENT_NOTES.md` #4): **the reduced-motion default — calm auto-drift vs still.**

### Options considered

**The reduced-motion default (the open planner flag):**

- **RM-A. Calm autonomous drift by default, with audio reactivity muted, bloom-pulsing off, pointer wake gentle/off — and a user toggle to a full still. Picked.** A sighted `prefers-reduced-motion` user can tell a field _should_ be alive; a frozen canvas reads as **broken**, not as a considered reduced-motion state. The reduced-motion intent is "no **audio-violent**, strobing, beat-driven motion" — not "no motion at all." A **gentle, slow, non-pulsing curl drift** (the ADR-003 idle-drift path: small fixed `uFlowSpeed`/`uTurbulence`, `uTime` advancing, **no** `rms`-driven bloom breathing, **no** bass-surge, pointer wake gentle or off) honors the intent without feeling dead. Presets still **re-skin** (a look/color change is not violent motion). **Audio never auto-starts** (ADR-003). **Picked** — calm drift as default, with an accessible "Still" toggle for users who want zero motion.
- **RM-B. A still composed frame by default (the poster).** Simplest and maximally cautious, but reads as broken to a sighted reduced-motion user and throws away the (calm, non-strobing) beauty the field can still offer within the reduced-motion contract. **Rejected as the default**, but offered as the **explicit user toggle** (and it is exactly the Tier-4 poster surface, so it is free to provide).
- **RM-C. Honor reduced-motion only by removing the bloom pulse but keep the full field motion.** Insufficient — the bass-surge + beat-driven motion is itself the "audio-violent motion" reduced-motion forbids; removing only the bloom pulse would still strobe the field. **Rejected.**

**The poster→live hand-off:** resolved by **inheriting apex's reveal-when-ready S1 pattern** (the static AVIF is the LCP and stays the visible surface; the live canvas mounts behind it in the same reserved box and cross-fades in only once ready) — re-pinned below for nocturne's poster→field case. Alternatives (mount-live-immediately; no-hand-off) were rejected in apex ADR-004 for the same reasons (canvas-as-LCP; empty-canvas flash) and are not re-litigated.

**The chrome-theme / stage-dark rule:**

- **T-A. Light/dark themes apply to the HUD + `/about` + non-canvas surfaces only; the canvas STAGE stays dark-cinematic in BOTH themes. Picked.** The particle field is **additive luminous color glowing against black** — it _needs_ the dark to glow (a luminous additive field on a light ground washes out to invisible grey mud). You do not "light-mode" a fireworks display. So `next-themes` themes the **chrome** (HUD ink, scrims, `/about`, the poster surround) but the **stage is fixed-dark** in both themes. **Picked** (the planner's recommendation, ratified).
- **T-B. A genuine light theme for the canvas too.** Would require re-authoring every preset's palette + blending for a light ground (alpha-over instead of additive), doubling the art direction for a surface that is design-true dark. **Rejected** — it fights the medium and the sovereign dark-canonical identity (ADR-001).

### Decision

**1. The capability probe order + the decision tree (the frontend-engineer implements this FIRST — the gate that routes every client).** A synchronous `detectGpuTier()` (ADR-002 §4) runs before the Canvas mounts:

```
1. JS disabled / hydration fails ─────────────────────────▶ Tier 4 (server-rendered poster + preset directory DOM)
2. getContext('webgl2') === null ─────────────────────────▶ Tier 4 (poster)
3. getExtension('EXT_color_buffer_float') === null ───────▶ Tier 4 (poster)   ← the GPGPU float hard gate
4. prefers-reduced-motion: reduce ────────────────────────▶ Tier 3-RM (calm drift, audio muted, no autoplay; "Still" toggle → poster)
5. prefers-reduced-data / coarse-pointer+small-viewport ──▶ Tier 2 at tier "low" (reduced capability)
6. cores/deviceMemory heuristic ──────────────────────────▶ Tier 1 at tier low|mid|high (default high on capable desktop)
       └─ runtime PerformanceMonitor may demote (→ low → … → poster) or promote (→ ultra)
```

Reduced-motion (step 4) is checked **before** the capability-down-tiering (step 5–6) for the _motion_ decision, but a reduced-motion client that is **also** low-capability still gets the lower particle count — i.e. reduced-motion governs _motion/audio_, the capability heuristic governs _count/DPR/post_; they compose. A reduced-motion client that lacks the float extension still goes to Tier 4 (poster) — the poster is a valid reduced-motion surface too.

**2. The four tiers (precise behaviors):**

- **Tier 1 — full cinema (WebGL2 + `EXT_color_buffer_float` + capable GPU + motion OK + armed):** the full GPGPU field at the device's count (low/mid/**high default**/ultra-by-adaptation), live audio reactivity (built-in/mic/upload), pointer/touch wake, preset cross-fades, full post (bloom/vignette/aberration). The continuous loop (ADR-002 §5), paused when hidden.
- **Tier 2 — reduced capability (WebGL2 + float OK, but low tier — mobile / weak GPU / reduced-data):** the **same engine at a smaller N + lower DPR + simpler post** (ADR-002 tier table: low/mid). Still alive, still audio-reactive, touch wake. The `PerformanceMonitor` keeps it from janking (demotes DPR/post, then count, then — at the floor — the poster).
- **Tier 3-RM — `prefers-reduced-motion` (capability may still allow the field):** the **calm autonomous drift** (RM-A) — the ADR-003 idle-drift path: gentle slow curl, **audio reactivity muted** (no bass-surge, no rms-bloom-pulse), **bloom pulsing off** (bloom held at a low constant), **pointer wake gentle or off**. Presets still **re-skin** (color/look change, not violent motion). **Audio never auto-starts** (ADR-003); the gate is still required and if the user starts audio, the field stays calm (reactivity stays muted) — the audio plays, the visuals do not strobe to it. An accessible **"Still" toggle** swaps to the static poster for users wanting zero motion. Nothing strobes; the field count/DPR still follow the capability heuristic.
- **Tier 4 — no-WebGL / WebGL1-only / float-FBO-unsupported / no-JS:** the **statically composed poster frame** (a pre-rendered AVIF still of the field at its most beautiful — the **LCP-grade hero image**) **+ the preset directory** (each preset as a labelled still/card — real DOM, SEO-readable) **+ the wordmark / positioning / credits / about content** — all **real server-rendered DOM**. No canvas mounts. The piece still _reads_ and communicates what it is; WebGL + audio only ever **enhance** a page that already works and is crawlable + screen-reader-legible. **First-class deliverable, not a stub.**

**3. The poster→live-field hand-off (apex reveal-when-ready S1, re-pinned).**

- **Layer model in the `/` stage (one reserved fullscreen box, back to front):** (1) the **static `next/image` AVIF poster** — `priority`, sized to the viewport box, the **LCP element**; (2) the **live R3F `<Canvas>`** (lazy `ssr:false`, ADR-002), mounted **behind** the poster in the **same reserved box** (CLS < 0.1 — the box is reserved at first paint regardless of which layer is visible); (3) the **intro / gesture gate + the HUD + the real-DOM text alternative** (always present — the a11y/no-JS floor).
- **First paint → LCP:** only the **poster** + the real-DOM intro/HUD/text are visible and counted. three.js + the engine + the shaders are code-split and load **after** LCP (ADR-002); the capability gate decides whether they load at all (Tier 4 never loads them).
- **The reveal:** on the **gesture** (ADR-003: create context → `resume()` → `play()`), the field **arms** — the render loop starts; the live Canvas signals **ready** when it has rendered its **first frame** AND the `GPUComputationRenderer` is initialized (a first-frame/onCreated flag). At that instant a short **opacity cross-fade** swaps the poster out and the live field in (the field can begin _as_ the poster's composition and surge from it for a seamless seam). The viewer **never sees an empty/loading canvas** (the poster covers boot); the **LCP is provably the poster**; there is **no CLS** (the box was reserved). If ready never fires (slow boot, runtime demotion to poster), the poster **stays** — which is the Tier-4 surface anyway, so a failed reveal degrades into the fallback, never a broken canvas.
- **The poster + per-preset directory stills are generated FROM the live engine** (so they stay faithful — `AGENT_NOTES.md` #8): an offline/manual **canvas→AVIF export** captures the hero poster + one still per preset once the engine + presets exist (Phase 5.4). Phase 1's gate stub uses a placeholder; the **real** stills replace it in Phase 5.4. The export is `next/image` AVIF, art-directed.

**4. The chrome-theme / stage-dark contract (the frontend-engineer themes to this rule).**

- `next-themes` (class strategy) themes **only the chrome + non-canvas surfaces**: the HUD ink/scrims/hairlines/focus-rings, the `/about` + credits page, and the **poster surround** (the letterbox around the poster, if any). **Dark is the canonical default** (ADR-001); light is a clean reading mode for that content. `prefers-color-scheme` respected, no FOUC (the next-themes flash-guard inline script — covered by the CSP `script-src 'unsafe-inline'`).
- **The canvas STAGE is fixed dark-cinematic in BOTH themes** — its background is a near-black stage token that does **not** vary with the theme; the field's additive palette glows against it identically in light or dark chrome. The CSS-variable split is explicit: **stage tokens** (`--stage-bg`, etc.) are theme-**invariant**; **chrome tokens** (`--hud-ink`, `--surface`, scrims, etc.) are theme-**variant**. The frontend-engineer must keep these two token families separate in `app/globals.css` (Task 2.1) so "chrome themable, stage fixed-dark" is expressed cleanly with no FOUC.
- The HUD over a bright field needs legibility: a **faint dark scrim** behind HUD text (a stage-token-derived translucency), so chrome contrast ≥ 4.5:1 holds in both themes against the (bright) field — verified in Task 2.1.

**5. Accessibility — the decorative canvas + the text alternative + the keyboard-operable HUD.**

- **The `<canvas>` is `aria-hidden="true"` decorative** — it is a presentational surface; a screen-reader gets nothing from the GPU scene directly.
- **A real-DOM text alternative** conveys the meaning: a (visually-appropriate, screen-reader-complete) description of **what nocturne is** + **what is currently playing/selected** — the current **preset name** and the current **audio source** (built-in / mic / upload) — in an `aria-live="polite"` region updated (debounced) as the user switches presets/sources, so a screen-reader/keyboard user gets the same information without the scene. The `/about` route carries the full text description + the accessibility statement.
- **The HUD + all controls are real, keyboard-operable DOM** (never canvas-only): the **gesture gate** is a real `<button>`; the **preset picker** is a keyboard-operable radio-group/menu with labels (arrow keys within, visible focus); the **audio-source picker** is real radio/buttons (built-in/mic/upload) with the mic-permission UX (ADR-003); the **controls** (intensity/calm toggle, pointer-interaction toggle, the "Still" reduced-motion toggle, mute, theme toggle) are real buttons/switches. **Brand-styled visible focus** on every control; contrast ≥ 4.5:1. The **auto-dimming HUD** (recedes after inactivity, returns on pointer move / focus) must **never become keyboard-unreachable or hidden from assistive tech** — dimming is visual opacity only; focus brings it back; it stays in the tab order and the a11y tree (Task 5.1). Mobile: the HUD reflows thumb-reachable from 320 px, touch operates the gate + wake.

### Consequences

- **Positive.**
  - The reduced-motion default is **calm drift** (RM-A), not a dead still — honoring "no audio-violent motion" without reading as broken, with a "Still" escape for zero-motion users and a hard **no-autoplay** guarantee. The calm-drift path **reuses the ADR-003 idle-drift** code (no separate engine), so it is cheap and consistent.
  - The poster→live hand-off makes the **LCP provably the poster**, with **no empty-canvas flash** (reveal waits for first-frame + init) and **no CLS** (reserved box) — the three failure modes closed by construction, exactly as apex's hero→configurator seam closed them.
  - **Four tiers are precise spec** (the float-extension hard gate, the reduced-capability count drop, the reduced-motion calm-drift, the no-WebGL/no-JS poster + directory DOM) — first-class surfaces the test-engineer + designer-critic verify, not afterthoughts. The Tier-4 poster + directory is **also** the SEO/social/screen-reader surface.
  - The **stage-stays-dark** rule is pinned with an explicit theme-invariant-vs-variant CSS-token split, so the frontend-engineer themes the chrome without ever washing out the field, with no FOUC.
  - The canvas-is-decorative + the live text alternative + the all-real-DOM keyboard-operable HUD give a screen-reader/keyboard user the **full meaning + full control** without the scene — WCAG 2.2 AA by construction.

- **Negative.**
  - **Calm drift still moves** — a small population of reduced-motion users want _zero_ motion; mitigated by the explicit accessible **"Still" toggle** (→ the poster) so they can opt to fully stop it. (Erring toward "still by default" was rejected because it reads as broken to the majority of reduced-motion users; the toggle covers the minority.)
  - **Poster fidelity depends on capturing from the live engine** (so it must exist first) — sequencing risk; mitigated by the Phase-1 placeholder → Phase-5.4 real-capture plan (`AGENT_NOTES.md` #8) and a documented canvas→AVIF export workflow.
  - **The stage-fixed-dark rule means the "light theme" is partial** (chrome only) — a reviewer/designer-critic must confirm it reads as deliberate (a dark stage in a light reading-chrome), not as a half-done theme; pinned here as the rationale they check against.
  - **Auto-dimming HUD + keyboard reachability** is a known a11y trap (a dimmed control that drops out of the tab order); explicitly forbidden here (dimming is opacity-only) and a named Task-5.1 + reviewer item.

- **Follow-up tasks.**
  - **Task 2.1 (frontend-engineer):** the CSS-variable split — theme-**invariant** stage tokens (`--stage-bg` etc.) vs theme-**variant** chrome tokens; the HUD scrim for ≥ 4.5:1 over a bright field in both themes; `next-themes` dark-default, no FOUC.
  - **Task 5.1 (frontend-engineer):** the keyboard-operable HUD (gate button, preset radio-group, audio-source picker, controls incl. the "Still" + calm toggles, theme toggle), brand focus states, the auto-dim that never drops keyboard reachability / a11y-tree presence, the 320 px thumb-reachable reflow.
  - **Task 5.3 (frontend-engineer):** the `/about` + credits surface — the full text alternative + the accessibility statement (decorative canvas, reduced-motion behavior, keyboard operation), the preset directory (= the Tier-4 directory), the CC0-track/font/library credits.
  - **Task 5.4 (frontend-engineer):** the capability gate + decision tree wiring; the four-tier branches (full / reduced-capability / reduced-motion calm-drift + "Still" toggle / no-WebGL+no-JS poster+directory DOM); **generate the poster + per-preset stills from the live engine** (canvas→AVIF) replacing the Phase-1 placeholder; the poster→live reveal-when-ready cross-fade (LCP=poster, no flash, no CLS); the `aria-hidden` canvas + the `aria-live` text alternative.
  - **Task 3.4 (frontend-engineer):** the **pure** reduced-motion branch selector + the capability-gate routing decision (the decision tree above) as pure functions (Vitest-tested, Phase 7.1).
  - **Phase 6.1 (designer-critic):** confirm the partial-light-theme reads as deliberate (stage stays dark by design); judge the poster as a genuine LCP-grade hero; run the § 14 no-sibling-re-skin gate vs apex. **Phase 7.2 (test-engineer):** Playwright for the reduced-motion path (calm/still, no autoplay), the no-WebGL fallback (poster + directory DOM), the theme toggle (stage stays dark), and the keyboard HUD.

### References

- **ADR-002** — the capability gate (`detectGpuTier()`, WebGL2 + `EXT_color_buffer_float`), the tier table (count/DPR/post per tier), the continuous-loop pause-when-hidden, the single client island this hand-off mounts. **ADR-003** — the gesture gate that arms the reveal; the **idle-drift path** that the reduced-motion calm-drift reuses; the no-autoplay rule.
- **apex `DECISIONS.md` ADR-004 (S1 reveal-when-ready) + ADR-002 §3 (LCP-is-never-the-canvas).** The static-asset-is-LCP + reveal-when-ready + reserved-box CLS-safe pattern nocturne reuses for poster→field. **razors-edge / atrium** — the no-JS static-composed-frame floor + the next-themes-no-FOUC discipline.
- **PLAN.md** — the four-tier discipline, the poster-frame + preset-directory first-class deliverable, the chrome-light/stage-dark direction, the decorative-canvas + keyboard-HUD a11y. **`AGENT_NOTES.md` #4 (reduced-motion default — resolved RM-A), #5 (stage-dark — resolved T-A), #8 (poster from the live engine).** **CLAUDE.md § 4** (WCAG 2.2 AA, reduced-motion, `next/image` AVIF, no FOUC).

---

## ADR-005 (Phase 8) — deploy posture (PENDING)

**Status:** pending — to be authored by the `architect` at Phase 8 (deploy time).

- **Fly.io single-Machine Next standalone, web-only, no secrets** — the atrium / apex / razors-edge proven web-only single-Machine standalone pattern (three-stage Linux Dockerfile building the standalone — the Windows-EPERM-avoidance lesson; `node:22-bookworm-slim` non-root runtime; one process; HTTP health check on `/`; `auto_stop_machines='stop'` + `min_machines_running=1` warm floor for the first impression; region `fra`).
- **`NEXT_PUBLIC_SITE_URL` baked at BUILD time** (canonical/OG/JSON-LD depend on it — the meld lesson). Likely 512 MB for the on-demand `next/image` AVIF optimization path (the razors-edge 256→512 OOM lesson).
- **The bundled CC0 track ships as a same-origin static asset within the CSP `media-src 'self'`** (ADR-002 §6 / ADR-003); the served CSP is the exact eval-free string in ADR-002 §6. No WASM, no `'unsafe-eval'`.
- **Precondition (like apex's P0-1):** the CC0 audio track + the font must have documented, license-clear provenance before the public deploy (ADR-003 follow-up); no invented/unlicensed track goes public — the `reviewer` blocker.
- To be finalized at deploy time once the build + assets are final.
