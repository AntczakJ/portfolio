// @ts-nocheck
/* eslint-disable */
/**
 * verify-model.mjs — read back the OPTIMIZED GLB and list its materials +
 * meshes, so the runtime material/wheel mapping can be authored against real
 * names. NOTE (model-swap PASS A): the shipped GLBs are UNCOMPRESSED (CC0
 * Kenney kit), so there is no meshopt round-trip to prove anymore — the decoder
 * registration below is harmless/unused. Run: node scripts/verify-model.mjs
 */
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? join(HERE, '..', 'public', 'models', 'apex-suv.glb');

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(SRC);
const root = doc.getRoot();

console.log('=== SURVIVING MATERIALS ===');
root.listMaterials().forEach((m, i) => {
  const b = m.getBaseColorFactor();
  console.log(
    `  [${i}] "${m.getName()}" base=[${b.map((n) => n.toFixed(2)).join(',')}] ` +
      `metal=${m.getMetallicFactor().toFixed(2)} rough=${m.getRoughnessFactor().toFixed(2)}` +
      (m.getAlphaMode() !== 'OPAQUE' ? ` alpha=${m.getAlphaMode()}(${b[3].toFixed(2)})` : ''),
  );
});

console.log('\n=== SURVIVING MESHES ===');
root.listMeshes().forEach((mesh, i) => {
  let tris = 0;
  const mats = new Set();
  mesh.listPrimitives().forEach((p) => {
    const idx = p.getIndices();
    if (idx) tris += idx.getCount() / 3;
    const mat = p.getMaterial();
    if (mat) mats.add(mat.getName());
  });
  console.log(`  [${i}] "${mesh.getName()}" tris~=${Math.round(tris)} mats={${[...mats].join(',')}}`);
});

console.log('\n=== NODE TREE ===');
function walk(n, d) {
  const m = n.getMesh();
  console.log(`${'  '.repeat(d + 1)}"${n.getName()}"${m ? ` -> ${m.getName()}` : ''}`);
  n.listChildren().forEach((c) => walk(c, d + 1));
}
root.listScenes().forEach((s) => s.listChildren().forEach((c) => walk(c, 0)));

let t = 0;
root.listMeshes().forEach((m) => m.listPrimitives().forEach((p) => {
  const idx = p.getIndices(); if (idx) t += idx.getCount() / 3;
}));
console.log(`\nTOTAL tris=${Math.round(t)} meshes=${root.listMeshes().length} materials=${root.listMaterials().length}`);
