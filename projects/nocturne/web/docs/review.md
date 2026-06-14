# nocturne - code review (final gate before test/docs/deploy)

Reviewer: reviewer subagent. Date: 2026-06-14. Scope: full frontend Pass 1-3 -
GPGPU engine, GLSL, Web Audio runtime, R3F lifecycle, CSP, conventions, a11y -
against ADR-001..ADR-004.

## Verdict: APPROVE-WITH-NITS

Blockers: 0. No security hole, crash, CSP violation, or correctness defect in the
load-bearing GPGPU / 60 fps invariant. One HIGH item is a real functional bug on a
labelled control (mute) to fix before deploy; it does not block the commit.

Local checks: tsc --noEmit clean. eslint clean. 116/116 Vitest green. next build
compile clean; standalone-trace hits the documented Windows EBUSY host gotcha
(AGENT_NOTES) - resolved at deploy in the Linux Docker stage, not a code defect.

---

## HIGH (fix before deploy; not a commit blocker)

### H1. Mute does not mute audible output (contradicts ADR-003 sec 1)

audio-engine.ts routes every audible source DIRECTLY to ctx.destination, bypassing
the master GainNode:

- connectSynth: out.connect(gain) [analyser] AND out.connect(ctx.destination) [audible].
- connectUpload: src.connect(gain) AND src.connect(ctx.destination).
- master gain only feeds the analyser (gain.connect(analyser) in arm); analyser is
  never connected to destination.

setMuted(true) ramps gain.gain to 0, silencing only the analyser feed, so the field
falls to idle drift while the user STILL HEARS the audio. ADR-003 sec 1 says mute=
gain 0 mutes the audible output and the field falls to idle. A Mute button that does
not stop sound is a user-visible wrong behaviour.

Fix: route the audible path THROUGH the master gain (gain to analyser AND gain to
ctx.destination; sources connect only to gain), so gain=0 mutes sound + reactivity.
Mic must still NOT reach destination. Secondary: audioReactive is independent of
muted, so a muted live field keeps reacting to the still-audible synth.

---

## NITS (defer if cheap)

### N1. Per-frame allocation in useFrame (minor GC pressure)

nocturne-field.tsx allocates a fresh 5-field raw band object per frame (~L310-316)
and two 4-element pointer arrays (~L352-354). BOUNDED (not per-particle), so the
zero-per-particle-CPU 60 fps invariant HOLDS. Free to hoist into reusable refs and
mutate in place. applyEnvelope also returns a fresh object (pure by design) -
acceptable. Cosmetic; not required for the perf claim.

### N2. connectSynth uses Math.random() for oscillator detune

(Math.random()-0.5)\*12. Harmless for an ambient pad; house rule prefers seeded
determinism. The one non-deterministic seed in the runtime.

### N3. Pointer wake hard-codes the world scale (\*3.2)

Magic constant decoupled from camera (z=9, fov 50) and preset domainScale (2.4-5.0),
so attractor reach is not preset-relative. Defer.

### N4. freqData initial size vs analyser binCount

Initialised new Uint8Array(FFT_SIZE/2) then replaced with new
Uint8Array(analyser.frequencyBinCount) in arm(). Both 1024 - correct, slightly
redundant. Cosmetic.

---

## Verified GREEN (the load-bearing contract)

- GPGPU: setVariableDependencies wires position AND velocity each on BOTH
  (gpgpu-sim L124-125). HalfFloat on WebGL2, Float fallback; init error -> dispose +
  poster, no crash. reference attr + seed textures built ONCE. Curl is the finite-
  difference curl of a 3-sample noise potential (divergence-free). In-shader respawn
  on the age channel from the stable seed. No same-texture read/write footgun.
- Zero-per-particle-CPU / 60 fps: single useFrame reads analyser ONCE, runs pure
  reduceBands/applyEnvelope, writes ~20 uniforms, steps sim, feeds 2 textures.
  NO per-particle loop, NO array rebuild, NO count-scaling allocation (only N1).
- Web Audio teardown (ADR-003 sec 7): one AudioContext closed on dispose; mic tracks
  stopped on switch-away + unmount; object URLs revoked on switch-away/re-upload/
  dispose; analyser+gain disconnected. arm() idempotent (no double-resume). No
  AudioContext at import/SSR. Gesture gate is a real keyboard button; no autoplay,
  including under reduced-motion.
- CSP: next.config.ts ships EXACTLY the ADR-002 sec 6 eval-free string (no unsafe-
  eval, no wasm-unsafe-eval, no WASM, connect-src self, the one media-src self blob:
  delta). Dev-only relaxation gated on NODE_ENV. zod jitless guard imported in the
  barrel + layout + providers; every route configures it before any validator runs.
- R3F lifecycle: Canvas next/dynamic ssr:false; three.js code-split. frameloop=always
  paused via shouldRunLoop (hidden/unarmed/poster). Both gotchas honoured: NO ref on
  wrapped post effects (composer reffed, passes walked by setter-shape); post useFrame
  throw-free (isVec2 guard). On unmount geometry/material/palette/sim render targets
  disposed, Points removed. No setState-in-useFrame.
- Conventions/a11y/security: strict TS, no any in load-bearing paths (uniforms typed);
  the one as-unknown-as-Record cast is the documented R3F uniform-bag shape. Four-tier
  degradation + reduced-motion + no-WebGL WIRED (routing + stage + SSR data-nojs-
  fallback), not just declared. Canvas aria-hidden; aria-live text alternative; all
  HUD controls real keyboard DOM (aria-label/aria-pressed, radiogroup picker, opacity-
  only auto-dim that keeps tab order). No secrets, no committed .env, no emojis,
  English-only. Both dangerouslySetInnerHTML sites are static app-authored JSON-LD.
- PROGRESS.md vs code: Pass-1/2/3 claims match the source on every checked point.

---

## Handoff

APPROVE-WITH-NITS. Commit may land. Before public deploy, frontend-engineer fixes H1
(mute routing) - a small localised change in audio-engine.ts. N1-N4 are optional
polish. Then test-engineer + doc-writer proceed; CC0/audio is RESOLVED (procedural
synth) for the doc-writer to credit.
