# atrium — Designer Critique 5.1

> Phase 5.1 milestone review. Zero pochwal. This is a defect ledger, not an appraisal.
> Reviewer: designer-critic. Date: 2026-06-09.
> Method: production build served via next start -p 3080, driven by headless Chromium (real
> Chrome 1440x900 @2x, 360x740, 320x700), captured in dark + light + prefers-reduced-motion,
> plus a fine-grained descent scrub sample (scrollY 300 to 1300). Source read in full.
> Screenshots in docs/critique-shots/. References used by name (per docs/inspirations.md):
> Olivier Larose, Stripe, Linear, Klim, Aristide Benoist.

## Verdict in one line

The directory, about, and bay CONTENT are genuinely first-class (Klim/Linear bar met). The wow
moment does not yet read as its own brief: the colonnade of light renders as flat venetian-blind
stripes with no perspective, the descent stalls on a static frame for its back half, the six
differently-lit rooms read as one dark room with coloured trim, and the light theme collapses
the entire atrium-of-light identity into a flat document. The re-skin gate is PASSED, but the
static hero first-frame is the weakest differentiator.

## 1. Wow-moment status

The committed wow: descend through the wordmark into an architectural atrium of light, then a
tour of six differently-lit gallery bays. Present in mechanics, NOT at the polish level the
brief required. Three concrete failures:

(a) The colonnade is not a colonnade. colonnade.tsx renders three planes of vertical
linear-gradient bars. On screen (descent-y800.png, descent-y1000.png) they read as flat beige
venetian blinds / a barcode, not architecture. Structural reasons, not tuning:

- The plane wrapper sets perspective:900px but NO child has any Z-transform or rotateX, so
  perspective is inert and the planes are dead flat. No vanishing point, no convergence, no
  implied depth beyond per-plane blur+opacity.
- Columns run edge-to-edge with no inter-column gap rhythm, so they read as a striped fill, not
  standing columns with space between them.
- No floor plane, no horizon line. The atrium has no ground, so the eye has nothing to stand the
  columns on. Olivier Larose pinned reveals always give the eye a spatial anchor (a horizon, a
  receding plane); here there is none. Compare Stripe long-form scroll, where a custom scroll
  element earns its bundle by being unmistakably the thing it depicts. This depicts stripes.

(b) The descent stalls. PLAN/ADR-003 state the descent IS the transition and the scroll never
stalls on a finished animation. It does. The wordmark scale+fade completes around scrub 0.55
(per AGENT_NOTES the scale tween finishes ~70%); from roughly scrollY 800 to 1300
(descent-y800/y1000.png) the frame is static beige stripes with no wordmark, no new event, and
the colonnade already fully in. A dead empty beat of ~0.4-0.5 viewport of pinned scroll where
nothing composes. The viewer holds a finished animation in place, the exact stall the brief
rules out.

(c) Differently-lit rooms is asserted, not shown. Across the six bays
(r-bay-tape/apex/atlas-dark.png, 11-reduced-dark-full-1440.png) each room is the same near-black
field; the hue appears only as a 2-char ordinal, a 56px rule, the wow-card 4px left border, and
a faint bottom radial wash that barely registers at viewport centre. The dominant 80% of every
bay is identical. The single strongest show-the-range lever in the whole design (ADR-001/003) is
currently decorative trim. Worse, three of six hues are the same temperature: tape (cyan ~220),
apex (blue ~255), atlas (teal-green ~175) are all cool blue-greens, so half the tour does not
change colour-temperature room to room.

At the bar: the kinetic title resolve (ghost to final clip wipe + weight settle) is a clean,
legible Aristide-Benoist-class idea and the resolved titles are sharp; the bay COPY and IA are
excellent; the directory is a genuinely strong Klim/Linear specimen.

## 2. Typography

Display face Bricolage Grotesque (variable, opsz+wght), body Inter.

- The wordmark is set as a logo, not a specimen. At first paint (01-hero-dark-1440.png) ATRIUM
  is --text-display at the DEFAULT --display-wght: 440 with tracking-tight. Against the Klim
  specimen bar this is timid: a wordmark meant to hold up as a specimen, not a logo (PLAN),
  should commit to an axis position with intent (a heavier architectural cut or a deliberately
  light hairline), tracking tuned to the size. At 10rem, 440 reads as the font neutral weight,
  an un-art-directed default.
- Optical sizing is requested but not exercised. opsz is pinned to 144 everywhere (wordmark,
  every h2, every h3). The value of a variable display face is VARYING the axes by role; pinning
  one opsz across the 12rem wordmark and the 1.4rem conviction headings wastes the axis. Wordmark
  and bay titles should sit at max opsz; the small ruled headings should drop to a lower opsz.
- Inverted weight hierarchy. Bay h2 resolves to --display-wght (440); the directory h3 and
  heading use --display-wght-bold (600). So the PRIMARY bay title is LIGHTER than the SECONDARY
  directory list, and the eye reads the directory rows as more important than the bay titles.
- Tracking on the one-liner. The lede is body-tracked directly under a 10rem wordmark at -0.03em;
  the jump from display tracking to body tracking is abrupt. A hair of negative tracking on the
  lede would tie it to the wordmark (the Stripe lede-under-display pattern).

## 3. Hierarchy and layout

- First second, hero: the eye lands correctly on ATRIUM, the one place hierarchy is unambiguous.
- First second, a bay: the eye lands on the WOW-CARD on the right (the only filled surface,
  bg-surface/50 rounded card with a coloured edge) before the TITLE on the left. The bay name
  should win; a secondary The-wow-moment panel does, because it is the only element with
  figure/ground contrast. Re-weight: the title needs a lit treatment or the card must recede.
- Bay grid is 1.05fr / 0.95fr, nearly 50/50. The supporting column (wow-card + chips) carries
  almost equal visual mass to the headline+pitch+links column, flattening the hierarchy. An
  architectural bay wants a dominant type column (e.g. 1.4/0.6), the detail column subordinate.
- Whitespace is present but not working in the bays. Each bay is min-h-[100svh] with content
  vertically centred in a sea of dark; the negative space is undifferentiated, empty not composed
  (no leading line, no floor, no light gradient anchoring the type). Contrast the directory,
  where the ruled grid makes whitespace structural. The bays should borrow that discipline.
- Directory: intentional grid, genuinely Klim/Linear. The ruled index, the hue spine on hover,
  the index/name/badge then pitch/chips then links rhythm is the best-composed surface on the
  page. No defect beyond the hue-temperature clustering in section 6.

## 4. Microinteractions

- Hover states are honest CSS transition-colors, no lazy transition:all. Good discipline, but
  minimal: the demo button is a colour-only hover, the directory row lights a 2px spine. Against
  the Linear micro-interaction bar (the this-feels-alive reference) these are merely adequate:
  no motion, no easing personality, nothing that rewards the cursor. For the front door,
  directory rows and link buttons should carry at least one considered motion cue (a hue underline
  wipe, an icon nudge). The about Back-to-directory arrow already does the right thing and is the
  only example of it on the page.
- The U2 disabled GitHub repo affordance reads acceptably as intentional (dashed, opacity-70,
  cursor-not-allowed) but at a glance still reads as disabled/failed rather than coming soon.
  Twelve dashed GitHub repo controls is a repeated low note. Consider a single explicit micro-label
  once in the directory header instead of a dashed ghost on every one of twelve.
- Scroll cue (DESCEND + bobbing arrow) is fine and correctly disabled under reduced-motion.
- Theme toggle is a CSS cross-dissolve, appropriate, no defect.

## 5. Motion and timing

- The descent easing is generic. Phase A uses power2.in on the wordmark scale and power1.in on the
  aux fade; Phase B uses power1.out on the planes. Reasonable but DEFAULTS, no choreographic
  signature. Against Olivier Larose, where the timing RELATIONSHIP between elements is the craft,
  the planes all start at the same 0.25 offset with near-identical durations (0.7/0.75/0.8), so
  the three depth planes arrive TOGETHER rather than staggered by depth, which is WHY they read as
  one flat stripe-field. Stagger the plane entrances by depth (far leads, near trails).
- The empty beat (section 1b) is a timing failure: the back ~40% of the pin has no event. Either
  shorten the pin to end when the colonnade resolves, or author a second beat into that window (a
  floor-light bloom rising, columns settling/parallaxing) so every scrub position is a composition
  (the razors-edge D-01 lesson, carried in AGENT_NOTES, applies and is violated).
- Bay pin scrub (+=0.6vh, scrub 0.5) is short and clean; the title resolve lands well. No jank
  observed across the seven pins (frame timing confirmed ~60fps in the engineer spike; I did not
  re-trace but saw no visible stutter). This part meets the bar.
- Threshold parallax (+/-6 yPercent) is so subtle it is invisible in capture, neither helps nor
  hurts. If it must read as moving through a lit doorway it needs more travel or a brightness pulse
  at the seam; right now it is motion without a perceivable reason.

## 6. Color and contrast

- Token usage is clean: no raw hex in components; per-bay hues are inline custom props off
  accentToken, the right seam. Contrast was engineered with measured ratios in both themes
  (AGENT_NOTES Phase 2). I did not find a sub-AA text pair.
- Hue-temperature clustering (the range-defeating flaw). tape 220 / apex 255 / atlas 175 are all
  cool. meld 55 / razors-edge 80 / pulse 150 span warm to green. So the tour goes cool, cool, cool
  on three of six rooms. For hues whose JOB is to make six projects feel distinct, three
  near-neighbours undercut the thesis. Re-space the wheel for separation: push apex toward a true
  steel/indigo away from tape cyan, pull atlas off tape teal. Evocation bends to SEPARATION here,
  the same way ADR-003 says contrast bends evocation.
- Light theme is a flat document, not architectural daylight (serious). The craft failure the
  PLAN explicitly named (not a flipped dark site). In light mode (07-hero-light-1440.png,
  r-bay-tape-light.png, 12-reduced-light-full-1440.png): shaft/field collapse to near-white, the
  wordmark is thin black type on bone with no volumetric light reading at all, and the bay
  hue-washes become random pastel smudges floating in white space, reading as artefacts not lit
  rooms. The space-made-of-light identity evaporates. The light theme currently fails its own
  success-criterion (reviewed in its own right; craft in both). It needs a genuine daylight
  COMPOSITION: a directional skylight wedge with a visible falloff, a warmer limestone floor
  gradient, the shaft as a soft volumetric wedge. Not just inverted tokens.
- Focus ring (warm --color-light-text, 2px, 2px offset) is visible and present on the directory
  links (focus-directory.png). Meets WCAG 2.2. No defect.

## 7. Responsive integrity

- 320 px hero (10-hero-dark-320.png): no horizontal overflow (confirmed). But the colonnade
  columns are visible AT REST behind the wordmark at this width, crowding the type; at 320 the
  stripes sit right under ATRIUM and read busy. Drop or further dim the colonnade resting opacity
  on the smallest widths.
- 360 px bay (r-bay-tape-mobile.png): clean vertical stack, legible, links stack well. The mobile
  no-pin branch is the right call.
- 320 px directory (r-directory-mobile-320.png): holds. Name, badge, pitch, chips, both links
  stack legibly. Strong.
- 1440 px: fine. 2560 px not directly captured, but the bays cap at max-w-6xl (72rem) centred, so
  at 2560 the type column floats in a wide dark field with the same uncomposed negative space
  noted in section 3; at ultra-wide the empty-room problem is amplified. Worth a check at 2560 with
  a wider light treatment or a max-width lift on the atmospheric layer.

## 8. Re-skin gate, atrium vs razors-edge

Verdict: PASS, with one caveat. Genuinely distinct on all three required axes:

| Axis         | razors-edge                                                    | atrium                                                                       | Distinct? |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Motif        | razor blade slicing a wordmark to a portrait (single hero cut) | descent through type to a colonnade of light to a six-bay tour (multi-stage) | Yes       |
| Palette      | one brass accent on near-black, photographic grade             | six per-bay signature hues + neutral warm chrome, type-and-light             | Yes       |
| Structure    | single pinned hero cut + horizontal gallery                    | hero descent + six sequential pinned bays + ruled directory                  | Yes       |
| Display face | Fraunces (serif, editorial)                                    | Bricolage Grotesque (structural sans)                                        | Yes       |

Caveat: the STATIC hero first-frame composition is the weakest differentiator. Centred display
wordmark + uppercase kicker + one-liner + descend cue, warm-light-on-near-black with a vignette,
is compositionally close to the razors-edge centred-wordmark hero. The differentiation (descent,
colonnade, six hues) only arrives on scroll. Because the colonnade currently fails (section 1a),
the first ~1.5 viewports lean even harder on the shared centred-wordmark language. Fixing the
colonnade and giving the hero an atrium-specific first-frame signal (an implied architectural
element at rest, not just a shaft) closes this. Not a re-skin, but do not let the hero first-frame
drift toward one.

## 9. Defect ledger

Severity: blocker (ships broken / fails a stated criterion) / high / medium / low.
Tier for Phase 5.2: must-fix = blocker + high.

| ID   | Severity | Tier       | Location                                                 | Defect                                                                                                                                                                                                                                               | Suggested fix                                                                                                                                                                                                                                  |
| ---- | -------- | ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | blocker  | must-fix   | hero/colonnade.tsx                                       | The colonnade of light reads as flat vertical venetian-blind stripes. perspective:900px is set but no child has any Z/rotateX transform so it is inert; no vanishing point, no floor, no column gaps. The wow centrepiece does not depict an atrium. | Give the planes real depth: rotateX/translateZ children so columns converge to a vanishing point; add a floor plane + horizon; add inter-column gaps so they read as standing columns. Stagger plane entrance by depth (see D-05 / section 5). |
| D-02 | blocker  | must-fix   | hero/hero-descent.tsx (pin length / timeline)            | The descent stalls: wordmark scale completes ~0.55-0.7, then ~scrollY 800-1300 is a static stripe frame with no event. The scroll-stalls-on-a-finished-animation the PLAN/ADR-003 forbid.                                                            | Shorten the pin multiple to end when the colonnade resolves, or author a second beat into the back half (floor-light bloom rising, columns settling) so every scrub position is a composition.                                                 |
| D-03 | high     | must-fix   | globals.css .light shaft/field tokens; light-field.tsx   | Light theme collapses the atrium-of-light identity to a flat bone document; bay hue-washes become random pastel smudges in white space. Fails the architectural-daylight not-a-flipped-dark-site criterion.                                          | Compose a real daylight scene: directional skylight wedge with visible falloff, warmer limestone floor gradient, shaft as a soft volumetric shape; re-tune the bay wash to read as lit floor. Review in its own right.                         |
| D-04 | high     | must-fix   | bays/project-bay.tsx (hue treatment)                     | The six differently-lit rooms read as one dark room with coloured trim. Hue is only an ordinal, a 56px rule, a 4px card edge, and a near-invisible bottom wash. The strongest show-the-range lever is decorative.                                    | Make the hue LIGHT the room: a stronger directional hue gradient/glow on the bay field (not just a bottom pool), a hue-tinted shaft per bay, hue in the title lit treatment. The room colour should be unmistakable on entry.                  |
| D-05 | high     | must-fix   | globals.css bay hue values (--bay-tape/apex/atlas)       | Hue-temperature clustering: tape (220), apex (255), atlas (175) are all cool blue-greens. Three of six rooms barely change temperature, undercutting the range thesis.                                                                               | Re-space the wheel for separation: push apex to steel/indigo, pull atlas off tape teal. Evocation bends to distinctness (same rule ADR-003 applies for contrast).                                                                              |
| D-06 | high     | must-fix   | bays/project-bay.tsx grid + title weight                 | Inverted hierarchy: the wow-card (only filled surface) wins the eye over the bay title; the 1.05/0.95 grid flattens mass; bay h2 is wght 440 while the secondary directory h3 is wght 600, so the primary title is lighter than the secondary list.  | Give the title a lit/heavier treatment so it wins first; widen the type column (~1.4/0.6); raise bay-title weight above the directory; or recede the wow-card (less fill, lower contrast).                                                     |
| D-07 | medium   | should-fix | hero/hero-content.tsx wordmark; globals.css --display-\* | Wordmark + headings sit at un-art-directed default axes (wght 440, opsz 144 pinned everywhere); the wordmark reads as a logo at the font neutral weight, not a Klim-grade specimen; opsz wasted by one pinned value across 10rem-1.4rem.             | Commit the wordmark to an intentional axis position with size-tuned tracking; vary opsz by role (max on wordmark/bay titles, lower on small ruled headings).                                                                                   |
| D-08 | medium   | should-fix | bays/project-bay.tsx min-h-[100svh]                      | Bay negative space is empty, not composed: undifferentiated dark around centred type, no leading line/floor/light anchor; reads as an empty room, amplified at 2560px+ (content caps at max-w-6xl).                                                  | Add structural anchoring (a baseline light line, a floor gradient, asymmetric type placement) so the whitespace is intentional like the directory; verify at 2560px.                                                                           |
| D-09 | medium   | should-fix | bays-sequence.tsx threshold parallax (+/-6 yPercent)     | Threshold parallax is imperceptible: motion without a readable reason (moving through a lit doorway does not register).                                                                                                                              | Increase travel or add a brightness pulse at the seam crossing, or remove it if it cannot earn a perceivable read.                                                                                                                             |
| D-10 | medium   | should-fix | directory/repo-affordance.tsx (x12)                      | Twelve dashed opacity-70 GitHub repo ghosts read as repeated disabled/failed controls on the most-judged page.                                                                                                                                       | Replace the per-link ghost with a single explicit repositories-publishing-soon note (directory header/footer) and drop the repeated dashed control, or restyle so it reads soon not broken.                                                    |
| D-11 | medium   | should-fix | hero/colonnade.tsx at 360px and below                    | Colonnade columns are visible at rest behind the wordmark at 320-360px, crowding the type.                                                                                                                                                           | Drop or further dim the colonnade resting opacity on the smallest widths (mobile matchMedia branch).                                                                                                                                           |
| D-12 | low      | polish     | directory/directory.tsx, link buttons                    | Hover micro-interactions are colour-only; against the Linear bar they are adequate, not alive. The about arrow-nudge is the only considered cue and should set the standard.                                                                         | Add one considered motion cue to directory rows / link buttons (hue underline wipe, icon nudge).                                                                                                                                               |
| D-13 | low      | polish     | hero/hero-content.tsx lede                               | The body-tracked one-liner under the 10rem -0.03em wordmark has an abrupt tracking jump.                                                                                                                                                             | Apply slight negative tracking to the lede to tie it to the wordmark (Stripe lede-under-display pattern).                                                                                                                                      |
| D-14 | low      | polish     | hero first-frame (re-skin caveat)                        | The static hero first-paint is compositionally close to the razors-edge centred-wordmark hero, the only weak point in the otherwise-passed re-skin gate.                                                                                             | Add an atrium-specific resting signal (an implied architectural element / colonnade hint at rest, not just a shaft) so the first frame is unmistakably atrium before any scroll.                                                               |

Counts: 2 blocker, 4 high, 5 medium, 3 low = 14 total.
Must-fix tier (Phase 5.2): D-01, D-02, D-03, D-04, D-05, D-06 (2 blocker + 4 high).

## Reference scorecard (zero pochwal)

- vs Olivier Larose (descent + pinned tour): MISSES. The pinned reveals lack a spatial anchor and
  the depth planes arrive together rather than staggered, so the descent-through-space never reads.
  The intermediate-frame-is-a-composition bar (which OL never breaks) is broken by the empty beat
  (D-02) and the flat colonnade (D-01).
- vs Stripe (long-form scroll, custom element earns its bundle, type as primary): PARTIAL. The
  long-form IA and type-forward bays are Stripe-adjacent and good; the custom scroll element
  (colonnade) does not yet justify its bundle because it does not depict its subject.
- vs Linear / Klim (chrome restraint, display as specimen): MET on the directory and about
  (genuinely specimen-grade ruled index); MISSED on the wordmark/title axes (D-07) and the
  alive-micro-interaction bar (D-12).
- vs Aristide Benoist (kinetic typography): the title ghost-to-final clip+weight resolve is
  on-concept and the resolved type is sharp, the closest the page comes to its references. The hero
  wordmark kinetic weight-thicken on descent is sound; the colonnade it descends into is what
  fails it.
