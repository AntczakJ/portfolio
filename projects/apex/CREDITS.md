# APEX — Asset Credits & Provenance

> Source-of-truth for every third-party / generated asset in apex, with its
> license and the swap-for-real path. Mirrors razors-edge's photography
> `CREDITS.md` discipline (CLAUDE.md § 4 docs requirement; ADR-002 §3 / ADR-004
> model-provenance requirement). The footer credits line + the README point
> here.
>
> **Location (P1-2):** this file lives at **`projects/apex/CREDITS.md`** (the
> per-project docs root, alongside `PLAN.md` / `DECISIONS.md` / `README.md`), NOT
> at `web/CREDITS.md`. All asset paths below are written relative to the app
> package, i.e. `web/public/...` and `web/scripts/...`.

## Fonts

| Asset             | Use                                      | License | Source                                     |
| ----------------- | ---------------------------------------- | ------- | ------------------------------------------ |
| **Inter**         | UI + body (`--font-apex-sans`)           | OFL-1.1 | rsms/inter (self-hosted via `next/font`)   |
| **Space Grotesk** | Wordmark + heads (`--font-apex-display`) | OFL-1.1 | floriankarsten/space-grotesk (self-hosted) |

Both are SIL Open Font License 1.1 (free for commercial use), self-hosted by
`next/font/google` — no runtime Google request (CSP-clean).

## Live 3D model — the configurator (model-swap PASS A)

**Status: REAL glTF — CC0, royalty-clear, UNBADGED. No license clearance needed;
the previous branded-Maybach BLOCKING flag is RESOLVED for the configurator
(P0-1 resolved here; the fleet renders are PASS B).**

| Asset                                             | Use                                                  |
| ------------------------------------------------- | ---------------------------------------------------- |
| `web/public/models/apex-suv.glb`                  | The optimized configurator BODY (textureless)        |
| `web/public/models/wheel-default.glb`             | Aero wheel set (instanced ×4)                        |
| `web/public/models/wheel-dark.glb`                | Turbine wheel set (instanced ×4)                     |
| `web/public/models/wheel-racing.glb`              | Forged wheel set (instanced ×4)                      |
| `web/src/components/configurator/lumen-model.tsx` | `useGLTF` loader + paint material + wheel instancing |
| `web/src/lib/r3f/rig.ts`                          | Shared camera / lighting / paint rig + wheel nodes   |
| `web/scripts/optimize-model.mjs`                  | The author-time preparation pipeline                 |
| `web/scripts/inspect-model.mjs`                   | GLB graph inspection                                 |

- **Source:** **Kenney "Car Kit" v3.1**, license **CC0 (Creative Commons Zero)** —
  `License.txt` in the kit, <https://kenney.nl/assets/car-kit>. Crediting
  "Kenney / www.kenney.nl" is appreciated (not required by CC0). The configurator
  flagship is the kit's **`suv-luxury.glb`** — a generic, **UNBADGED** low-poly
  luxury SUV (no manufacturer trademark exposure); the wheels are the kit's
  `wheel-default/dark/racing.glb`. We keep the fictional **APEX / Lumen** naming
  over this geometry. The raw kit + its zip live under
  `web/scripts/.model-src/` and are **gitignored** (NEVER committed); only the
  optimized artifacts under `web/public/models/` ship.
- **Preparation (`web/scripts/optimize-model.mjs`, `pnpm -F apex-web
model:optimize`):** the source is already tiny, so there is **NO meshopt/draco
  compression and NO WASM decoder** — the GLBs ship UNCOMPRESSED.
  - `apex-suv.glb` = the `suv-luxury` BODY ONLY (the `body` mesh **split into a
    paint group + a dark-GLASS group** by atlas colour, **textures dropped**) —
    the four in-body wheels are removed; **~28 KB / 758 tris / 2 materials**.
  - `wheel-{default,dark,racing}.glb` = the three wheel sets, **textures KEPT but
    RE-TINTED** at author time (tyre → neutral rubber; rim → the finish the copy
    promises; warm-orange swatches neutralised so none bleeds into the rim) —
    **~31–32 KB / 332 tris each**.
  - Total shipped model weight: **~119 KB** (was 1.82 MB for the old branded GLB).
- **Decoder / WASM:** **NONE.** The GLBs are uncompressed, so there is no
  meshopt/draco decoder and no WebAssembly at load. This is the change that let
  the CSP **drop `'wasm-unsafe-eval'`** (see "CSP / WASM outcome" below).
- **Paint mechanism (the PASS-A key):** Kenney encodes paint colour as a UV
  region on the shared `colormap` atlas — so we do NOT tint the atlas. Instead
  the BODY mesh is assigned a **custom `MeshPhysicalMaterial`** we fully control
  (NO baseColorTexture, `clearcoat` for a premium automotive sheen on the
  flat-shaded forms, `color` driven by the configurator paint swatch). The four
  colour swatches (`col-glacier/graphite/voltaic/midnight`) rewrite that
  material's colour + finish live.
- **Glass mechanism (P0-2):** the `body` mesh is split at author time into a
  paint group and a `apex-glass` group by sampling the Kenney `colormap` atlas at
  each triangle's UV centroid (the windows use a distinct blue-grey swatch). The
  runtime assigns the glass group its own dark `MeshPhysicalMaterial`, so the
  greenhouse never takes the body paint colour. Same split on the four fleet
  bodies.
- **Wheel mechanism (a genuine GEOMETRY swap):** the chosen wheel GLB is
  instanced at the four `WHEEL_NODES` captured from the source (front/back ×
  left/right; right side yawed π so the face points outboard). The three wheel
  sets differ in BOTH rim geometry AND (re-tinted) baked rim colour, so the
  swatch is a real wheel-SET swap. The wheels keep their authored — now re-tinted
  — atlas material so the tyre/rim distinction survives (tyre = neutral rubber,
  rim = the finish the copy promises).
- **Studio environment:** generated on the GPU from drei `<Lightformer>` panels
  (NOT a fetched HDRI — drei's `preset`/`files` pull from a CDN, forbidden by
  ADR-002 §5), re-tuned for the flat-shaded low-poly forms (a crisp key so
  facets catch light cleanly, a broad fill, a soft highlight streak). Plus a
  `Backdrop` gradient sweep + a `MeshReflectorMaterial` reflection floor (D-05),
  re-keyed per theme (D-06).

### Art direction (PASS A — a deliberate shift)

The model is **low-poly / flat-shaded, NOT photoreal**. The target is "clean
STYLIZED premium product-viz" (Polestar / Linear-grade minimal 3D) — a clean
low-poly car in a beautiful studio reads as intentional design, not a toy.
Achieved via excellent studio lighting on the flat forms, a tasteful clearcoat
on the body paint, a crisp contact shadow + studio sweep, and ONE restrained
voltaic accent graze on the lower body.

### Close-out polish (designer-critic) — glass, wheels, default paint

- **Real dark-glass split (FIXED — the headline close-out win, P0-2):** the
  optimized body is no longer one paint material. `optimize-model.mjs` splits the
  `body` mesh into a paint group (`apex-body` / `apex-fleet-body`) + a GLASS group
  (`apex-glass`) by classifying each triangle on the Kenney `colormap` atlas
  swatch its UV centroid lands on (the greenhouse/windows use a distinct blue-grey
  swatch — dark on the SUV, light blue-grey on the saloons; both are detected).
  The runtime (`lumen-model.tsx`) assigns the glass group a separate dark
  `MeshPhysicalMaterial` (low roughness, slight transmission, dark tint), so the
  windows NEVER take the body colour. This makes EVERY paint — incl. Glacier White
  and Voltaic Green — read as a real car with glass, not a toy. Applies to the
  flagship AND all four fleet bodies.
- **Wheel re-tint (FIXED, P1-C):** the raw Kenney atlas baked the tyre as a warm
  TAN swatch (read as orange/copper — the "rusted toy wheel") and the `aero` rim
  as orange. `optimize-model.mjs` now re-tints each wheel atlas at author time:
  the whole warm-tan tyre family → neutral dark rubber, and each rim accent →
  the finish the copy promises (aero = polished machined silver, turbine = dark
  graphite, forged = a voltaic-tinted machined finish). Warm swatches adjacent to
  used regions are also neutralised so no orange bleeds into the rim via texture
  filtering. The fleet wheels get the same tyre/warm neutralisation.
- **Default paint = GRAPHITE (changed):** `defaultColorId: 'col-graphite'` (was
  `col-glacier`) in the baked configurator options + the hero/blur renders, so the
  hero, the configurator landing, the confirmation payoff, and the white gallery
  frame all default to the strong premium register. Glacier White stays fully
  selectable; only the default presentation changed. The default wheel is now the
  polished `whl-aero` (it reads with strong contrast on the graphite body).
- **Glacier White swatch visibility (FIXED, P2-A):** the swatch chip carries an
  inset hairline + spherical inner shadow (via `box-shadow`, so it never fights
  the selected accent ring), so a near-white chip reads as a distinct, selectable
  swatch on the white panel.
- **Consistent fleet crops (FIXED, P1-A):** the four non-flagship fleet renders
  are length-normalised (a per-car uniform scale to ~2.7 m apparent length under
  the fixed rig, via the offline `__APEX_MODEL_SCALE` override) so all five fleet
  cards read as ONE studio line-up with equal footprint.

### Naming

The configurable hero vehicle is **"APEX Lumen SUV"** (`tier: 'suv'`, 7 seats) —
the fictional APEX/LUMEN brand over the unbadged Kenney geometry. EV-specific
copy on this ONE vehicle is softened to "premium / luxury"; the rest of the
fleet stays EV.

### Swap-for-real path (v2)

Drop in a higher-fidelity royalty-clear, unbadged GLB (CC0; ideally a true EV
SUV), re-run `web/scripts/optimize-model.mjs` (adjust the body-material handling
in `lumen-model.tsx` + the wheel nodes / rig framing in `rig.ts` for the new
bounds), re-run `web/scripts/render-from-scene.mjs` to regenerate the matrix +
hero + gallery stills from the same rig, and re-run `web/scripts/verify-csp.mjs`.

## Product renders (hero + configurator matrix + wheel thumbs)

**Status: PLACEHOLDER — 100% generated, CC0, no third-party imagery.** Used as
the LCP static hero render AND the Tier-3 pre-baked fallback stills (the live
scene never loads on mid-tier mobile / no-WebGL).

| Asset                                        | Use                                             |
| -------------------------------------------- | ----------------------------------------------- |
| `public/renders/lumen-gt/hero-desktop.avif`  | Scroll-hero LCP static render (desktop crop)    |
| `public/renders/lumen-gt/hero-mobile.avif`   | Scroll-hero LCP static render (mobile crop)     |
| `public/renders/lumen-gt/hero.avif`          | 16:9 hero render (fleet/OG candidate)           |
| `public/renders/lumen-gt/hero-blur.txt`      | Inlined AVIF blur placeholder (CLS-safe)        |
| `public/renders/lumen-gt/matrix/*.avif`      | Light-stage colour × wheel stills (Tier-3 src)  |
| `public/renders/lumen-gt/matrix-dark/*.avif` | **Dark-stage** colour × wheel stills (Task 4.4) |
| `public/renders/lumen-gt/hero-dark*.avif`    | Dark-stage hero crops (night-drive register)    |
| `public/renders/lumen-gt/wheels/*.avif`      | Configurator wheel-swatch thumbnails            |

- **Provenance:** RE-RENDERED from the LIVE R3F scene (the CC0 Kenney model) on
  the SAME camera / lighting rig as the live configurator by
  `web/scripts/render-from-scene.mjs` (headless Playwright drives the real DOM
  swatches, screenshots the live canvas at the rig framing → AVIF via `sharp`).
  So **Tier-1 (live) and Tier-3 (stills) are literally the same car**, and the
  hero LCP is a real studio frame of the configurable model. No external imagery
  is fetched; the model itself is CC0/unbadged (see "Live 3D model").
- **License:** CC0 — the model is CC0 (Kenney) and the renders are generated by
  this repo.
- **Palette:** matches the apex sovereign tokens (`globals.css`) — cool studio
  light + the voltaic-green accent; the dark register is a night-studio re-key.
- **Regenerate (both registers):** serve the production build
  (`pnpm -F apex-web start`), then `pnpm -F apex-web renders:scene` —
  `web/scripts/render-from-scene.mjs` renders the LIGHT (`matrix/`, `hero*.avif`)
  AND **dark "night drive"** (`matrix-dark/`, `hero-dark*.avif`) stills + the
  wheel thumbs + the gallery crops + both blur data URIs (`hero-blur.txt`,
  `hero-blur-dark.txt` — paste both into `src/components/hero/hero-assets.ts`).
  The dark stills resolve via `getThemedRenderStill(colorId, wheelId, 'dark')`
  (`web/src/mocks/configurator.ts`). The old SVG generator
  (`generate-hero-renders.mjs`) is retired.

## CSP / WASM outcome (the ADR-002 §5 deliverable — model-swap PASS A)

> **Updated (PASS A).** The configurator no longer loads a meshopt-compressed
> GLB. The CC0 Kenney body + wheel GLBs are tiny and ship **UNCOMPRESSED**, so
> there is **no meshopt/draco decoder and no WebAssembly at load**. The narrow
> `'wasm-unsafe-eval'` directive (which the old compressed GLB required) has been
> **REMOVED from `script-src` — a genuine security tightening.**

The live R3F configurator loads `public/models/apex-suv.glb` + the three wheel
GLBs via drei `useGLTF(url, false, false)` — **draco AND meshopt decoders
explicitly DISABLED** (drei defaults both to `true`; `useMeshopt=true` would
eagerly instantiate the meshopt WASM decoder, and `useDraco=true` would fetch a
draco decoder from a gstatic CDN). With both off there is **no WASM** and **no
CDN**. The only same-origin in-memory fetch is the wheel GLBs' embedded PNG
atlas, which GLTFLoader loads via a `blob:` URL — covered by `connect-src 'self'
blob:`.

**Served CSP (verified, 0 violations under `next build && next start` via
`web/scripts/verify-csp.mjs` with the live canvas mounted + orbited + a PAINT
swap + a WHEEL geometry swap):**

    default-src 'self'; script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
    font-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:;
    child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self';
    form-action 'self'

Changes vs the previous (Maybach) CSP: `'wasm-unsafe-eval'` REMOVED from
`script-src`; `blob:` ADDED to `connect-src` (the GLTFLoader in-memory texture
fetch). The `'unsafe-eval'` JS ban was, and remains, absolute. The environment is
still `Lightformer`-based (no fetched HDRI). The OG image (`/og/opengraph.png`)
and the confirmation-step configuration render (A-17) are same-origin static
assets under `img-src 'self'` and add no CSP surface.

## Fleet renders (non-configurable cars) — Task 5.1 / A-02 / N-1 (model-swap PASS B)

**Status: REAL GLB STUDIO RENDERS — CC0, royalty-clear, UNBADGED. The four
non-flagship fleet cards now render from CC0 Kenney "Car Kit" silhouettes
through the SAME live R3F rig + studio + clearcoat-paint mechanism as the
flagship, so all five fleet cards read as ONE studio line-up (closes
designer-critic N-1 — previously the four were procedural-SVG jellybeans next to
the photoreal flagship). The old SVG fleet generator is retired.**

The four `/renders/<slug>/hero{,-dark}.avif` (`stratos`, `terra`, `vella`,
`mira`) are now shot from the live scene by `render-from-scene.mjs` against the
optimized fleet body GLBs (see the table below) — same camera, same studio
lighting, same contact shadow, same custom clearcoat body paint as the
configurator flagship. Each gets a tasteful default paint from the palette so the
line-up has colour variety, not five identical cars. N-1 is solved by
construction (all five share one art family).

**Fleet mapping (vehicle → CC0 Kenney model → default paint):**

| Vehicle (slug)        | Kenney source model    | Body GLB (render-only)            | Default paint          |
| --------------------- | ---------------------- | --------------------------------- | ---------------------- |
| LUMEN (`lumen-gt`)    | `suv-luxury.glb`       | `public/models/apex-suv.glb`      | Glacier (configurable) |
| Stratos (`stratos`)   | `sedan-sports.glb`     | `public/models/fleet/stratos.glb` | Midnight               |
| Terra (`terra-suv`)   | `suv.glb`              | `public/models/fleet/terra.glb`   | Graphite               |
| Vella (`vella-sedan`) | `sedan.glb`            | `public/models/fleet/vella.glb`   | Gunmetal silver        |
| Mira (`mira-compact`) | `hatchback-sports.glb` | `public/models/fleet/mira.glb`    | Voltaic green          |

| Asset                                  | Use                                |
| -------------------------------------- | ---------------------------------- |
| `public/renders/<slug>/hero.avif`      | Fleet card render (light register) |
| `public/renders/<slug>/hero-dark.avif` | Fleet card render (dark re-key)    |
| `public/models/fleet/<slug>.glb`       | Fleet body GLB — RENDER-ONLY input |

- **Source:** all four are CC0 Kenney "Car Kit" v3.1 models (same kit as the
  flagship — `License.txt` CC0, <https://kenney.nl/assets/car-kit>), unbadged.
  Optimized by `web/scripts/optimize-model.mjs` (`buildFleetCar`): the WHOLE car
  (body + its own four bundled wheels), body texture dropped (the render assigns
  a per-car clearcoat paint, exactly the flagship mechanism), wheel atlas KEPT
  (tire/rim distinction). 74–98 KB each, uncompressed, no WASM decoder.
- **RUNTIME footprint note:** the fleet body GLBs are **render-only** — the four
  non-flagship cards are STATIC AVIFs at runtime (not configurable, no live
  canvas), so the browser never requests them. They are excluded from the Docker
  image (`.dockerignore` → `web/public/models/fleet`). Only the flagship body +
  3 wheel GLBs (~117 KB total) ship to the browser.
- **Swap-for-real path:** drop higher-fidelity unbadged CC0 EV GLBs into
  `web/scripts/.model-src/`, adjust the `buildFleetCar` mapping +
  `render-from-scene.mjs` FLEET array, re-run `model:optimize` + `renders:scene`;
  the fleet card components are unchanged.

## Gallery / brand-story crops — Task 5.2 / A-01

**Status: REAL GLB STUDIO CROPS — rendered from the live scene, CC0-pipeline.**
The scroll-reveal gallery frames (`/gallery/*{,-dark}.avif`) are now art-directed
**studio crops of the actual flagship GLB**, captured from the SAME camera /
lighting rig as the live configurator by `render-from-scene.mjs` (A-01) — so they
read as genuine product photography of the car the user configures, not abstract
glyphs. Four framings of one model on one rig (one consistent shoot), light +
dark re-keys. The masked-wipe + parallax mechanics in `gallery-section.tsx` are
unchanged; they now reveal real subjects.

| Asset                                      | Use                             |
| ------------------------------------------ | ------------------------------- |
| `public/gallery/hero-3q{,-dark}.avif`      | Front 3/4 hero crop (graphite)  |
| `public/gallery/wheel-detail{,-dark}.avif` | Tight front-wheel crop (forged) |
| `public/gallery/profile{,-dark}.avif`      | Near-side profile (model yawed) |
| `public/gallery/rear-3q{,-dark}.avif`      | Rear 3/4 (model yawed)          |

These crops now derive from the **CC0 Kenney `suv-luxury` GLB** (model-swap
PASS A) — royalty-clear, unbadged; the previous branded-GLB license flag no
longer applies. The old abstract gallery glyphs (`open-road`, `charging`,
`coast`, `city-night`, `track-line`) are retired; if stale files remain in
`public/gallery/` they are unreferenced.

## Maps — Task 5.3 (RESOLVED — the `/maps/*` 404s are gone)

**Status: PLACEHOLDER — 100% generated, CC0, no live embed.** The locations
section uses STYLED STATIC-MAP treatments (`/maps/<slug>{,-dark}.avif`), NOT a
live Google/Mapbox embed (PLAN.md, to protect the performance budget). Each is an
on-brand abstract street layout (deterministic from the location slug — blocks,
roads, water/runway for airports) with a baked **accent pin** at centre. The only
interaction is a maps CLICK-THROUGH (`https://www.google.com/maps/search/?api=1
&query=…`, no API key, opens in a new tab). Theme-aware light/dark re-keys. The
**dark re-key lifts the landmass + street contrast** (A-14): a lifted slate base
(`mapBg #161d27`), building blocks stepped up from it (`#222c39`/`#1b242f`), and a
clearly-lighter cool-grey road (`#566476`) so the map still reads as a map on the
dark theme instead of near-black-on-near-black.

| Asset                          | Use                               |
| ------------------------------ | --------------------------------- |
| `public/maps/<slug>.avif`      | Location static map (light)       |
| `public/maps/<slug>-dark.avif` | Location static map (dark re-key) |

(slugs: `lisbon-airport`, `lisbon-baixa`, `porto-airport`, `porto-depot`.)

## Regenerate the section assets

The static MAPS (both registers) are produced by one self-contained Node +
`sharp` script — no external imagery is fetched, so there is **no licensing/IP
exposure**:

    pnpm -F apex-web assets:sections   # scripts/generate-section-assets.mjs (maps only now)

The configurator matrix + hero stills + wheel thumbs + the gallery crops AND the
four non-flagship FLEET card renders (model-swap PASS B) are all rendered from
the live GLB scene by ONE harness (requires a running `next start` on the dev
port + the fleet body GLBs from `model:optimize`):

    pnpm -F apex-web model:optimize    # builds flagship + the 4 fleet body GLBs
    pnpm -F apex-web start &           # serve the production build on :3090
    pnpm -F apex-web renders:scene     # scripts/render-from-scene.mjs (all stills + fleet)

**Swap-for-real path (v2):** drop real photography into `/gallery/*` (or re-run
`renders:scene` against a royalty-clear unbadged EV GLB), real studio/press
renders into `/renders/<slug>/`, and real static-map exports (still no live
embed) or wire a lazy-loaded map embed into `/maps/*`; then re-run the section
components unchanged.
