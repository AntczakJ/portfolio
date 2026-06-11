# atrium — Polish-pass VERIFICATION (designer-critic, 2026-06-11)

Verification of the frontend-engineer cohesion+polish pass against
`docs/critique-polish.md`. Target: the DEPLOYED production site
https://atrium-demo.fly.dev (region fra, scale-to-zero — cold start tolerated).
Driven headlessly via Playwright + chromium (1440x900 desktop AND 390x844 mobile,
reducedMotion no-preference, networkidle + 2.8s settle, small-increment scroll
through the full ~15000px page). Both themes captured. 59 verification frames in
`docs/verify-polish-shots/` (a new dir; the AFTER set in `critique-polish-after/`
was NOT touched). References per house rule: Olivier Larose, Stripe, Linear,
Aristide Benoist, Klim.

## The five leads

| ID                                                                     | Verdict                             | Evidence (live frame)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-01** six distinct bay layouts bound by a shared system             | **CLEARED**                         | Three genuinely different compositions cycle deterministically off the ordinal: tape/pulse = title-left + right rail (`04-bay-tape/pulse-resolved-dark`); meld/apex = mirrored, title-right + left rail (`04-bay-meld/apex-resolved-dark`); razors-edge/atlas = centred specimen, rail split below (`04-bay-razors-edge/atlas-resolved-dark`). One system (type hierarchy, hue language, ruled stack, wow-note) — three rooms. No longer interchangeable. |
| **B-02 / D-10** hue BATHES the room                                    | **CLEARED**                         | Every resolved bay floods full-frame: tape cyan fills the lower band + type area (`04-bay-tape-resolved-dark`), meld orange floods top-to-bottom (`04-bay-meld-resolved-dark`), pulse green and atlas teal bathe the whole field. Type now stands IN coloured light, not under a top halo.                                                                                                                                                                |
| **B-03 / D-13 / D-14** descent back-third reads designed, not dead     | **CLEARED (good, not spectacular)** | `02-descent-03 -> 04 -> 05 -> 06-dark` are NO longer near-identical — the colonnade columns visibly advance/spread outward and the floor pool brightens through the back third; the camera reads eased, not frozen. The motion in the final ~30% is real but on the subtle side; acceptable, no longer a stall.                                                                                                                                           |
| **B-04 / D-12 / D-21** light theme authored as its own lit composition | **CLEARED**                         | `01-hero-light`: ATRIUM is heavy near-black ink with a warm shaft core landing on it — reads lit, not the ~2:1 bleached grey of the before-record. `04-bay-{tape,pulse,apex}-resolved-light`: cyan / green / indigo each read as a distinct floor-flooding wash on cream — the six-hue device survives light mode. `02-descent-05-light`: a sunlit limestone hall, not a washed document.                                                                 |
| **B-05 / D-20** desktop hero earns five seconds                        | **CLEARED**                         | `01-hero-dark`: ATRIUM now fills ~60% of the frame, both colonnades recede with real perspective, the overhead warm shaft pools onto the wordmark, deep hall below. Now matches the (still strong) mobile hero `08-m-hero-dark` for drama; dead margins gone.                                                                                                                                                                                             |

## Spot-checked highs / mediums claimed fixed

| ID                                             | Verdict      | Evidence                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-09 meld vs razors-edge no longer twin browns | CLEARED      | `04-bay-meld-resolved-dark` is a red-warm orange-brown; `04-bay-razors-edge-resolved-dark` is a yellower olive-gold — separated in hue AND lightness, distinct on scroll.                                                                            |
| D-18 wow-note promoted                         | CLEARED      | Every bay carries a hue-ruled "THE WOW MOMENT" pull-quote sentence out-ranking the stack (`04-bay-apex-resolved-dark`, mobile `09-m-bay-apex-dark`).                                                                                                 |
| D-19 ruled hue-ticked stack                    | CLEARED      | Stack is now a Klim-style ruled vertical spec list with hue leading marks, not generic bordered pills (`04-bay-tape/atlas-resolved-dark`).                                                                                                           |
| D-22 mobile bay atmosphere                     | CLEARED      | `09-m-bay-apex-dark` carries a visible indigo floor wash flooding up behind content; atmosphere survives at phone width.                                                                                                                             |
| D-15 visible kinetic title gesture             | PARTIAL-PASS | `03-bay-pulse/tape-enter-dark`: the title emerges in its hue from the bathed field with a weight settle before the resolved state — a readable gesture, but still at the subtle end versus Aristide Benoist kinetic type. Improved, not a showpiece. |
| D-08 hand-off into bay 1                       | CLEARED      | `03-bay-tape-enter-dark` shows the cyan title emerging from a hall-like atmospheric field that echoes the colonnade — the atrium metaphor is carried into bay 1, no longer a flat cut.                                                               |

## Regression check

| Surface                                                                         | Result                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Directory (was first-class)                                                     | NO degradation — `05-directory-dark/light` intact (display headline, ruled rows, badges, all links).          |
| About (was first-class)                                                         | NO degradation — `06-about-dark` intact (headline + three ruled convictions).                                 |
| CSP / console / page / request errors (incl. threshold + atrium-echo additions) | CLEAN — 0 across all six driven contexts (desktop dark+light, mobile dark+light, reduced-motion, 320px).      |
| Reduced-motion composes cleanly                                                 | PASS — 0 pin-spacers, all 6 bay titles resolved (visibility visible / opacity 1 / clip none), nothing frozen. |
| Pin integrity                                                                   | PASS — 7 pin-spacers desktop (hero + 6 bays), 1 pin mobile (hero only; bays unpinned).                        |
| 320px horizontal overflow                                                       | PASS — scrollWidth 320 == clientWidth 320, zero overflow.                                                     |

## New defects introduced by the polish

None blocking. The polish did not introduce a regression in any surface checked.
Residual (carried, NOT new blockers):

- **N-01 (LOW)** — B-03 back-third travel, while no longer dead, is still on the
  subtle side: the column spread + floor brighten in `02-descent-05/06-dark` is
  perceptible but gentle. If a future pass wants more, drive camera Z with a
  steeper `power2.in` or shorten the pin another ~0.2vh. Not blocking.
- **N-02 (LOW)** — D-15 title resolve is a legible gesture but still reads closer
  to a tinted settle than a committed clip/mask wipe; short of the Aristide
  Benoist bar the brief aspires to. Optional future craft, not blocking.

## Bottom line

The polish is a genuine improvement. All five lead blockers/highs are CLEARED on
the live site, the claimed high/medium fixes hold, the previously-excellent
directory + about did not degrade, and the threshold/atrium-echo additions are
CSP/console-clean. Two LOW residuals (descent back-third subtlety, kinetic-title
restraint) remain as optional future craft — nothing is blocking. The page has
moved from "a competent dark portfolio with a quiet hero" to the cohesive, lit,
six-distinct-rooms atrium the brief committed to.
