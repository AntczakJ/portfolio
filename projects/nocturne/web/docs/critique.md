# nocturne — designer-critic critique (2026-06-14)

Reviewer: designer-critic. Zero pochwal. Against docs/inspirations.md
(Bruno Simon; Codrops / Awwwards SOTD; Linear; Vercel; Stripe; Klim) and the
CLAUDE.md S4 quality bar + S5 design bar + S14 sovereign-token gate.

## Rendering caveat (read first)

Every live-field frame was driven through headless chromium on software-GL
SwiftShader — slow, sparse, colour-MUTED to near-grey. The field true-GPU
look (262k additive particles, audio-pulsed bloom, full-saturation palette,
60 fps) is NOT visible in any capture and is NOT judged here. Judged instead:
composition/framing/layout surviving the mute; the preset palettes as a
colour-script read from src/data/presets.ts + poster-gradient.ts not pixels;
the chrome HUD, type, spacing, hierarchy, intro gate, auto-dim; /about, the
directory, the poster, the OG image; mobile; the S14 vs-apex gate; a11y. The
scrim-over-bright-field question is reasoned analytically from the resolved
token values + a luminance probe, because SwiftShader cannot produce the bright
field that triggers it.

Frames -> web/docs/critique-shots/: intro-dark-1440.png, intro-mobile-390.png,
scrim-canvas-light-molten.png, about-light-mobile.png. Committed pass3-shots/ +
engine-shots/ also reviewed.

---

## The 3 highest-leverage changes (fix first)

1. D-01 — / and /about ignore prefers-color-scheme and force dark on first load.
   A light-OS visitor gets dark chrome; the light reading mode is unreachable
   without a manual toggle. Direct CLAUDE.md S4 violation. Root cause:
   providers.tsx sets defaultTheme=dark alongside enableSystem, and defaultTheme
   wins over system. Confirmed by probe: colorScheme:light yields html.dark.
   One-line fix.

2. D-02 — the intro wordmark clips on mobile and the positioning line dies on the
   bloom. At 390px the var(--text-6xl) clamp up to 10.5rem NOCTURNE lockup
   overflows BOTH edges, the capture reads OCTURN — accidental overflow, not a
   deliberate bleed. And on desktop + mobile the tagline -A GPU particle field
   that breathes with sound- sits over the brightest part of the bloom in
   muted-white and is barely legible. The five-second-hold surface has a broken
   headline and an unreadable subhead — the worst place to ship this.

3. D-03 — the preset cross-fade is linear; it should be eased. The morph advances
   tr.t += dt/1.4 with no curve at nocturne-field.tsx:425, so a 1.4s palette/flow
   transition arrives and departs at constant velocity. globals.css defines
   --ease-out-expo cubic-bezier(0.16,1,0.3,1) and never applies it to the
   signature transition. Per the inspirations own worked example, this is the gap
   between animated and designed. 1.4s is also slow for a re-skin you want to
   feel decisive — 0.9 to 1.1s on an eased curve reads more intentional.

---

## 1. Wow moment status

The committed wow — a GPGPU curl-noise field breathing with a Web Audio FFT,
re-skinned by presets, finished with bloom/vignette/aberration — IS present and,
per engine-verify evidence (262k particles, EXT_color_buffer_float true,
band-to-uniform mapping moving frame-to-frame, leak-free teardown), is a genuine
GPGPU sim, not a canned video or a few thousand Points. It clears the is-it-real
scrutiny the audience applies. Against Bruno Simon / Codrops the technical
ambition is at the bar; the engine is the strongest single artefact here.

What I cannot confirm and the brief defers: the finished colour + bloom + 60fps
look. So the wow is credible by construction, not verified arresting. Two
design-side risks even granting the engine:

- The five-second hero is gated behind an intro whose headline clips and whose
  subhead is illegible (D-02). The copy is good; the frame around it is not yet
  at the bar.
- The default preset is aurora (cool green ribbons), the most Codrops-generic of
  the six. A green particle nebula is the single most-seen audio-reactive demo.
  Consider arming into ink-bloom or molten-swirl for the first impression — a
  less-seen look holds longer. Art-direction call, flagged, not a blocker.

## 2. Typography

Sora (display) + Outfit (sans), both OFL variable via next/font — clean,
sovereign, distinct from siblings (apex Inter/Space Grotesk, atrium Bricolage).

- Tracking on the wordmark is over-spaced for the scale. NOCTURNE uses
  --tracking-wider 0.28em at --text-6xl. At display sizes tracking should
  decrease, not increase — Klim sets large display near 0/negative; 0.28em at
  10rem turns the wordmark into eight isolated letters rather than one lockup,
  part of why mobile reads as clipped rather than bled (D-02). Reserve
  --tracking-wider for the small spaced micro-labels (the HUD corner mark, where
  it works); the hero wants --tracking-tight.
- No variable-font axis is animated. PLAN.md and inspirations both call for
  font-variation-settings with intent — the reason a variable face was chosen.
  Sora weight axis is used only as static steps. A wordmark weight-settle on
  reveal, or the active preset label gaining weight, would convert ship-a-
  variable-font into use-the-axis. Currently wasted.
- Hierarchy on /about is solid but flat in colour. about-dark reads cleanly
  (~66ch measure, clear section heads), Klim-adjacent restraint. But every
  heading is the same ink weight/colour; no accent or scale jump lands the eye on
  The-technique vs Credits. Linear long-form varies weight + size + a hairline
  rule to chunk; here the rhythm is correct but monotone.

## 3. Hierarchy and layout

- First second on / intro: eye lands on the wordmark (correct), then should
  drop to the button. The tagline between them is a dead zone because illegible
  (D-02). Vertical rhythm is fine; contrast is the problem.
- The Tier-4 poster + directory (tier4-poster-directory.png) is the best layout
  in the project. The full-bleed NOCTURNE bleeding off the right edge inside the
  scrim card IS the confident type move the intro lacks — ironic that the no-JS
  floor out-designs the hero. The 3x2 preset grid with per-preset glow thumbnails
  reads as an intentional colour-script; the palettes are legibly distinct here.
- The armed HUD (hud-dark-desktop, hud-dark-mobile) gets out of the way: wordmark
  top-left, chrome cluster top-right, one consolidated control bar bottom-center.
  Right shape — Linear/Vercel restraint. Whitespace does work, the field owns the
  middle. No accidental grid.

## 4. Microinteractions

- Hover/focus states are honest, not lazy — no blanket transition-all; the picker
  uses scoped transition-colors, the button an explicit property list. Good.
- Auto-dim is well-built (opacity-only, focus-safe, reduced-motion-exempt) — the
  a11y trap the brief feared is genuinely avoided.
- The intro button hover is scale 1.03, the only motion in the gate. Against the
  Linear command-palette feels-alive bar the gate is static until touched. A
  faint idle shimmer on the button border or a slow breathing scrim would signal
  interactivity before the click.
- The preset label change is abrupt: on select the picker swaps bold/ink instantly
  while the field morphs for 1.4s — chrome and field disagree on timing for over a
  second. The label could ease its weight/colour over the same curve as the field
  (ties D-03 + the variable-axis note).

## 5. Motion and timing

- D-03 (linear cross-fade) is the headline motion defect — see top-3.
- Reduced-motion is correctly handled (calm drift, no autoplay, Still toggle) —
  verified via the aria-live text and route. Good.
- Intro reveal uses nocturne-rise 900ms on --ease-out-expo with a 120/240ms
  stagger — this IS the right choreography (Linear-grade curve, deliberate
  stagger). Keep it; the one place the motion vocabulary is used well. The lesson:
  apply that same curve to the field cross-fade (D-03), which currently does not
  use it.

## 6. Color and contrast

- The six presets ARE a rich, distinct set as a colour-script (read from
  presets.ts): glacial deep-navy/ice-cyan/white, molten oxblood/ember/amber,
  aurora forest/emerald/periwinkle, noir near-black/pewter/bone (deliberately
  desaturated), solar-wind umber/tangerine/cream, ink-bloom indigo/violet/lilac
  (the only alpha-blend look). Hue spread cyan/orange/green/neutral/amber/violet
  is wide and each carries its own flow + post profile — not muddy, not samey.
  PASSES. poster-gradient.ts maps the palette honestly to the directory
  thumbnails, which is why the directory reads as a colour-script and not six
  grey cards.
- D-04 scrim over a bright field: the engineer flag is REAL at peak bloom.
  --stage-scrim = oklch(0.1 0.025 274 / 0.62). Reasoned worst case: a mid-bright
  molten pixel L~0.35 under the 62 percent near-black scrim composites to L~0.14;
  near-white HUD ink L~0.84 yields ~4.7:1, scrapes AA. At the ADDITIVE PEAK
  (bloom blowing toward white, L~0.9) the composite rises to L~0.35 and contrast
  falls to ~2.2:1 — FAILS AA. The committed hud-light-desktop.png already shows
  the bottom bar washing out on muted SwiftShader. The scrim is tuned for an
  average field, not the worst-case bloom-over-HUD molten/solar-wind produce on a
  real GPU. Fix: raise --stage-scrim toward oklch(0.08 / 0.78), or apply the
  existing --stage-scrim-strong to the bottom control bar specifically, and/or
  add a soft shadow gradient under the HUD bars so legibility never depends on the
  field. Verify at peak bloom of the two hottest presets.
- D-05 — --hud-hairline over a bright field is decorative-only and may vanish.
  The dividers oklch(0.4 / 0.55) sit on the same washed ground; not text so not
  an AA item, but they disappear over a bright field, so the control groups lose
  their separation exactly when the field is most active. Tie the divider to the
  scrim layer, not the field.

## 7. Responsive integrity

- 320px: no horizontal overflow on the chrome (verified by the project; directory
  and about reflow cleanly). BUT the intro wordmark overflows (D-02) — a 320/390
  break on the canvas overlay rather than document flow.
- 390px: intro wordmark clipped (D-02); the HUD control bar reflows to a stacked
  thumb-reachable layout (hud-dark-mobile) — good.
- 1440px: the reviewed default; HUD framing correct.
- 2560px: not captured but a source concern — the HUD bars are inset-x-0
  full-width with centered content and the field is fullscreen; at 2560 the bottom
  bar max-w-96vw stretches the panel very wide and the top wordmark/chrome sit in
  far corners with a large dead middle. Cap the HUD bars with a max-w so the
  instrument stays a compact lockup on ultra-wide.

## 8. Defect ledger

| ID   | Severity | Location                                                                                 | Defect                                                                                                                                        | Suggested fix                                                                                                                                                                                       |
| ---- | -------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | high     | src/components/providers.tsx ThemeProvider                                               | / and /about ignore prefers-color-scheme; light-OS users get dark on first load (CLAUDE.md S4). Confirmed colorScheme:light yields html.dark. | Set defaultTheme=system, keep enableSystem; keep the two-theme list if no system-cycle UI is wanted.                                                                                                |
| D-02 | high     | src/components/stage/intro-overlay.tsx:31 wordmark --text-6xl; :39-44 tagline over bloom | Mobile wordmark overflows both edges (reads OCTURN); tagline illegible over the bloom on desktop + mobile.                                    | Cap the intro wordmark viewport-aware clamp(2.6rem,14vw,10.5rem) + --tracking-tight at this scale; scrim/text-shadow behind the tagline or move it below the button so it never sits on peak bloom. |
| D-03 | high     | src/components/stage/nocturne-field.tsx:425                                              | Preset cross-fade is linear (tr.t += dt/1.4); signature transition uses no easing despite --ease-out-expo existing.                           | Ease tr.t through easeOutQuart / the expo curve before sampling crossfadePresets; consider ~1.0s.                                                                                                   |
| D-04 | high     | src/app/globals.css:113 --stage-scrim; hud.tsx:176,195 .hud-scrim on bars                | Scrim 62 percent near-black fails AA for HUD ink at the field additive bloom peak (~2.2:1 reasoned); already washing on muted captures.       | Strengthen --stage-scrim to ~0.78 alpha or apply --stage-scrim-strong to the bottom bar; add a soft shadow gradient so legibility is field-independent. Re-verify at molten/solar-wind peak.        |
| D-05 | medium   | src/app/globals.css:149 --hud-hairline; hud.tsx Divider                                  | Control-group dividers vanish over a bright field, collapsing the bottom-bar grouping when the field is most active.                          | Derive the divider from the scrim layer (on the scrimmed panel), not floating over the field.                                                                                                       |
| D-06 | medium   | src/components/stage/intro-overlay.tsx:33 + src/app/globals.css:95                       | Display tracking goes the wrong way: 0.28em at hero scale fragments the lockup; Klim sets large display near 0/negative.                      | Reserve --tracking-wider for small spaced micro-labels; set the hero wordmark to --tracking-tight.                                                                                                  |
| D-07 | medium   | Sora usage across intro-overlay.tsx, preset-picker.tsx, hud.tsx                          | Variable-font weight axis loaded but never animated; PLAN.md + inspirations call for font-variation-settings with intent.                     | Animate weight on one signature moment — wordmark settle on reveal, and/or active preset label gaining weight over the cross-fade curve (ties D-03).                                                |
| D-08 | medium   | src/components/stage/hud.tsx:169,194 inset-x-0 bars                                      | At 2560px the HUD spreads full-width with a large dead middle; loses its compact-instrument lockup.                                           | Cap the HUD bars with a max-w, e.g. max-w-5xl mx-auto.                                                                                                                                              |
| D-09 | low      | src/data/presets.ts:238 DEFAULT_PRESET_ID aurora                                         | Arm-in default is the most Codrops-generic of the six; weakens the first-impression hold.                                                     | Arm into a less-seen look (ink-bloom/molten-swirl); keep aurora in the set. Art-direction call.                                                                                                     |
| D-10 | low      | src/app/opengraph-image.tsx                                                              | OG tagline runs through the center of the bloom (opengraph-image.png), reducing share-card legibility.                                        | Drop the tagline below the glow core or add a scrim band behind it (mirror D-02).                                                                                                                   |
| D-11 | low      | src/app/about/page.tsx section headings                                                  | /about heading hierarchy is correct but monotone — same ink/weight; the eye does not chunk sections.                                          | Add an accent eyebrow or a hairline rule + a weight/size jump per section (Linear long-form).                                                                                                       |
| D-12 | low      | src/components/stage/intro-overlay.tsx:45-56 begin button                                | The gate is fully static until clicked; no alive / about-to-happen cue.                                                                       | A faint breathing scrim or idle border shimmer on the begin button (motion-safe only).                                                                                                              |

---

## S14 no-sibling-re-skin gate vs apex — VERDICT: PASS

apex is the portfolio only other R3F project; S14 forbids the portfolio
collapsing into one engine re-skinned. nocturne reads as a genuinely different
project by the same author, on every axis ADR-001 names:

- Motif: apex renders a supplied GLB car (a thing, studio-lit, orbited); nocturne
  computes an abstract GPGPU curl-noise field (no model). Could not be mistaken
  for the same project — one is a product, one is weather.
- Custom GLSL: apex uses stock drei materials; nocturne is hand-written sim +
  render shaders in src/lib/glsl/. The distinguishing craft signal is present
  here and absent in apex. Verified in source.
- Palette (the S14 token gate): apex is light-canonical EV-product; nocturne is
  sovereign dark-canonical with theme-invariant --stage-\* tokens and the preset
  ramps carrying the colour. Checked globals.css against the S14 black-list — the
  OKLCH values are freshly authored (indigo-black ground, periwinkle accent), no
  value reused from apex/atrium/the others.
- Interaction: apex = orbit + material swatches + reservation wizard; nocturne =
  audio + pointer field + preset morph. Different inputs, different outputs.
- Post: apex essentially none; nocturne is cinematically post-processed as core
  identity.

The gate PASSES. Caveat that does NOT change the verdict: the chrome SHAPE (a
dark fullscreen R3F canvas with a minimal corner HUD + a capability-gated poster
fallback + the next/dynamic ssr:false reveal) is consciously inherited from apex
patterns. That is allowed — integration discipline, not visual identity — and the
visual surface diverges hard enough that no viewer would read apex-with-particles.
The divergence rests entirely on the field + palette + audio, exactly where it
should rest. PASS.

---

## Reference scorecard

- Bruno Simon / Codrops: engine ambition at the bar (credible by construction;
  final look unverifiable headless). Default preset is the most Codrops-generic
  of the six (D-09).
- Linear: intro reveal choreography matches the bar; the field cross-fade does
  NOT (D-03); /about hierarchy is monotone vs Linear long-form (D-11).
- Vercel: HUD restraint / dark-surface discipline — met.
- Klim: wordmark tracking is the wrong direction at display scale (D-06); the
  Tier-4 directory lockup, by contrast, IS Klim-grade.
- Stripe: WebGL-justifies-its-bundle — met (genuine GPGPU, code-split).
