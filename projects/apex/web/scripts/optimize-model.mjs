// @ts-nocheck
/* eslint-disable */
/**
 * optimize-model.mjs — author-time preparation of the CC0 Kenney "Car Kit" GLBs
 * into the shipped configurator artifacts (model-swap PASS A).
 *
 * SOURCE (CC0, never modified): Kenney "Car Kit" v3.1
 *   web/scripts/.model-src/car-kit/Models/GLB format/
 * The raw kit + its zip are gitignored (`scripts/.model-src/`); ONLY the
 * optimized artifacts under `web/public/models/` ship. See CREDITS.md.
 *
 * WHAT WE PRODUCE
 *   1. public/models/apex-suv.glb     <- suv-luxury.glb, BODY-ONLY (the four
 *      in-body wheel meshes are removed; the live scene instances the separate
 *      wheel GLBs at the captured wheel-node positions for a genuine wheel-
 *      GEOMETRY swap).
 *   2. public/models/wheel-default.glb <- wheel-default.glb
 *   3. public/models/wheel-dark.glb    <- wheel-dark.glb
 *   4. public/models/wheel-racing.glb  <- wheel-racing.glb
 *   5. public/models/fleet/<slug>.glb  <- the FOUR non-flagship fleet bodies
 *      (model-swap PASS B). Each is the WHOLE car (body + its own four bundled
 *      wheels) — the fleet cards are NOT configurable, so the car renders as one
 *      studio object with its authored wheels. The body texture is dropped (the
 *      live render assigns a per-car premium clearcoat paint, exactly like the
 *      flagship) but the wheel atlas is KEPT (tire/rim distinction). The four map
 *      to consistent Kenney silhouettes (one art family with the flagship):
 *        stratos <- sedan-sports     (a low, aggressive sports four-door = halo)
 *        terra   <- suv              (a tall, boxy standard SUV)
 *        vella   <- sedan            (a formal executive saloon)
 *        mira    <- hatchback-sports (a compact hot-hatch)
 *
 * KEY DECISIONS
 *   - NO meshopt/draco, NO WASM decoder. The GLBs ship UNCOMPRESSED (they are
 *     tiny). So there is NO WebAssembly at load and the CSP DROPS
 *     `'wasm-unsafe-eval'` (a genuine tightening — see next.config.ts / CREDITS).
 *   - BODY: textures DROPPED. Kenney encodes paint colour as a UV region on the
 *     shared `colormap` atlas; we do NOT tint the atlas — the runtime assigns the
 *     body a CUSTOM `MeshPhysicalMaterial` (clearcoat, colour from the
 *     configurator), so the atlas would only fight us. Dropping it also removes
 *     KHR_texture_transform from the body.
 *   - WHEELS: textures KEPT. The wheel atlas bakes the tire (black) AND the rim
 *     face (per-variant colour) as distinct UV regions — collapsing that to one
 *     flat material erased the tire/rim distinction and made the rim invisible.
 *     The three wheel GLBs (default/dark/racing) differ in BOTH rim geometry AND
 *     baked rim colour, so KEEPING the atlas gives a genuine, legible wheel-SET
 *     swap with proper tire/rim separation — at the cost of a single shared
 *     ~12 KB PNG (no decoder; PNG needs no WASM). The runtime leaves the wheel
 *     materials authored.
 *
 * Run: pnpm -F apex-web model:optimize   (no args = build all four)
 */
import { mkdir, stat, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  weld,
  join as joinPrimitives,
  flatten,
  textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '.model-src', 'car-kit', 'Models', 'GLB format');
const OUT_DIR = join(HERE, '..', 'public', 'models');

/**
 * Decode the Kenney `colormap` atlas to a raw RGBA buffer + a UV sampler, so we
 * can classify each body triangle by the atlas swatch it lands on. The kit bakes
 * every part colour as a vertical swatch on ONE shared 512×512 atlas:
 *   - the GREEN swatch (~75,180,128)        = the painted body region;
 *   - the dark BLUE-GREY swatch (~73,76,90) = the glasshouse / windows;
 *   - the TAN swatch (~252,225,194)         = the wheel tyre rubber;
 *   - a per-wheel accent swatch (orange / green / blue-grey) = the rim face.
 * We sample at the triangle's UV centroid (the kit's swatches are large flat
 * blocks, so the centroid is an unambiguous, robust classifier — see the
 * one-off analysis recorded in AGENT_NOTES).
 */
async function loadAtlas(doc) {
  const tex = doc.getRoot().listTextures()[0];
  if (!tex) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sample = (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
    const y = Math.min(info.height - 1, Math.max(0, Math.round((1 - v) * (info.height - 1))));
    const o = (y * info.width + x) * info.channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  return { sample };
}

/**
 * True for a glass swatch (windows), false for body paint. The kit uses two
 * glass-swatch families across the models: a DARK blue-grey (~73,76,90 — the SUV)
 * and a LIGHT blue-grey/lavender (~216,216,230 — the saloons). Both share the
 * structure "blue is the dominant or co-dominant channel, the swatch is neutral
 * (r≈g), and it is NOT the green body-paint swatch". The light family is also
 * highly neutral with a faint blue lift. We classify either as glass.
 */
function isGlassColor(r, g, b) {
  const greenDominant = g > r + 25 && g > b + 25; // the body-paint swatch
  if (greenDominant) return false;
  const blueLift = b >= r && b >= g; // blue at or above the other channels
  const neutralRG = Math.abs(r - g) <= 12; // r≈g (both glass families)
  // Dark glass: all channels low. Light glass: bright, near-neutral, blue lift.
  const darkGlass = r < 120 && g < 120 && b < 135 && blueLift;
  const lightGlass = r > 150 && neutralRG && b >= r && b - r >= 6 && b - r <= 40;
  return darkGlass || lightGlass;
}

/**
 * Strip ALL textures (we override materials at runtime) + their
 * KHR_texture_transform, then clean the graph. Pure-geometry GLBs need no
 * decoder, so they ship uncompressed and the CSP needs no `'wasm-unsafe-eval'`.
 */
async function stripTexturesAndClean(doc) {
  const root = doc.getRoot();
  // Detach every material's texture so prune() can collect the orphaned images.
  for (const mat of root.listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setNormalTexture(null);
    mat.setEmissiveTexture(null);
    mat.setOcclusionTexture(null);
    // KHR_texture_transform rides on the texture-info; dropping the texture
    // removes the info, but be explicit so the extension is fully orphaned.
  }
  await doc.transform(
    flatten(),
    dedup(),
    weld({ tolerance: 0.0001 }),
    joinPrimitives(),
    prune({ keepLeaves: false, keepExtras: false }),
  );
  // Remove any now-unused extensions (KHR_texture_transform) from the root.
  for (const ext of root.listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_texture_transform') ext.dispose();
  }
  return doc;
}

/**
 * Split a single textured `body` primitive into TWO primitives by atlas colour —
 * a BODY group and a GLASS group — so the runtime can paint the body while
 * giving the greenhouse/windows a separate dark-glass material (P0-2: kills the
 * "no glass" tell on light/bold paint). Both groups get a fresh, textureless
 * material (`apex-body` / `apex-glass`); the atlas is then orphaned and pruned.
 *
 * The classification is by the swatch the triangle's UV centroid lands on (the
 * Kenney atlas swatches are large flat blocks → unambiguous). If a model has no
 * detectable glass swatch (every tri classifies as body) we leave a single body
 * primitive — the runtime treats a missing `apex-glass` material as "no glass to
 * tint", so the fallback is safe.
 */
function splitBodyGlass(doc, mesh, atlas) {
  if (!atlas) return false;
  const prim = mesh.listPrimitives()[0];
  if (!prim) return false;
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  if (!uv || !idx) return false;

  const n = idx.getCount();
  const bodyIdx = [];
  const glassIdx = [];
  const tmp = [0, 0];
  for (let t = 0; t < n; t += 3) {
    let cu = 0;
    let cv = 0;
    const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
    for (const vi of tri) {
      uv.getElement(vi, tmp);
      cu += tmp[0];
      cv += tmp[1];
    }
    const [r, g, b] = atlas.sample(cu / 3, cv / 3);
    const target = isGlassColor(r, g, b) ? glassIdx : bodyIdx;
    target.push(...tri);
  }

  if (glassIdx.length === 0) return false; // no glass swatch — keep single prim

  const bodyMat = doc.createMaterial('apex-body');
  bodyMat.setBaseColorFactor([0.9, 0.92, 0.94, 1]);
  bodyMat.setMetallicFactor(0.5);
  bodyMat.setRoughnessFactor(0.3);
  const glassMat = doc.createMaterial('apex-glass');
  glassMat.setBaseColorFactor([0.07, 0.09, 0.12, 1]);
  glassMat.setMetallicFactor(0);
  glassMat.setRoughnessFactor(0.1);

  // Rebuild: keep the original (body) primitive's geometry but re-point its
  // indices to the body subset, then add a second primitive sharing the same
  // vertex attributes but indexing the glass subset.
  const buffer = doc.getRoot().listBuffers()[0];
  const mkIndices = (arr) =>
    doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint16Array(arr))
      .setBuffer(buffer);

  prim.setIndices(mkIndices(bodyIdx));
  prim.setMaterial(bodyMat);

  const glassPrim = doc.createPrimitive();
  for (const semantic of prim.listSemantics()) {
    glassPrim.setAttribute(semantic, prim.getAttribute(semantic));
  }
  glassPrim.setIndices(mkIndices(glassIdx));
  glassPrim.setMaterial(glassMat);
  mesh.addPrimitive(glassPrim);

  return true;
}

/** Build the body-only SUV: drop the four in-body wheel meshes + split glass. */
async function buildBody(io) {
  const src = join(SRC_DIR, 'suv-luxury.glb');
  const out = join(OUT_DIR, 'apex-suv.glb');
  const doc = await io.read(src);
  const root = doc.getRoot();
  const atlas = await loadAtlas(doc);

  // Detach the in-body wheel nodes — the live scene instances the separate
  // wheel GLBs at these positions, so the bundled wheels are removed to avoid
  // double wheels and to keep the body material isolated.
  let dropped = 0;
  for (const node of root.listNodes()) {
    if (/^wheel-/i.test(node.getName())) {
      node.detach();
      dropped++;
    }
  }
  console.log(`  apex-suv: detached ${dropped} in-body wheel nodes`);

  // P0-2: split the body mesh into a paint group + a dark-glass group BEFORE
  // stripping textures (the split needs the atlas to classify the windows).
  const bodyMesh = root.listMeshes().find((m) => m.getName() === 'body');
  const split = bodyMesh ? splitBodyGlass(doc, bodyMesh, atlas) : false;
  console.log(`  apex-suv: glass split ${split ? 'OK (apex-body + apex-glass)' : 'skipped'}`);

  await stripTexturesAndClean(doc);

  // If the split did NOT run (no glass swatch), name the single material so the
  // runtime still finds the body. When the split DID run the two materials are
  // already named apex-body / apex-glass.
  if (!split) {
    for (const mat of root.listMaterials()) mat.setName('apex-body');
  }

  await io.write(out, doc);
  return out;
}

/**
 * Re-tint the wheel `colormap` atlas in place (P1-C). The raw Kenney atlas bakes
 * the tyre as a light TAN swatch (~252,225,194) that reads as orange/copper in
 * the studio render (the "rusted toy wheel"), and a per-wheel accent swatch for
 * the rim. We recolour BOTH so every wheel matches the copy:
 *   - the tan tyre swatch → a neutral dark rubber for ALL wheels;
 *   - the per-wheel accent → the finish the copy promises:
 *       aero    = polished machined silver,
 *       turbine = dark graphite,
 *       forged  = a voltaic-tinted machined finish (the one accent wheel).
 * Pixels are matched by nearness to a known swatch RGB; everything else (the
 * neutral greys of the rim body) is left alone, so the spoke geometry still
 * reads. Returns the recoloured PNG buffer.
 */
async function retintWheelAtlas(pngBuffer, finish) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const near = (r, g, b, t, tol) =>
    Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol;
  // The tyre swatch is a WARM TAN family (~252,225,194) with gradient edges that
  // dip to ~244,205,157 — a fixed ±tol around one swatch leaves the darker rim-
  // edge pixels (which read as an orange ring). Match the whole warm-tan family:
  // bright, red≥green≥blue, with a clear warm spread (r−b large). This catches
  // the tyre + its gradient lip without touching the neutral grey rim body.
  const isTyre = (r, g, b) =>
    r > 200 && r >= g - 4 && g >= b - 4 && r - b >= 25 && r - b <= 90;
  const RUBBER = [34, 36, 40];
  // The per-wheel accent swatch in the raw atlas (from the analysis).
  const ACCENT_SRC = {
    aero: [250, 107, 65], // orange
    turbine: [89, 195, 135], // green
    forged: [82, 85, 100], // blue-grey
  }[finish];
  const RIM = {
    aero: [216, 222, 228], // polished machined silver
    turbine: [56, 60, 66], // dark graphite
    forged: [31, 158, 120], // voltaic machined
  }[finish];
  // A warm swatch (orange / amber / red / yellow) the wheel does NOT legitimately
  // use, but whose pixels BLEED into the rim via bilinear/mipmap filtering at the
  // atlas swatch boundary (the orange ring on the forged rim). Neutralise the
  // whole warm family to the rim finish so no warm pixel can bleed in.
  const isWarm = (r, g, b) => r > 150 && r > b + 40 && r >= g && g > b - 10;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isTyre(r, g, b)) {
      data[i] = RUBBER[0];
      data[i + 1] = RUBBER[1];
      data[i + 2] = RUBBER[2];
    } else if (ACCENT_SRC && near(r, g, b, ACCENT_SRC, 40)) {
      data[i] = RIM[0];
      data[i + 1] = RIM[1];
      data[i + 2] = RIM[2];
    } else if (isWarm(r, g, b)) {
      data[i] = RIM[0];
      data[i + 1] = RIM[1];
      data[i + 2] = RIM[2];
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

/**
 * Build one wheel GLB: re-tint the colormap atlas (P1-C — neutral rubber + a
 * finish-correct rim), KEEP it (tire/rim distinction), clean.
 */
async function buildWheel(io, srcName, outName, finish) {
  const src = join(SRC_DIR, srcName);
  const out = join(OUT_DIR, outName);
  const doc = await io.read(src);

  // Re-tint the shared atlas in place before cleaning.
  const tex = doc.getRoot().listTextures()[0];
  if (tex) {
    const png = await sharp(Buffer.from(tex.getImage())).png().toBuffer();
    const retinted = await retintWheelAtlas(png, finish);
    tex.setImage(retinted).setMimeType('image/png');
  }

  // Keep textures; just flatten + clean the graph. No simplify (332 tris).
  await doc.transform(
    flatten(),
    dedup(),
    weld({ tolerance: 0.0001 }),
    joinPrimitives(),
    prune({ keepLeaves: false }),
  );
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setName('apex-rim');
  }
  await io.write(out, doc);
  return out;
}

/**
 * Build one non-flagship FLEET car (PASS B): the WHOLE car (body + its four
 * bundled wheels). The `body` mesh gets a fresh, textureless material named
 * `apex-fleet-body` so the live render can assign it a per-car premium clearcoat
 * paint (exactly the flagship paint mechanism); the four `wheel-*` meshes KEEP
 * the authored `colormap` atlas so the tire/rim distinction survives.
 */
async function buildFleetCar(io, srcName, outName) {
  const src = join(SRC_DIR, srcName);
  const out = join(OUT_DIR, 'fleet', outName);
  const doc = await io.read(src);
  const root = doc.getRoot();
  const atlas = await loadAtlas(doc);

  // P1-C (fleet): the fleet cars keep their bundled wheels, whose tyre is the
  // same tan swatch that reads orange/copper. Re-tint the atlas tyre region to
  // neutral rubber (the rim accent stays — fleet wheels are not configurable).
  const fleetTex = doc.getRoot().listTextures()[0];
  if (fleetTex) {
    const png = await sharp(Buffer.from(fleetTex.getImage())).png().toBuffer();
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Same warm-tan tyre family as the configurator wheels (incl. gradient lip)
      // AND any warm orange/amber/red swatch (it bleeds into the rim) → a neutral
      // dark machined finish so fleet wheels read clean (P1-C).
      const isTyre =
        r > 200 && r >= g - 4 && g >= b - 4 && r - b >= 25 && r - b <= 90;
      const isWarm = r > 150 && r > b + 40 && r >= g && g > b - 10;
      if (isTyre) {
        data[i] = 34;
        data[i + 1] = 36;
        data[i + 2] = 40;
      } else if (isWarm) {
        data[i] = 70;
        data[i + 1] = 74;
        data[i + 2] = 80;
      }
    }
    const retinted = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .png()
      .toBuffer();
    fleetTex.setImage(retinted).setMimeType('image/png');
  }

  // The single shared `colormap` material is used by BOTH the body and the
  // wheels. Split the BODY mesh into a paint group (`apex-fleet-body`) + a dark
  // glass group (`apex-fleet-glass`) by atlas colour (P0-2), and leave the
  // wheels on the (kept) textured atlas.
  const bodyMesh = root.listMeshes().find((m) => m.getName() === 'body');
  let split = false;
  if (bodyMesh && atlas) {
    split = splitBodyGlass(doc, bodyMesh, atlas);
    if (split) {
      // Rename so the runtime distinguishes a fleet body (offline paint) from
      // the flagship body, but the GLASS material name is shared so one runtime
      // rule (`/glass/`) tints both.
      for (const prim of bodyMesh.listPrimitives()) {
        const m = prim.getMaterial();
        if (m && m.getName() === 'apex-body') m.setName('apex-fleet-body');
      }
    }
  }
  if (!split) {
    // Fallback: no detectable glass swatch — give the whole body one textureless
    // paint material (the pre-P0-2 behaviour).
    const bodyMat = doc.createMaterial('apex-fleet-body');
    bodyMat.setBaseColorFactor([0.9, 0.92, 0.94, 1]);
    bodyMat.setMetallicFactor(0.5);
    bodyMat.setRoughnessFactor(0.3);
    for (const prim of bodyMesh?.listPrimitives() ?? []) prim.setMaterial(bodyMat);
  }
  console.log(`  fleet/${outName}: glass split ${split ? 'OK' : 'skipped'}`);

  // Keep the wheel atlas; just clean the graph (no simplify — already low-poly).
  await doc.transform(
    flatten(),
    dedup(),
    weld({ tolerance: 0.0001 }),
    // NOTE: do NOT join primitives — joining would merge the textureless body
    // into the textured wheels (different materials block the join, but keep the
    // body and wheel meshes as separate named groups regardless).
    prune({ keepLeaves: false }),
  );
  await io.write(out, doc);
  return out;
}

async function report(label, out, root) {
  const { size } = await stat(out);
  let tris = 0;
  root.listMeshes().forEach((m) =>
    m.listPrimitives().forEach((p) => {
      const idx = p.getIndices();
      if (idx) tris += idx.getCount() / 3;
    }),
  );
  console.log(
    `${label}: ${(size / 1024).toFixed(1)} KB · ${Math.round(tris)} tris · ` +
      `${root.listMeshes().length} meshes · ${root.listTextures().length} textures · ` +
      `ext=[${root.listExtensionsUsed().map((e) => e.extensionName).join(',') || 'none'}]`,
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(OUT_DIR, 'fleet'), { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  const bodyOut = await buildBody(io);
  await report('apex-suv.glb', bodyOut, (await io.read(bodyOut)).getRoot());

  const wheels = [
    ['wheel-default.glb', 'wheel-default.glb', 'aero'],
    ['wheel-dark.glb', 'wheel-dark.glb', 'turbine'],
    ['wheel-racing.glb', 'wheel-racing.glb', 'forged'],
  ];
  for (const [srcName, outName, finish] of wheels) {
    const out = await buildWheel(io, srcName, outName, finish);
    await report(outName, out, (await io.read(out)).getRoot());
  }

  // --- PASS B: the four non-flagship fleet cars (whole car, own wheels) -----
  const fleet = [
    ['sedan-sports.glb', 'stratos.glb'],
    ['suv.glb', 'terra.glb'],
    ['sedan.glb', 'vella.glb'],
    ['hatchback-sports.glb', 'mira.glb'],
  ];
  for (const [srcName, outName] of fleet) {
    const out = await buildFleetCar(io, srcName, outName);
    await report(`fleet/${outName}`, out, (await io.read(out)).getRoot());
  }

  console.log(
    '\nDone — body-only SUV + 3 wheel GLBs + 4 fleet cars ' +
      '(textureless body, kept wheel atlas, uncompressed, no WASM decoder).',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
