'use client';

import {
  AdaptiveDpr,
  AdaptiveEvents,
  Backdrop,
  ContactShadows,
  Environment,
  Lightformer,
  MeshReflectorMaterial,
  OrbitControls,
  PerformanceMonitor,
} from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';

import { useConfiguratorStore } from '@/lib/store/configurator-store';
import { RIG_CAMERA, RIG_ORBIT } from '@/lib/r3f/rig';
import { getSeamState, setSeamReady, subscribeSeam } from '@/lib/r3f/seam';

import { LumenModel } from './lumen-model';

/**
 * The live R3F configurator scene (Task 6.2) — the wow centrepiece, now driving
 * the REAL optimized GLB (D-01). The ONLY module besides `lumen-model.tsx` that
 * imports three.js / fiber / drei, reached exclusively through the
 * `next/dynamic ssr:false` wrapper, so three.js stays code-split out of the
 * initial bundle (ADR-002 P1).
 *
 * Task 6.2 fixes folded in here:
 *   - D-05 studio: a floor-to-wall gradient sweep (`Backdrop`) + a soft planar
 *     reflection floor (`MeshReflectorMaterial`) + the contact shadow, so the
 *     car is grounded in a studio, not floating on the flat page colour.
 *   - D-06 theme: the `Environment` / key light / exposure are RE-KEYED on
 *     `html.dark` — a real night-studio register (darker env, accent-tinted key,
 *     lower exposure), not a bright studio in a dark frame. `theme` is threaded
 *     in from the stage.
 *   - D-09 accent restraint: ONE signature accent moment — a single voltaic rim
 *     light grazing the body — not glow-everywhere.
 *
 * MODEL-SWAP PASS A: the model is now a flat-shaded / low-poly CC0 SUV (much
 * smaller than the old GLB — ~2.85 m long). The lighting + studio dimensions are
 * re-tuned for that: a strong, crisp KEY so the faceted normals catch light
 * cleanly (low-poly reads premium when each facet has a clear value step), a
 * soft broad FILL so the flat faces never go muddy, the clearcoat body picking
 * up the `Lightformer` panels, and the contact shadow / floor / backdrop scaled
 * to the small model while staying beyond the orbit frustum.
 *   - D-15 single camera owner at the seam: `IntroCamera` OWNS the camera while
 *     seam progress < 1; `OrbitControls` is disabled until then and only takes
 *     over once progress reaches 1 (or immediately under reduced motion). The
 *     two never write the camera simultaneously. GSAP→R3F coupling stays
 *     one-directional (R3F reads seam progress; never writes back).
 */

export type SceneTheme = 'light' | 'dark';

interface ConfiguratorSceneProps {
  reveal: boolean;
  autoRotate: boolean;
  onDemote: () => void;
  theme: SceneTheme;
}

/**
 * Per-theme studio keys (D-06), re-tuned for the flat-shaded low-poly model
 * (PASS A). A slightly higher key intensity + a crisper fill so each facet has a
 * clean value step (the difference between "intentional low-poly product" and
 * "flat toy"); slightly lower ambient so the key reads.
 */
const STUDIO = {
  light: {
    backdropColor: '#e9edf1',
    floorColor: '#dfe4ea',
    floorMetalness: 0.6,
    floorRoughness: 0.7,
    ambient: 0.42,
    keyIntensity: 2.7,
    keyColor: '#ffffff',
    fillColor: '#cfe0f0',
    fillIntensity: 0.8,
    envIntensity: 0.9,
    exposure: 1.05,
    accentIntensity: 0.7,
  },
  dark: {
    backdropColor: '#0c121b',
    floorColor: '#070b11',
    floorMetalness: 0.8,
    floorRoughness: 0.5,
    ambient: 0.2,
    keyIntensity: 1.95,
    keyColor: '#bcd2e6',
    fillColor: '#1a3550',
    fillIntensity: 0.5,
    envIntensity: 0.55,
    exposure: 0.92,
    accentIntensity: 1.15,
  },
} as const;

/** Re-key tone-mapping exposure when the theme changes. */
function Exposure({ value }: { value: number }): null {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = value;
  }, [gl, value]);
  return null;
}

/**
 * Reports first-frame readiness and pumps the on-demand loop while seam progress
 * or the theme changes (honouring `frameloop="demand"`). It defers "ready" until
 * the GLB has resolved (the model suspends `useGLTF`, so by the time this mounts
 * the scene graph exists) and one frame has painted.
 */
function SeamBridge({ reveal }: { reveal: boolean }): null {
  const invalidate = useThree((s) => s.invalidate);
  const reportedReady = useRef(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      // Two RAFs: the first schedules a render, the second guarantees it painted
      // before the hero crossfades the static render out (no flash of empty bg).
      raf2 = requestAnimationFrame(() => {
        if (!reportedReady.current) {
          reportedReady.current = true;
          setSeamReady('ready');
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setSeamReady('idle');
    };
  }, []);

  useEffect(() => {
    if (!reveal) return;
    const unsubscribe = subscribeSeam(() => { invalidate(); });
    return unsubscribe;
  }, [reveal, invalidate]);

  return null;
}

/**
 * SINGLE camera owner during the reveal (D-15). While seam progress < 1 this
 * eases the camera from a slightly pushed-in pose toward the rig pose and KEEPS
 * `OrbitControls` disabled (passed up via `onActiveChange`). Once progress hits
 * 1 (or immediately under reduced motion) it hands off: it stops writing and
 * enables OrbitControls. The two never write the camera in the same frame.
 */
function IntroCamera({
  reveal,
  onHandoff,
}: {
  reveal: boolean;
  onHandoff: (done: boolean) => void;
}): null {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const [rx, ry, rz] = RIG_CAMERA.position;
    const [tx, ty, tz] = RIG_CAMERA.target;

    if (!reveal) {
      camera.position.set(rx, ry, rz);
      camera.lookAt(tx, ty, tz);
      onHandoff(true);
      return;
    }

    onHandoff(false);
    let raf = 0;
    const tick = () => {
      const p = getSeamState().progress;
      // Intro starts slightly pushed-in/raised, eased toward the rig pose.
      // Scaled to the small model so the move reads but never clips the roof.
      const startY = ry + 0.45;
      const startZ = rz + 1.1;
      const startX = rx - 0.35;
      camera.position.set(
        startX + (rx - startX) * p,
        startY + (ry - startY) * p,
        startZ + (rz - startZ) * p,
      );
      camera.lookAt(tx, ty, tz);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        onHandoff(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); };
  }, [reveal, camera, onHandoff]);

  return null;
}

/** A grounded studio: gradient backdrop sweep + soft planar reflection (D-05). */
function StudioStage({ theme }: { theme: SceneTheme }): ReactNode {
  const s = STUDIO[theme];
  return (
    <group>
      {/* Seamless studio cyclorama: a large back wall + the curved sweep, both
          extending FAR beyond the orbit frustum so no mesh edge can clip into the
          frame as a bright "shard" (the PASS-A artifact). A flat far wall guards
          the upper-left corner the curved Backdrop alone left uncovered. */}
      <mesh position={[0, 4, -10]}>
        <planeGeometry args={[80, 40]} />
        <meshStandardMaterial color={s.backdropColor} roughness={1} metalness={0} />
      </mesh>
      <Backdrop
        receiveShadow
        floor={2.5}
        segments={24}
        scale={[60, 22, 14]}
        position={[0, -0.01, -6]}
      >
        <meshStandardMaterial color={s.backdropColor} roughness={1} metalness={0} />
      </Backdrop>

      {/* Soft planar reflection floor — grounds the car in the studio. Larger so
          its rim never enters the frame; lower mix so the key light never burns a
          bright triangle beside the car (PASS-B render fix). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={512}
          mixBlur={1}
          mixStrength={theme === 'dark' ? 0.5 : 0.3}
          blur={[400, 110]}
          mirror={0}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          depthScale={1}
          metalness={s.floorMetalness}
          roughness={Math.min(1, s.floorRoughness + 0.12)}
          color={s.floorColor}
        />
      </mesh>
    </group>
  );
}

export function ConfiguratorScene({
  reveal,
  autoRotate,
  onDemote,
  theme,
}: ConfiguratorSceneProps): ReactNode {
  const colorId = useConfiguratorStore((s) => s.colorId);
  const wheelId = useConfiguratorStore((s) => s.wheelId);
  const [degraded, setDegraded] = useState(false);
  // Camera ownership handoff (D-15): false while IntroCamera drives.
  const [orbitEnabled, setOrbitEnabled] = useState(!reveal);
  const s = STUDIO[theme];

  return (
    <Canvas
      aria-hidden
      dpr={degraded ? [1, 1.25] : [1, 2]}
      frameloop="demand"
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{
        position: [...RIG_CAMERA.position],
        fov: RIG_CAMERA.fov,
        near: RIG_CAMERA.near,
        far: RIG_CAMERA.far,
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <Exposure value={s.exposure} />
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
      <PerformanceMonitor
        onDecline={() => { setDegraded(true); }}
        onFallback={() => { onDemote(); }}
      />

      {/* Theme-keyed studio lighting (D-06), positions re-fit to the small
          low-poly model. The shadow camera is tightened to the ~3 m car so the
          2048 map is spent on a crisp contact-area shadow. */}
      <ambientLight intensity={s.ambient} />
      <directionalLight
        position={[3.4, 5, 3.6]}
        intensity={s.keyIntensity}
        color={s.keyColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-3.5}
        shadow-camera-right={3.5}
        shadow-camera-top={3.5}
        shadow-camera-bottom={-3.5}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
      />
      <directionalLight
        position={[-3.6, 2.4, -1.6]}
        intensity={s.fillIntensity}
        color={s.fillColor}
      />
      {/* D-09: the ONE signature accent — a single low voltaic graze across the
          rear flank / rocker from behind camera-left. Kept LOW (y below the
          beltline) + short reach so it never lands as a green spot on the flat
          reflective roof (which the clearcoat would mirror as a hot blob) — it
          reads as a quiet rim-light on the lower body. No hub-cap glow, no
          light-bar spam. */}
      <pointLight
        position={[-2.4, 0.5, -2.4]}
        intensity={s.accentIntensity}
        color="#18c08a"
        distance={5.5}
        decay={2.4}
      />

      {/* Procedural studio environment (Lightformer panels — NO CDN HDRI; the
          ADR-002 §5 self-hosted rule). Re-keyed intensity per theme. */}
      <Environment resolution={256} environmentIntensity={s.envIntensity}>
        {/* Broad overhead softbox — the dominant reflection the clearcoat picks
            up, scaled to the small model. Large + soft so the roof gets an even
            studio wash, not a hot point. Neutral white (a saturated tint here
            reflected as a coloured blob on the flat roof). */}
        <Lightformer
          intensity={theme === 'dark' ? 1.3 : 2.1}
          position={[0, 5, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[10, 10, 1]}
          color={theme === 'dark' ? '#c4d4e2' : '#ffffff'}
        />
        {/* Side wrap so the body sides are not flat-dead — kept near-neutral. */}
        <Lightformer
          intensity={theme === 'dark' ? 0.8 : 1.2}
          position={[-3.6, 1.6, -1]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[5, 5, 1]}
          color={theme === 'dark' ? '#26405a' : '#dfeaf2'}
        />
        {/* A WIDE, soft horizontal streak the clearcoat reads as a gentle
            highlight band across the hood — long + thin + low so it grazes the
            forms instead of burning a spot on the flat roof. */}
        <Lightformer
          form="rect"
          intensity={theme === 'dark' ? 1 : 1.5}
          position={[0, 3.4, 3.2]}
          rotation={[-Math.PI / 2.4, 0, 0]}
          scale={[9, 0.35, 1]}
          color="#ffffff"
        />
      </Environment>

      <StudioStage theme={theme} />

      <LumenModel colorId={colorId} wheelId={wheelId} />

      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={theme === 'dark' ? 0.8 : 0.6}
        scale={6}
        blur={2.2}
        far={2.5}
        resolution={1024}
        color={theme === 'dark' ? '#000000' : '#0a1014'}
      />

      <OrbitControls
        makeDefault
        enabled={orbitEnabled}
        enablePan={RIG_ORBIT.enablePan}
        enableZoom={RIG_ORBIT.enableZoom}
        minDistance={RIG_ORBIT.minDistance}
        maxDistance={RIG_ORBIT.maxDistance}
        minPolarAngle={RIG_ORBIT.minPolarAngle}
        maxPolarAngle={RIG_ORBIT.maxPolarAngle}
        enableDamping
        dampingFactor={RIG_ORBIT.dampingFactor}
        rotateSpeed={RIG_ORBIT.rotateSpeed}
        autoRotate={autoRotate && orbitEnabled}
        autoRotateSpeed={RIG_ORBIT.autoRotateSpeed}
        target={[...RIG_CAMERA.target]}
      />

      <SeamBridge reveal={reveal} />
      <IntroCamera reveal={reveal} onHandoff={(done) => { setOrbitEnabled(done); }} />
    </Canvas>
  );
}
