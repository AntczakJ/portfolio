// @ts-nocheck
/* eslint-disable */
/**
 * analyze-model.mjs — second-pass analysis to plan the optimization + the
 * material/wheel mapping (Task 6.2). Computes WORLD-space bbox (applying node
 * transforms), groups triangle counts by material, and flags the interior mass
 * we can prune for an exterior-only configurator shot.
 *
 * Read-only. Run: node scripts/analyze-model.mjs "<path to .glb>"
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const SRC = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

// Triangle count per material name.
const byMat = new Map();
root.listMeshes().forEach((mesh) => {
  mesh.listPrimitives().forEach((p) => {
    const idx = p.getIndices();
    const tris = idx ? idx.getCount() / 3 : 0;
    const mat = p.getMaterial();
    const name = mat ? mat.getName() : '(none)';
    byMat.set(name, (byMat.get(name) ?? 0) + tris);
  });
});
console.log('=== TRIANGLES BY MATERIAL (desc) ===');
[...byMat.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, tris]) => console.log(`  ${Math.round(tris).toString().padStart(8)}  ${name}`));

// World-space bbox by walking the scene graph and composing matrices.
// Column-major 4x4, inline (no gl-matrix dep).
function identity() {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}
function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
  return o;
}
function fromTRS(t, q, s) {
  const [x,y,z,w] = q;
  const x2=x+x, y2=y+y, z2=z+z;
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2;
  const wx=w*x2, wy=w*y2, wz=w*z2;
  const [sx,sy,sz] = s;
  return [
    (1-(yy+zz))*sx, (xy+wz)*sx, (xz-wy)*sx, 0,
    (xy-wz)*sy, (1-(xx+zz))*sy, (yz+wx)*sy, 0,
    (xz+wy)*sz, (yz-wx)*sz, (1-(xx+yy))*sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function transform(m, p) {
  const [x,y,z] = p;
  return [
    m[0]*x+m[4]*y+m[8]*z+m[12],
    m[1]*x+m[5]*y+m[9]*z+m[13],
    m[2]*x+m[6]*y+m[10]*z+m[14],
  ];
}
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
function walk(node, parent) {
  const local = fromTRS(node.getTranslation(), node.getRotation(), node.getScale());
  const world = multiply(parent, local);
  const mesh = node.getMesh();
  if (mesh) {
    mesh.listPrimitives().forEach((p) => {
      const pos = p.getAttribute('POSITION');
      if (!pos) return;
      const el = [0, 0, 0];
      for (let k = 0; k < pos.getCount(); k++) {
        pos.getElement(k, el);
        const out = transform(world, el);
        for (let a = 0; a < 3; a++) {
          if (out[a] < min[a]) min[a] = out[a];
          if (out[a] > max[a]) max[a] = out[a];
        }
      }
    });
  }
  node.listChildren().forEach((c) => walk(c, world));
}
const I = identity();
root.listScenes().forEach((scene) => scene.listChildren().forEach((c) => walk(c, I)));
console.log('\n=== WORLD-SPACE BBOX ===');
console.log(`  min=[${min.map((n) => n.toFixed(2)).join(',')}]`);
console.log(`  max=[${max.map((n) => n.toFixed(2)).join(',')}]`);
console.log(`  size=[${max.map((m, a) => (m - min[a]).toFixed(2)).join(',')}]`);
console.log(`  center=[${max.map((m, a) => ((m + min[a]) / 2).toFixed(2)).join(',')}]`);
