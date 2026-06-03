# Photography credits

All photography in this directory is sourced under the **Unsplash License**
(https://unsplash.com/license) — free for commercial and non-commercial use,
no permission or attribution required. Attribution is recorded here anyway as
good practice and provenance for a public portfolio demo.

The raw downloads (`*.jpg` in this folder) are the originals. The files under
`graded/` are derivatives produced by `scripts/grade-photography.mjs`, which
applies one cohesive dark-luxe brass-on-near-black treatment (warm duotone
lean, lifted contrast, gentle desaturation, radial vignette) so the otherwise
mixed set reads as a single cinematic frame. `next/image` re-encodes the
graded sources to AVIF/WebP at request time.

Note: the **desktop + mobile hero reveal** now both come from the dramatic
straight-razor shave portrait (`photo-1596728325488-58c87691e9af`),
art-directed per device (a centred landscape crop for desktop, a tall crop
for mobile) — it pays off "the work beneath / the finished cut" and
reinforces the brand's razor motif (D-05 rework). The former desktop-hero
scissor-shave crop is now Gallery 02.

| Slot                 | Graded output           | Source (Unsplash)                                       | Photo ID                           |
| -------------------- | ----------------------- | ------------------------------------------------------- | ---------------------------------- |
| Hero — desktop (LCP) | `graded/hero-desktop.*` | Straight-razor shave, client in profile, blade mid-pass | `photo-1596728325488-58c87691e9af` |
| Hero — mobile        | `graded/hero-mobile.*`  | Straight-razor shave (tall crop of the same frame)      | `photo-1596728325488-58c87691e9af` |
| Gallery 01           | `graded/gallery-01.*`   | Barbershop interior, brick wall, warm pendants          | `photo-1585747860715-2ba37e788b70` |
| Gallery 02           | `graded/gallery-02.*`   | Barber trimming a beard with scissors in low light      | `photo-1503951914875-452162b0f3f1` |
| Gallery 03           | `graded/gallery-03.*`   | Vintage leather barber chair, chrome detail             | `photo-1512690459411-b9245aed614b` |
| Gallery 04           | `graded/gallery-04.*`   | Textured crop cut, scissor-over-comb                    | `photo-1622286342621-4bd786c2447c` |
| Gallery 05           | `graded/gallery-05.*`   | Finish blow-dry at the chair                            | `photo-1605497788044-5a32c7078486` |

### Barber portraits (Phase 4.3, team section)

Real men's portrait / headshot photography, sourced under the same Unsplash
License, downloaded same-origin and graded to the dark-luxe brass-on-near-black
world (a tall 4:5 crop, slightly lighter vignette than the gallery so faces stay
legible) so the team grid reads as one cinematic frame — no gray placeholders.
The names are the fictional roster; the photos are stand-in stock.

| Slot (barber) | Graded output                 | Source (Unsplash)                                    | Photo ID                           |
| ------------- | ----------------------------- | ---------------------------------------------------- | ---------------------------------- |
| Marco Vidal   | `graded/barber-marco-vidal.*` | Studio headshot, dark backdrop, brown hair + stubble | `photo-1506794778202-cad84cf45f1d` |
| Idris Bello   | `graded/barber-idris-bello.*` | Editorial headshot on a soft gray field              | `photo-1500648767791-00dcc994a43e` |
| Sasha Ren     | `graded/barber-sasha-ren.*`   | Golden-hour outdoor portrait, dark hair              | `photo-1492562080023-ab3db95bfbce` |
| Emil Novak    | `graded/barber-emil-novak.*`  | Moody low-key suit portrait, short hair              | `photo-1519085360753-af0119f7cbe7` |
| Jonah Pike    | `graded/barber-jonah-pike.*`  | Studio headshot, gray marble backdrop                | `photo-1507003211169-0a1dd7228f2d` |

Direct source URL pattern: `https://images.unsplash.com/<Photo ID>`.

## Swap-for-real path (v2)

These are stand-in stock shots graded to the brand. For a real Razor's Edge
deployment, replace the files under `public/images/` with the studio's own
art-directed photography (same slot names + aspect ratios), re-run
`node scripts/grade-photography.mjs` (or skip the grade if the originals are
already colour-managed), and the slots pick them up with no code change.
