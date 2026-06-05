// @ts-nocheck
/* eslint-disable */
/**
 * inspect-model.mjs — dump the node / mesh / material graph of a GLB so the
 * frontend-engineer can map the BODY-PAINT material(s) to the colour swatches
 * and the WHEEL/RIM mesh(es) to the wheel swatches (Task 6.2 / D-01).
 *
 * Read-only. Does NOT modify the source GLB. Run:
 *   node scripts/inspect-model.mjs "<absolute path to .glb>"
 *
 * Output: a structured listing of scenes, nodes (with mesh refs + world-ish
 * hints), meshes (primitive count, vertex/triangle estimate), and materials
 * (name, base-colour factor, metallic/rough, texture slots). Plus bounding-box
 * extents so the rig camera distance can be re-fit to the real model.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const SRC = process.argv[2];
if (!SRC) {
  console.error('Usage: node scripts/inspect-model.mjs "<path to .glb>"');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

console.log('=== EXTENSIONS USED ===');
console.log(root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '(none)');

console.log('\n=== MATERIALS ===');
root.listMaterials().forEach((m, i) => {
  const base = m.getBaseColorFactor();
  const slots = [];
  if (m.getBaseColorTexture()) slots.push('baseColor');
  if (m.getMetallicRoughnessTexture()) slots.push('metalRough');
  if (m.getNormalTexture()) slots.push('normal');
  if (m.getEmissiveTexture()) slots.push('emissive');
  if (m.getOcclusionTexture()) slots.push('occlusion');
  console.log(
    `  [${i}] "${m.getName()}" base=[${base.map((n) => n.toFixed(2)).join(',')}] ` +
      `metal=${m.getMetallicFactor().toFixed(2)} rough=${m.getRoughnessFactor().toFixed(2)} ` +
      `transmission=${m.getExtension('KHR_materials_transmission') ? 'yes' : 'no'} ` +
      `tex={${slots.join(',') || 'none'}}`,
  );
});

console.log('\n=== MESHES (primitive vertex/tri estimate) ===');
root.listMeshes().forEach((mesh, i) => {
  let verts = 0;
  let tris = 0;
  const mats = new Set();
  mesh.listPrimitives().forEach((p) => {
    const pos = p.getAttribute('POSITION');
    if (pos) verts += pos.getCount();
    const idx = p.getIndices();
    if (idx) tris += idx.getCount() / 3;
    const mat = p.getMaterial();
    if (mat) mats.add(mat.getName());
  });
  console.log(
    `  [${i}] "${mesh.getName()}" prims=${mesh.listPrimitives().length} ` +
      `verts=${verts} tris~=${Math.round(tris)} mats={${[...mats].join(',')}}`,
  );
});

console.log('\n=== TEXTURES ===');
root.listTextures().forEach((t, i) => {
  const img = t.getImage();
  const size = t.getSize();
  console.log(
    `  [${i}] "${t.getName()}" mime=${t.getMimeType()} ` +
      `size=${size ? size.join('x') : '?'} bytes=${img ? img.byteLength : 0}`,
  );
});

// Node tree (depth-limited) with mesh refs — the key to mapping wheels.
console.log('\n=== NODE TREE (name -> mesh) ===');
function walk(node, depth) {
  const mesh = node.getMesh();
  const t = node.getTranslation();
  console.log(
    `${'  '.repeat(depth + 1)}"${node.getName()}"` +
      (mesh ? ` -> mesh "${mesh.getName()}"` : '') +
      ` @[${t.map((n) => n.toFixed(2)).join(',')}]`,
  );
  node.listChildren().forEach((c) => walk(c, depth + 1));
}
root.listScenes().forEach((scene, i) => {
  console.log(`  Scene[${i}] "${scene.getName()}"`);
  scene.listChildren().forEach((c) => walk(c, 0));
});

// Bounding box over all mesh positions (object space, ignoring node transforms
// is a rough estimate; good enough to size the rig).
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
root.listMeshes().forEach((mesh) => {
  mesh.listPrimitives().forEach((p) => {
    const pos = p.getAttribute('POSITION');
    if (!pos) return;
    const el = [0, 0, 0];
    for (let k = 0; k < pos.getCount(); k++) {
      pos.getElement(k, el);
      for (let a = 0; a < 3; a++) {
        if (el[a] < min[a]) min[a] = el[a];
        if (el[a] > max[a]) max[a] = el[a];
      }
    }
  });
});
console.log('\n=== BBOX (object-space, no node transforms) ===');
console.log(`  min=[${min.map((n) => n.toFixed(2)).join(',')}]`);
console.log(`  max=[${max.map((n) => n.toFixed(2)).join(',')}]`);
console.log(
  `  size=[${max.map((m, a) => (m - min[a]).toFixed(2)).join(',')}]`,
);

console.log('\n=== TOTALS ===');
let totalTris = 0;
root.listMeshes().forEach((mesh) =>
  mesh.listPrimitives().forEach((p) => {
    const idx = p.getIndices();
    if (idx) totalTris += idx.getCount() / 3;
  }),
);
console.log(`  materials=${root.listMaterials().length}`);
console.log(`  meshes=${root.listMeshes().length}`);
console.log(`  textures=${root.listTextures().length}`);
console.log(`  triangles~=${Math.round(totalTris)}`);
