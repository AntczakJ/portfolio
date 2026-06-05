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

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '.model-src', 'car-kit', 'Models', 'GLB format');
const OUT_DIR = join(HERE, '..', 'public', 'models');

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

/** Build the body-only SUV: drop the four in-body wheel meshes. */
async function buildBody(io) {
  const src = join(SRC_DIR, 'suv-luxury.glb');
  const out = join(OUT_DIR, 'apex-suv.glb');
  const doc = await io.read(src);
  const root = doc.getRoot();

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

  await stripTexturesAndClean(doc);

  // Name the single remaining body material so the runtime can find it robustly
  // even after join/dedup renames the others.
  for (const mat of root.listMaterials()) {
    mat.setName('apex-body');
  }

  await io.write(out, doc);
  return out;
}

/** Build one wheel GLB: KEEP the colormap atlas (tire/rim distinction), clean. */
async function buildWheel(io, srcName, outName) {
  const src = join(SRC_DIR, srcName);
  const out = join(OUT_DIR, outName);
  const doc = await io.read(src);
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

  // The single shared `colormap` material is used by BOTH the body and the
  // wheels. Split it: give the body a brand-new textureless material (so the
  // runtime owns its paint), and leave the wheels on the (kept) textured atlas.
  const wheelMat = root.listMaterials().find((m) => m.getName() === 'colormap');
  const bodyMat = doc.createMaterial('apex-fleet-body');
  bodyMat.setBaseColorFactor([0.9, 0.92, 0.94, 1]);
  bodyMat.setMetallicFactor(0.5);
  bodyMat.setRoughnessFactor(0.3);
  // Strip the body material's texture reference by reassigning the body mesh's
  // primitives to the new textureless material.
  for (const mesh of root.listMeshes()) {
    const isBody = mesh.getName() === 'body';
    for (const prim of mesh.listPrimitives()) {
      if (isBody) prim.setMaterial(bodyMat);
    }
  }
  // Keep the wheel atlas; just clean the graph (no simplify — already low-poly).
  void wheelMat;
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
    ['wheel-default.glb', 'wheel-default.glb'],
    ['wheel-dark.glb', 'wheel-dark.glb'],
    ['wheel-racing.glb', 'wheel-racing.glb'],
  ];
  for (const [srcName, outName] of wheels) {
    const out = await buildWheel(io, srcName, outName);
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
