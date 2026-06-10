# atrium — Designer Critique: the "cohesive and prettier" polish pass (2026-06-10)

Reviewer: designer-critic. Target: the DEPLOYED production site at
https://atrium-demo.fly.dev (region fra, scale-to-zero). Driven headlessly with
Playwright + chromium (1440x900 desktop and 390x844 mobile, reducedMotion
no-preference, waitUntil networkidle + 2.5s settle — 7 pin-spacers confirmed in
the DOM, so the full choreography ran). Both themes captured. Frames in
docs/critique-polish-shots/, referenced by filename.

Owner verdict this critique operationalises: "slabo to dziala, niech bedzie
bardziej spojnie i ladniej" — it reads weak/underwhelming; make it more cohesive
and prettier. ZERO praise below. References per house rule: Olivier Larose,
Stripe, Linear, Aristide Benoist, Klim.

---

## The 5 highest-leverage changes (do these first)

1. B-01 — Every one of the six bays is the SAME room re-coloured. All six share an
   identical grid (title left / wow-note + stack right), identical light geometry
   (hue glow always top-right, floor pool always bottom-centre), identical spacing
   — only the word and the hue change. Scroll-to-scroll this reads as one screen
   recoloured six times, the OPPOSITE of the six-distinct-showcases / variance-is-
   the-point thesis. Biggest source of the "weak / not cohesive" read: cohesion is
   not sameness, and the bays are same-y. (bays/project-bay.tsx, one shared
   component renders all six.) 04-bay-tape-resolved-dark.png through
   04-bay-atlas-resolved-dark.png are interchangeable.

2. B-02 — The hue does not LIGHT the room; it tints the top ~40% and the lower 60%
   is dead black in every bay. The Phase-5.2 note claims each bay reads as a
   distinctly-lit room, but on the deployed build the three wash layers are weak
   radial gradients clinging to the top edge plus a faint floor pool — the centre
   band where the type lives is near-pure background. The hue is still decorative
   trim around a black void, not illumination. 04-bay-pulse-resolved-dark.png:
   green only at the top.

3. B-03 — The descent back third is dead scroll. 02-descent-04-dark.png,
   02-descent-05-dark.png, 02-descent-06-dark.png are visually near-identical — the
   colonnade fully resolves by ~scrub 0.6 and the remaining ~40% of the 1.2vh pin
   produces no perceptible change. The camera translateZ keeps incrementing but
   under a fixed perspective the far-Z steps barely move pixels, so it FEELS
   finished while the user is still scrolling. The Phase-5.1 D-02 defect has
   re-appeared: pin length still exceeds perceived choreography.

4. B-04 — The light theme collapses to a washed-out grey document.
   01-hero-light.png: the ATRIUM wordmark is thin mid-grey on cream at ~2:1
   perceptual contrast — it does not hold and does not say atrium-of-light.
   04-bay-tape-resolved-light.png / -pulse- / -apex-: the per-bay hue is so
   desaturated it is nearly invisible (cyan, green, indigo all read as the same
   faint warm haze), so the six-hue signature device EVAPORATES in light mode.
   Light is not a flipped dark site — but right now it is a bleached one. Half the
   audience (system-light) sees the weakest version.

5. B-05 — The only memorable frame is the hero, and the desktop hero under-commits
   versus its own mobile version. The desktop hero (01-hero-dark.png) is competent
   but the wordmark is small in a shallow box and the colonnade is dim trim. The
   MOBILE hero (08-m-hero-dark.png) is dramatically better — the shaft rakes down,
   the hall reads as real depth, the wordmark is crisp and lit. The better
   composition already exists; desktop just under-commits. As-is the desktop first
   frame does not earn five seconds.

---

## 1. Cohesion — does it read as ONE designed system?

It reads as three quality tiers stitched together, not one system:

- Tier A (genuinely good): directory + about. 05-directory-dark.png,
  06-about-dark.png are the most resolved screens on the site — Klim/Linear-grade
  restraint, real hierarchy (a confident display-size headline), ruled rows,
  intentional whitespace. If the whole site held this bar it would not read weak.
- Tier B (competent but anonymous): chrome + footer. 07-footer-dark.png is fine
  but could belong to any dark portfolio.
- Tier C (the problem): hero + six bays. The atmospheric cinema — the intended wow
  — is the weakest tier (B-01/B-02/B-03).

Seams where the language breaks:

- D-07 — The bays do not inherit the directory type discipline. The directory
  binds a heavy display headline to a tight grotesque body with deliberate
  tracking. The bays use the same fonts but the composition is loose: giant title,
  large gap to a tiny tagline, gap to the pitch, gap to buttons — four loosely
  stacked blocks, no vertical rhythm binding them (04-bay-meld-resolved-dark.png).
  The directory feels composed; the bays feel stacked.
- D-08 — The transition INTO bay 1 is abrupt. The descent ends on the lit
  colonnade (02-descent-06-dark.png) and then tape (03-bay-tape-enter-dark.png)
  appears as a flat dark screen with a cyan title — the atrium metaphor is dropped
  the instant the tour starts. There is an atmosphere/threshold.tsx but its effect
  is imperceptible in the captures. The descend-through-the-atrium-INTO-the-bays
  promise breaks here; the bays are not in the atrium, they are a separate dark
  room. Olivier Larose scroll stories never drop the world between scenes.
- D-09 — Hue pacing as a SET is uneven via saturation drift. Wheel spacing (meld
  40 / razors 88 / pulse 150 / atlas 195 / tape 230 / apex 285) is fine in theory,
  but rendered, meld (04-bay-meld-resolved-dark.png) and razors-edge
  (04-bay-razors-edge-resolved-dark.png) are both muddy warm browns that read
  nearly identically, while pulse green and atlas teal are vivid. The tour goes
  brown -> brown -> vivid green -> vivid teal -> blue -> indigo: two near-twins
  then four distinct. The brass/amber pair needs separating in chroma or lightness,
  not just hue angle.

---

## 2. The six bay hues as a palette

- They do NOT harmonise as a deliberate set — six independent accents sharing one
  layout. A designed palette has a through line (shared chroma ceiling, shared
  lightness, a temperature arc). The only through line here is a glow at the top of
  a black screen.
- D-10 — lights-in-its-hue is not legible because the hue never reaches the type.
  Every resolved bay puts the title in a near-black band with the hue as a halo
  above. The device should read as this-room-is-bathed-in-tape-cyan; it is haloed,
  not bathed. (bays/project-bay.tsx:83-112 — the three wash layers use transparent
  60-72% falloff and cling to edges; the centre gets almost no hue.)
- D-11 — Hue-to-hue pacing on scroll is jarring at the brown->green seam and flat
  elsewhere. meld/razors (warm brown) straight to pulse (saturated green) is the
  one hard cut; the rest are too similar to register as movement.
- D-12 (light) — the palette ceases to exist in light mode.
  04-bay-tape-resolved-light.png vs -pulse- vs -apex-: cyan, green and indigo all
  reduce to the same pale warm wash. The entire reason the bays are separate rooms
  is invisible to a light-mode viewer. Light hues need their own composition (a
  tinted floor the type sits on, not a top vignette that desaturates to nothing on
  cream).

---

## 3. Motion quality & pacing

- D-13 (= B-03) — dead scroll in the descent back third. Confirmed by
  02-descent-04/05/06-dark.png being near-identical. The continuous translateZ
  camera (hero-descent.tsx:124, z opts.camZ over duration 1) is mathematically
  continuous but perceptually front-loaded: under perspective 1100px the visual
  delta from z=700 to z=900 is a fraction of z=0 to z=200, so the back half looks
  frozen. Fix: drive Z with an accelerating ease (power2.in) so equal scroll buys
  more visual travel late, OR shorten the pin to ~0.7vh, OR add a real new event in
  the back third (bay-1 threshold blooming up from below).
- D-14 — The whole descent is ease none. hero-descent.tsx:91, defaults ease none.
  A scrubbed timeline CAN be linear, but the marquee descent of the most-judged
  page reading perfectly linear is exactly what makes it feel animated not
  designed (the inspirations.md framing). Stripe and Aristide Benoist ride eased
  sub-curves even when scrubbed. Layer an easeOutQuart-class curve
  cubic-bezier(0.16, 1, 0.3, 1) under the scrub on the wordmark drop + colonnade
  reveal.
- D-15 — The kinetic title resolve reads as a cross-fade, not craft. Compare
  03-bay-pulse-enter-dark.png (just the word in hue) with
  04-bay-pulse-resolved-dark.png (the word in white + content revealed). The
  resolve is a hue->white swap plus a content fade-in — no kinetic GESTURE the eye
  reads as deliberate (no visible weight settle, no clip wipe that registers at
  this scale). Against Aristide Benoist kinetic type this is a cross-fade. Make the
  variable-font weight/width settle large enough to SEE, or commit to a clip/mask
  wipe that reads as motion.
- D-16 — Six near-identical reveals = monotonous choreography. One component, one
  reveal timeline, the same beat six times. Even subtle per-bay variation
  (direction, stagger, leading element) would make the tour feel authored.

---

## 4. Polish — typography, spacing, hierarchy, focus, mobile

- D-17 — Bay vertical rhythm is loose. title -> ~16px -> tagline -> ~24px -> pitch
  -> ~32px -> buttons: four ad-hoc gaps, no baseline system; the title->tagline gap
  orphans the tagline. (bays/project-bay.tsx:182-204.)
- D-18 — The wow-note is over-demoted. Phase 5.2 correctly stopped the wow-card
  beating the title, but over-corrected: in 04-bay-tape-resolved-dark.png THE WOW
  MOMENT is a tiny uppercase label in the far-right column the eye never reaches.
  The single sentence meant to hold-you-five-seconds is now the least visible
  element — below the stack chips in weight. It should be clear secondary to the
  title, primary among supporting content. (bays/project-bay.tsx:214-232.)
- D-19 — Stack chips are generic bordered pills. 04-bay-atlas-resolved-dark.png —
  default shadcn-ish chips, the least crafted element on a craft-thesis page. They
  do not carry the hue, do not align to a grid, look like form tags. Tie them to
  the hue or restyle as a Klim-style ruled typographic spec list.
  (bays/project-bay.tsx:235-249.)
- D-20 — Desktop hero wordmark under-scaled/under-lit. 01-hero-dark.png: ATRIUM is
  ~a third of the width with large dead margins and the shaft barely touches it.
  The mobile hero (08-m-hero-dark.png) proves the composition can be dramatic.
  (hero/hero-content.tsx, hero/colonnade.tsx.)
- D-21 — Light hero wordmark contrast too low. Thin grey on cream in
  01-hero-light.png. Even if it passes a raw WCAG number, perceptually it is
  faint/unlit — the LCP hero of the most-judged page should not look bleached.
  Darker ink + a visible warm shaft core so it reads as lit, not printed.
- D-22 — Mobile bays have almost no atmosphere. 09-m-bay-apex-dark.png,
  09-m-bay-atlas-dark.png — the hue light-field is effectively gone; flat dark
  documents with a coloured title. This is the version most phone-first recruiters
  see. The unpinned mobile stack is structurally fine but has lost the entire
  atmospheric identity. Give mobile bays a visible hue floor wash.
- D-23 — Focus ring (missed cohesion chance, not a defect). The global
  focus-visible ring is present and meets WCAG 2.2, but it is one generic ring that
  does not adopt the active bay hue.

---

## 5. The five-second test

Desktop: fails. 01-hero-dark.png is clean but inert — a centred wordmark in a dim
box. Nothing moves on load (idle shaft drift is sub-perceptual), nothing says
scroll-me beyond a small DESCEND cue. A non-scrolling recruiter sees a quiet title
card, not a wow. The payoff (the lit hall) is itself dim on desktop. Mobile:
passes — 08-m-hero-dark.png is genuinely arresting. The fix is to bring the desktop
hero up to the mobile hero drama (B-05 / D-20).

---

## Defect ledger

Severity: BLOCKER (ships-as-weak) / HIGH / MEDIUM / LOW. B-01..B-05 are the
highest-leverage lead items.

| ID   | Sev     | Location                                        | Defect                                                                                                                       | Fix direction                                                                                                                                                                                |
| ---- | ------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | BLOCKER | bays/project-bay.tsx (renders all six)          | Six bays are one template recoloured — same grid/light geometry, interchangeable; defeats the six-distinct-showcases thesis. | Per-bay compositional variation: alternate column sides, vary light-source position per hue, 2-3 distinct bay layouts driven off the data. Cohesion = shared system + intentional variation. |
| B-02 | BLOCKER | bays/project-bay.tsx:83-112                     | Hue tints only the top ~40%; type band + lower 60% dead black — edge-lit, not bathed.                                        | Raise floor-pool height + centre mix; add an ambient hue tint to the whole bay so type stands in coloured light.                                                                             |
| B-03 | BLOCKER | hero-descent.tsx:124 + :90-110                  | Descent back third is dead scroll (frames 04/05/06 identical); colonnade resolves ~0.6, ~40% of pin no change.               | Accelerating ease on camera Z (power2.in), OR shorten pin to ~0.7vh, OR add a real second beat (bay-1 threshold blooming up).                                                                |
| B-04 | BLOCKER | globals.css .light; light-field.tsx; bay washes | Light theme is a bleached grey document: hero wordmark ~2:1, six-hue system desaturates to one warm haze.                    | Author light as its own composition: ink wordmark + visible warm shaft core; per-bay hues re-keyed for cream ground.                                                                         |
| B-05 | HIGH    | hero/colonnade.tsx, hero-content.tsx            | Desktop hero timid (small wordmark, dim hall, dead margins); the mobile hero is dramatic — the better comp exists.           | Scale desktop wordmark up, bring shaft onto it, deepen colonnade contrast.                                                                                                                   |
| D-07 | HIGH    | bays/project-bay.tsx:114-204                    | Bays do not inherit the directory rhythm — four loosely-stacked blocks, no baseline grid.                                    | Apply the directory vertical rhythm; tighten title-to-tagline.                                                                                                                               |
| D-08 | HIGH    | atmosphere/threshold.tsx; bays/bays.tsx         | Hand-off from lit colonnade into bay 1 is abrupt — atrium metaphor dropped; threshold imperceptible.                         | Carry a colonnade/floor/shaft echo into bay 1; make the threshold visible.                                                                                                                   |
| D-09 | HIGH    | globals.css --bay-meld / --bay-razors-edge      | meld + razors-edge render as near-identical muddy warm browns.                                                               | Separate the pair in chroma/lightness, not just hue angle.                                                                                                                                   |
| D-10 | HIGH    | bays/project-bay.tsx:104-111                    | Floor pool falls off at transparent 72%, clings to bottom edge — hue is a halo, never reaches title.                         | Push the floor pool up behind the type; raise centre mix.                                                                                                                                    |
| D-13 | HIGH    | hero-descent.tsx:124                            | (= B-03) perspective foreshortening front-loads the camera; back-Z travel invisible.                                         | Accelerating ease on Z, or shorter pin.                                                                                                                                                      |
| D-14 | HIGH    | hero-descent.tsx:91                             | Whole descent is ease none — reads animated, not designed.                                                                   | Layer eased sub-curves cubic-bezier 0.16 1 0.3 1 under the scrub.                                                                                                                            |
| D-15 | HIGH    | bays/project-bay.tsx:146-180                    | Kinetic title resolve is a hue-to-white cross-fade — no visible gesture; short of Aristide Benoist.                          | Make the weight/width settle visible, or commit to a clip/mask wipe.                                                                                                                         |
| D-18 | MEDIUM  | bays/project-bay.tsx:214-232                    | Wow-note over-demoted — most important sentence per bay is now least visible (below stack chips).                            | Promote to clear secondary under the title; out-rank the stack chips.                                                                                                                        |
| D-12 | MEDIUM  | bay washes under .light                         | Six-hue system invisible in light (all read as one pale haze).                                                               | Light hues need a tinted floor composition, not a desaturating top vignette.                                                                                                                 |
| D-16 | MEDIUM  | bays/bays-sequence.tsx                          | Same reveal timeline six times — monotonous.                                                                                 | Per-bay variation in direction / stagger / leading element.                                                                                                                                  |
| D-17 | MEDIUM  | bays/project-bay.tsx:182-204                    | Loose ad-hoc vertical gaps; tagline orphaned.                                                                                | Baseline rhythm; tighten title-to-tagline.                                                                                                                                                   |
| D-19 | MEDIUM  | bays/project-bay.tsx:235-249                    | Stack chips are generic bordered pills — least-crafted element; ignore the hue.                                              | Tie chips to the hue or restyle as a Klim ruled spec list.                                                                                                                                   |
| D-20 | MEDIUM  | hero/hero-content.tsx, hero/colonnade.tsx       | Desktop wordmark under-scaled/under-lit; dead margins.                                                                       | Larger wordmark, shaft onto it, deeper hall.                                                                                                                                                 |
| D-21 | MEDIUM  | globals.css .light --color-fg / shaft           | Light hero wordmark perceptually faint/unlit.                                                                                | Darker ink + visible warm shaft core.                                                                                                                                                        |
| D-22 | MEDIUM  | bay washes at <=767px                           | Mobile bays lose all atmosphere — flat dark docs; the most-seen version.                                                     | Ensure a visible hue floor wash survives at mobile width.                                                                                                                                    |
| D-11 | MEDIUM  | hue ordering vs data/projects.ts order          | Hue temperature arc jumps once (warm to green) then plateaus.                                                                | Ease the temperature arc across the tour order.                                                                                                                                              |
| D-23 | LOW     | global focus-visible                            | Generic single focus ring; does not adopt the bay hue.                                                                       | Optional: tint the focus ring to the active bay hue.                                                                                                                                         |

---

## Summary

The directory and about prove the bar is reachable — they are excellent. The
weak/not-cohesive the owner felt lives almost entirely in the hero and the six
bays: the bays are one template painted six colours (B-01), the hue halos instead
of lighting (B-02), the descent dies in its back third (B-03), light bleaches the
identity away (B-04), and the desktop hero under-commits next to its own mobile
version (B-05). Fix those five and the page moves from a competent dark portfolio
with a quiet hero to the cohesive, lit, varied atrium the brief committed to.
Cohesion here is NOT making the bays more alike — they are already too alike — it
is binding them with a shared SYSTEM (rhythm, light language, palette arc) while
letting each room be its own.

Tally: 4 BLOCKER, 9 HIGH, 9 MEDIUM, 1 LOW (23 defects). Lead with B-01..B-05.
