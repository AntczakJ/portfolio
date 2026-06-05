/**
 * The shared camera / lighting / paint rig (ADR-004 "one rig, three outputs").
 *
 * The static hero render (the LCP), the pre-baked colour×wheel matrix stills,
 * AND the live R3F scene must all use the SAME camera + lighting + paint
 * mapping — otherwise the reveal-when-ready crossfade pops (camera mismatch)
 * and the Tier-3 stills drift from the live scene. The matrix + hero stills are
 * RE-RENDERED offline from this exact rig + the real GLB via
 * `web/scripts/render-from-scene.mjs`, so Tier-1 and Tier-3 are literally the
 * same car.
 *
 * Pure data + small resolvers — no three.js import here, so the (Node) matrix
 * generator AND the client scene both read it without pulling the WebGL runtime
 * into a non-canvas module.
 *
 * MODEL FRAME (model-swap PASS A — the CC0 Kenney "Car Kit" `suv-luxury`):
 * a low-poly stylized luxury SUV. Body GLB bounds (object space, sitting on the
 * floor): x ∈ [−0.75, 0.75], y ∈ [0, 1.17], z ∈ [−1.43, 1.43] — width 1.5 m,
 * height 1.17 m, LENGTH 2.85 m along Z. The NOSE is +Z (front wheels at
 * z = +0.81). MUCH smaller than the previous Maybach GLB, so the camera distance
 * + target + fov are re-fit here. We frame a flattering FRONT 3/4 from the +Z/+X
 * quadrant, slightly above the beltline, keeping the upper-hemisphere-only orbit
 * (never the underside, never top-down, never a header clip).
 *
 * ART DIRECTION (PASS A): the model is flat-shaded / low-poly, NOT photoreal.
 * The target is "clean STYLIZED premium product-viz" (Polestar / Linear-grade
 * minimal 3D) — excellent studio lighting on flat forms, a tasteful clearcoat on
 * the body paint, a crisp contact shadow + studio sweep, restrained accent. The
 * faceted normals catch the light cleanly; a clean low-poly car in a beautiful
 * studio reads as intentional design, not a toy.
 */

/** A flattering studio 3/4-front view of the ~2.85 m low-poly SUV. */
export const RIG_CAMERA = {
  /**
   * Front-right and slightly high, looking across the FRONT 3/4 (the nose is +Z;
   * the model is yawed a touch below so the grille swings toward camera). Fit to
   * the small (~2.85 m long, ~1.5 m wide) model — a ~4.7-unit eye distance.
   */
  position: [3.25, 2.0, 3.68] as const,
  /**
   * Look at the beltline (~0.6 of the 1.17 m height) so the roofline keeps
   * vertical headroom and never tucks under the sticky header at any scroll
   * offset. P1-E: the eye distance was pulled back (~4.7 → ~5.1) so the whole
   * car sits with margin on the LIVE stage too — the live `<Canvas>` adapts the
   * camera's vertical fov to the container, and on the narrowest stage aspect
   * (portrait mobile `5/6`) the previous distance let the roofline graze the top
   * edge. The hero/matrix offline crops shoot from this SAME rig (one rig, three
   * outputs), so the reveal-when-ready crossfade still pose-matches.
   */
  target: [0, 0.6, 0] as const,
  fov: 32,
  near: 0.1,
  far: 100,
} as const;

/**
 * Static placement of the model in the scene. The body GLB is authored sitting
 * on the floor with length along Z and nose at +Z; we yaw it ~+12° so the front
 * 3/4 (grille + headlights) faces the rig camera in the +Z/+X quadrant.
 */
export const MODEL_TRANSFORM = {
  position: [0, 0, 0] as const,
  rotation: [0, Math.PI * 0.07, 0] as const,
  scale: 1 as const,
} as const;

/**
 * Wheel-node local positions captured from the source `suv-luxury.glb` (the
 * runtime instances the chosen wheel GLB at each — a genuine wheel-GEOMETRY
 * swap). Left wheels at +X, right at −X; front at +Z, back at −Z. Wheel radius
 * ≈ 0.30, so the centres sit at y = 0.30 (kissing the floor). The wheel GLB's
 * axle axis is X (width 0.40 along X), so the right side is mirrored (yaw π) so
 * any face detail points outboard.
 */
export interface WheelNode {
  position: readonly [number, number, number];
  /** Y-rotation so the wheel face points outboard (right side mirrored). */
  yaw: number;
  side: 'left' | 'right';
}

export const WHEEL_NODES: readonly WheelNode[] = [
  { position: [0.3, 0.3, 0.81], yaw: 0, side: 'left' }, // front-left
  { position: [-0.3, 0.3, 0.81], yaw: Math.PI, side: 'right' }, // front-right
  { position: [0.3, 0.3, -0.71], yaw: 0, side: 'left' }, // back-left
  { position: [-0.3, 0.3, -0.71], yaw: Math.PI, side: 'right' }, // back-right
] as const;

/**
 * Orbit constraints — damped, bounded to the UPPER hemisphere only. The polar
 * window keeps the camera between a gentle high 3/4 and just above horizontal,
 * so the orbit NEVER shows the underside / floor pan and never goes top-down.
 * Pan disabled so the car stays centred. Distance bounds re-fit to the small
 * model (eye distance ≈ 4.7).
 */
export const RIG_ORBIT = {
  enablePan: false,
  enableZoom: true,
  minDistance: 3.4,
  maxDistance: 7,
  /** ~58° from +Y at the top of the orbit (a gentle high 3/4, never top-down). */
  minPolarAngle: Math.PI * 0.32,
  /** ~83° from +Y at the bottom — just above horizontal, never under the car. */
  maxPolarAngle: Math.PI * 0.46,
  dampingFactor: 0.08,
  rotateSpeed: 0.7,
  /** Gentle idle auto-orbit (Tier 1 only; disabled under reduced motion). */
  autoRotateSpeed: 0.4,
} as const;

/**
 * Paint resolver: maps a configurator colour id to physical-material params for
 * the BODY PAINT material of the live SUV. The body uses a CUSTOM
 * `MeshPhysicalMaterial` (NO texture — Kenney's colour-atlas is dropped at
 * author time) with `clearcoat`, so we control colour + finish fully and get a
 * premium automotive sheen on the flat-shaded forms. The body hex matches
 * `seed-data.ts` / the matrix-still palette so the live car and the stills agree.
 */
export interface PaintParams {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

const PAINTS: Record<string, PaintParams> = {
  'col-glacier': {
    color: '#e9edf1',
    metalness: 0.45,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
  },
  'col-graphite': {
    color: '#2b313a',
    metalness: 0.68,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
  },
  'col-voltaic': {
    color: '#18c08a',
    metalness: 0.4,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
  },
  'col-midnight': {
    color: '#16243f',
    metalness: 0.72,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
  },
};

const FALLBACK_PAINT: PaintParams = {
  color: '#e9edf1',
  metalness: 0.45,
  roughness: 0.32,
  clearcoat: 1,
  clearcoatRoughness: 0.16,
};

export function resolvePaint(colorId: string): PaintParams {
  return PAINTS[colorId] ?? FALLBACK_PAINT;
}

/**
 * Wheel resolver. Each wheel id maps to a separate CC0 wheel GLB (instanced at
 * the four `WHEEL_NODES`) — a genuine wheel-GEOMETRY swap. The finish is carried
 * by the wheel's AUTHORED atlas, which `optimize-model.mjs` RE-TINTS at author
 * time (P1-C) so each set matches its copy and the tyre reads as dark rubber
 * (the raw kit baked a tan tyre + an orange aero rim that read as a "rusted toy
 * wheel"):
 *   - Aero    (wheel-default) = polished machined silver.
 *   - Turbine (wheel-dark)    = dark graphite.
 *   - Forged  (wheel-racing)  = a voltaic-tinted machined finish — the one
 *     signature accent wheel.
 * The `color`/`metalness`/`roughness` fields below are documentation of the
 * INTENDED finish (mirrored by the atlas re-tint); the runtime keeps the
 * authored, re-tinted atlas material rather than overriding it, so the tyre/rim
 * distinction survives.
 */
export interface WheelSpec {
  /** Public URL of the wheel GLB instanced at the four wheel nodes. */
  modelUrl: string;
  color: string;
  metalness: number;
  roughness: number;
}

const WHEEL_SPECS: Record<string, WheelSpec> = {
  // Bright polished machined silver — near-mirror, the lightest of the three.
  'whl-aero': {
    modelUrl: '/models/wheel-default.glb',
    color: '#eef2f6',
    metalness: 1,
    roughness: 0.12,
  },
  // True dark graphite — deep anthracite, matte-ish, the darkest of the three.
  'whl-turbine': {
    modelUrl: '/models/wheel-dark.glb',
    color: '#23272d',
    metalness: 1,
    roughness: 0.46,
  },
  // Voltaic-tinted racing — a saturated green-cyan brushed metal, the coloured
  // signature finish (the one accent moment on the wheel).
  'whl-forged': {
    modelUrl: '/models/wheel-racing.glb',
    color: '#1f9e78',
    metalness: 0.95,
    roughness: 0.3,
  },
};

const FALLBACK_WHEEL: WheelSpec = {
  modelUrl: '/models/wheel-default.glb',
  color: '#eef2f6',
  metalness: 1,
  roughness: 0.12,
};

export function resolveWheel(wheelId: string): WheelSpec {
  return WHEEL_SPECS[wheelId] ?? FALLBACK_WHEEL;
}

/** Every wheel GLB url, for `useGLTF.preload`. */
export const WHEEL_MODEL_URLS = Object.values(WHEEL_SPECS).map((w) => w.modelUrl);
