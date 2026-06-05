'use client';

import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  MODEL_TRANSFORM,
  WHEEL_MODEL_URLS,
  WHEEL_NODES,
  resolvePaint,
  resolveWheel,
  type PaintParams,
} from '@/lib/r3f/rig';

/**
 * The live "APEX Lumen SUV" configurator model (model-swap PASS A).
 *
 * MODEL: the CC0 **Kenney "Car Kit" v3.1** `suv-luxury` (an UNBADGED low-poly
 * luxury SUV) — royalty-clear, no manufacturer trademark exposure. Optimized at
 * author time (`web/scripts/optimize-model.mjs`) into:
 *   - `public/models/apex-suv.glb`  — the BODY only (one `body` mesh, textures
 *     dropped); the four in-body wheels are removed.
 *   - `public/models/wheel-{default,dark,racing}.glb` — separate wheel GLBs,
 *     instanced at the four wheel-node positions for a genuine wheel-GEOMETRY
 *     swap.
 * All four are tiny, textureless, UNCOMPRESSED GLBs → NO meshopt/draco decoder,
 * NO WebAssembly at load, so the CSP needs no `'wasm-unsafe-eval'`. Provenance +
 * the swap-for-real path are in CREDITS.md.
 *
 * PAINT (the key PASS-A mechanism): Kenney encodes paint colour as a UV region
 * on a shared `colormap` atlas — so we do NOT tint the atlas. Instead the body
 * mesh is assigned a CUSTOM `MeshPhysicalMaterial` we fully control: NO
 * baseColorTexture, `clearcoat` for a premium automotive sheen on the flat-
 * shaded forms, and `color` driven by the configurator paint swatch.
 *
 * WHEELS: the chosen wheel GLB (`resolveWheel(wheelId).modelUrl`) is instanced
 * at the four `WHEEL_NODES` (right side yawed π so the face points outboard).
 * The three wheel GLBs (default/dark/racing) differ in BOTH rim geometry AND
 * baked rim colour (their `colormap` atlas is KEPT — see optimize-model.mjs), so
 * the swatch is a genuine wheel-SET swap with proper tire/rim separation; we do
 * NOT override the wheel material (overriding it erased the tire/rim distinction
 * and made the rim invisible).
 *
 * The body clone is per-instance so live material edits never leak into the
 * cached GLTF or the offline render.
 */

interface LumenModelProps {
  colorId: string;
  wheelId: string;
}

const BODY_URL = '/models/apex-suv.glb';

/**
 * Offline-render overrides (the `render-from-scene.mjs` harness ONLY — never set
 * in normal app use, exactly like `__APEX_YAW`). They let the SAME live R3F
 * scene — same rig, same studio lighting, same clearcoat paint mechanism —
 * render the four non-flagship FLEET bodies for their static card AVIFs, so all
 * five fleet cards read as ONE studio line-up (model-swap PASS B / N-1):
 *   - `__APEX_BODY_URL`  : load a different body GLB (a `public/models/fleet/*`
 *                          fleet car) instead of the flagship `apex-suv.glb`.
 *   - `__APEX_PAINT`     : a `{color,metalness,roughness,clearcoat,
 *                          clearcoatRoughness}` paint override for that body.
 *   - `__APEX_OWN_WHEELS`: render the body's OWN bundled wheels (a fleet car is
 *                          a whole car) and SKIP the swapped wheel-GLB instances.
 */
function getOfflineOverrides(): {
  bodyUrl: string;
  paint: PaintParams | undefined;
  ownWheels: boolean;
} {
  if (typeof window === 'undefined') {
    return { bodyUrl: BODY_URL, paint: undefined, ownWheels: false };
  }
  const w = window as unknown as {
    __APEX_BODY_URL?: string;
    __APEX_PAINT?: PaintParams;
    __APEX_OWN_WHEELS?: boolean;
  };
  return {
    bodyUrl: typeof w.__APEX_BODY_URL === 'string' ? w.__APEX_BODY_URL : BODY_URL,
    paint: w.__APEX_PAINT,
    ownWheels: w.__APEX_OWN_WHEELS === true,
  };
}

export function LumenModel({ colorId, wheelId }: LumenModelProps): React.ReactNode {
  // useGLTF(path, useDraco=false, useMeshopt=false): our GLBs are uncompressed,
  // so we DISABLE both decoders. This is load-bearing: drei defaults BOTH to
  // true, and `useMeshopt=true` eagerly instantiates the meshopt WASM decoder
  // (violating the tightened CSP — there is no `'wasm-unsafe-eval'` anymore),
  // while `useDraco=true` would fetch a draco decoder from a gstatic CDN
  // (violating `connect-src 'self'`). With both off there is NO WASM + NO CDN.
  // The offline overrides are read from `window` globals set ONCE by the render
  // harness before mount and never mutated at runtime, so they are stable for
  // the component's lifetime. Memoising with an empty dep list captures that
  // (a fresh object each render would needlessly re-clone the scene) and lets
  // the effects below depend on the stable values without an exhaustive-deps
  // escape hatch.
  const overrides = useMemo(() => getOfflineOverrides(), []);
  const gltf = useGLTF(overrides.bodyUrl, false, false);
  const wheelSpec = resolveWheel(wheelId);
  const wheelGltf = useGLTF(wheelSpec.modelUrl, false, false);

  // The scene runs `frameloop="demand"`, so a material/geometry edit alone does
  // NOT repaint — we must `invalidate()` after every paint/wheel swap or the new
  // colour/wheel never shows until an unrelated render (orbit/theme) fires.
  const invalidate = useThree((s) => s.invalidate);

  // --- Body --------------------------------------------------------------
  // Clone the body scene once per mount; assign the single `body` mesh a custom
  // clearcoat MeshPhysicalMaterial we own (the atlas texture is already dropped
  // at author time, so there is nothing to fight).
  const { bodyScene, bodyMaterial } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    const material = new THREE.MeshPhysicalMaterial({
      color: '#e9edf1',
      metalness: 0.45,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.1,
    });
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        // In offline FLEET mode the body GLB is a WHOLE car (body + bundled
        // wheels): paint ONLY the `body` mesh and leave the wheel meshes on
        // their authored atlas (tire/rim distinction). The flagship body GLB has
        // only the body mesh, so painting everything there is equivalent.
        const isWheel = /^wheel/i.test(obj.name);
        if (!overrides.ownWheels || !isWheel) {
          obj.material = material;
        } else if (obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.envMapIntensity = 1.1;
        }
      }
    });
    return { bodyScene: scene, bodyMaterial: material };
  }, [gltf.scene, overrides.ownWheels]);

  // --- Wheels ------------------------------------------------------------
  // Clone the chosen wheel scene FOUR times (one per node). Re-cloned whenever
  // the wheel id changes (a real geometry swap). The wheel keeps its AUTHORED
  // material (the Kenney colormap atlas — tire black, rim per-variant colour);
  // we do NOT override it. Bump envMapIntensity so the rim catches the studio.
  const wheelInstances = useMemo(() => {
    return WHEEL_NODES.map((node) => {
      const inst = wheelGltf.scene.clone(true);
      inst.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) {
              m.envMapIntensity = 1.1;
            }
          }
        }
      });
      return { inst, node };
    });
  }, [wheelGltf.scene]);

  // Apply the live paint to the body material whenever the colour changes.
  // `overrides.paint` is an offline-only escape hatch (in normal app use it is
  // undefined and `colorId` drives the paint); it is stable for the component's
  // lifetime (memoised above), so listing it in deps is safe.
  useEffect(() => {
    const paint = overrides.paint ?? resolvePaint(colorId);
    bodyMaterial.color.set(paint.color);
    bodyMaterial.metalness = paint.metalness;
    bodyMaterial.roughness = paint.roughness;
    bodyMaterial.clearcoat = paint.clearcoat;
    bodyMaterial.clearcoatRoughness = paint.clearcoatRoughness;
    bodyMaterial.needsUpdate = true;
    invalidate();
  }, [colorId, bodyMaterial, invalidate, overrides.paint]);

  // Invalidate when the wheel set changes (a real geometry swap under
  // `frameloop="demand"` must request a repaint).
  useEffect(() => {
    invalidate();
  }, [wheelId, wheelInstances, invalidate]);

  // Dispose the per-instance cloned GPU resources on unmount (P2-1). The custom
  // body material is created here (always dispose). Cloned geometry is SHARED
  // with the module-cached GLTF by `clone(true)`, so we never dispose geometry
  // whose uuid exists in the original cached scenes. The wheel keeps its authored
  // (shared, cached) material — never disposed here.
  useEffect(() => {
    const originalGeometryUuids = new Set<string>();
    for (const src of [gltf.scene, wheelGltf.scene]) {
      src.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const geometry = obj.geometry as THREE.BufferGeometry;
          originalGeometryUuids.add(geometry.uuid);
        }
      });
    }
    return () => {
      bodyMaterial.dispose();
      const disposeUnique = (root: THREE.Object3D) => {
        root.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            const geometry = obj.geometry as THREE.BufferGeometry;
            if (!originalGeometryUuids.has(geometry.uuid)) {
              geometry.dispose();
            }
          }
        });
      };
      disposeUnique(bodyScene);
      for (const { inst } of wheelInstances) disposeUnique(inst);
    };
  }, [gltf.scene, wheelGltf.scene, bodyScene, wheelInstances, bodyMaterial]);

  const ref = useRef<THREE.Group>(null);

  // Framing-tuning escape hatch (offline render harness only): a global yaw
  // override lets the rig framing be iterated without a rebuild. Never set in
  // normal app use; the static MODEL_TRANSFORM is the shipped value.
  const yawOverride =
    typeof window !== 'undefined'
      ? (window as unknown as { __APEX_YAW?: number }).__APEX_YAW
      : undefined;
  const rotation: [number, number, number] =
    typeof yawOverride === 'number'
      ? [MODEL_TRANSFORM.rotation[0], yawOverride, MODEL_TRANSFORM.rotation[2]]
      : [...MODEL_TRANSFORM.rotation];

  return (
    <group
      ref={ref}
      position={MODEL_TRANSFORM.position}
      rotation={rotation}
      scale={MODEL_TRANSFORM.scale}
    >
      <primitive object={bodyScene} />
      {/* Swapped wheel-GLB instances: the flagship configurator path only. In
          offline FLEET mode the body GLB carries its own bundled wheels, so the
          instanced wheels are skipped (no double wheels). */}
      {!overrides.ownWheels &&
        wheelInstances.map(({ inst, node }, i) => (
          <group
            key={i}
            position={[...node.position]}
            rotation={[0, node.yaw, 0]}
          >
            <primitive object={inst} />
          </group>
        ))}
    </group>
  );
}

useGLTF.preload(BODY_URL, false, false);
for (const url of WHEEL_MODEL_URLS) useGLTF.preload(url, false, false);
